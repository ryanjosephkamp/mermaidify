/** The Draw page: the drawing, the reading, the diagram, the names, the code, and the saves. */
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/chrome.css";
import "../styles/draw.css";

import { exampleStrokes } from "../example.ts";
import { halfway, inside, lineDist, type Point } from "../reader/geometry.ts";
import { toMermaid, toStateMermaid } from "../reader/mermaid.ts";
import { numberStates, recognize, type DiagramKind, type LineStyle, type Reading, type ReadEdge, type ReadShape, type StateRole } from "../reader/recognize.ts";
import { TEMPLATES as OUTLINES, type ShapeKind } from "../reader/shapes.ts";
import { initChrome } from "../site/theme.ts";
import { cancelRenders, loadMermaid, palette, render } from "./diagram.ts";
import { cut } from "./cut.ts";
import { fromFile, keep, loadKept, toFile } from "./drawing.ts";
import { embeddedFonts, portableSvg, saveFile, toPng } from "./export.ts";
import { cleanArrow } from "../reader/snap.ts";
import { createPad, type ChooseBy, type DrawnStroke, type NameTag, type Tool } from "./pad.ts";
import { boxOf, copyStrokes } from "./select.ts";
import { ADDABLE, TEMPLATES, shapeParts, type AddKind, type Part } from "./templates.ts";
import { keepOffline } from "../offline/register.ts";
import { pack } from "./share.ts";
import { snapChosen } from "./tidy.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const INKS = [
  { key: "ink", name: "Ink" },
  { key: "green", name: "Green" },
  { key: "blue", name: "Blue" },
  { key: "red", name: "Red" },
  { key: "amber", name: "Amber" },
];
const WORDS: Record<string, [string, string]> = {
  rect: ["box", "boxes"],
  subroutine: ["box in a box", "boxes in boxes"],
  stadium: ["oval", "ovals"],
  circle: ["circle", "circles"],
  double: ["double circle", "double circles"],
  diamond: ["diamond", "diamonds"],
  hexagon: ["hexagon", "hexagons"],
  trapezoid: ["trapezoid", "trapezoids"],
  "inv-trapezoid": ["trapezoid wide at the top", "trapezoids wide at the top"],
  "lean-right": ["parallelogram", "parallelograms"],
  "lean-left": ["parallelogram leaning left", "parallelograms leaning left"],
  triangle: ["triangle", "triangles"],
  "flip-triangle": ["triangle pointing down", "triangles pointing down"],
  dot: ["filled dot", "filled dots"],
  bullseye: ["ring around a dot", "rings around dots"],
};
/** The shapes a node can take, in the order the shape menu lists them. */
const SHAPES: [ShapeKind, string][] = [
  ["rect", "Box"],
  ["subroutine", "Box in a box"],
  ["stadium", "Oval"],
  ["circle", "Circle"],
  ["double", "Double circle"],
  ["diamond", "Diamond"],
  ["hexagon", "Hexagon"],
  ["trapezoid", "Trapezoid"],
  ["inv-trapezoid", "Trapezoid, wide at the top"],
  ["lean-right", "Parallelogram"],
  ["lean-left", "Parallelogram, leaning left"],
  ["triangle", "Triangle"],
  ["flip-triangle", "Triangle, pointing down"],
  ["dot", "Filled dot (start)"],
  ["bullseye", "Ring around a dot (stop)"],
];
/** What a shape can be in a state diagram, in the order its menu lists them, and its words. */
const ROLES: [StateRole, string][] = [
  ["state", "State"],
  ["choice", "Choice"],
  ["dot", "Start or end"],
];
const ROLE_WORDS: Record<StateRole, [string, string]> = {
  state: ["state", "states"],
  choice: ["choice", "choices"],
  dot: ["start or end", "starts and ends"],
};
/** The styles a line can take, in the order its menu lists them. */
const STYLES: [LineStyle, string][] = [
  ["plain", "Plain"],
  ["dotted", "Dotted"],
  ["thick", "Thick"],
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** How a line's ends read in a label: "A to B", or "A and B" both ways; a dot is the start it leaves or the end it reaches. */
const ends = (e: ReadEdge) => {
  const dot = (id: string) => state.reading?.nodes.find((n) => n.id === id)?.role === "dot";
  const from = dot(e.from) ? "the start" : e.from, to = dot(e.to) ? "the end" : e.to;
  return e.both ? `${from} and ${to}` : `${from} to ${to}`;
};

const state = {
  strokes: [] as DrawnStroke[],
  undo: [] as DrawnStroke[][],
  redo: [] as DrawnStroke[][],
  reading: null as Reading | null,
  /** The strokes changed since the last reading. */
  stale: false,
  labels: {} as Record<string, string>,
  /** The code was edited by hand, so the names no longer write it. */
  edited: false,
  tool: "draw" as Tool,
  color: "ink",
  /** Read the drawing as a flowchart or as a state diagram. */
  diagram: "flowchart" as DiagramKind,
};

// ─── the drawing ───────────────────────────────────────────────────────────
const canvas = $<HTMLCanvasElement>("pad");
/** What was cut or copied: the strokes, and the names and choices kept against them, by stroke id. */
let clip: { strokes: DrawnStroke[]; kept: Map<number, unknown>[] } | null = null, pastes = 0;
/** The bar over the chosen strokes. */
const selBar = $("sel-bar");
const pad = createPad(canvas, {
  // The hint over an empty drawing makes way as soon as the pen or a finger starts drawing.
  begin() {
    $("hint").hidden = true;
  },
  select() {
    placeSelBar();
  },
  edit(next) {
    commit(next);
    placeSelBar();
  },
  stroke(...added) {
    loadMermaid().catch(() => {});
    commit([...state.strokes, ...added]);
  },
  erase(ids) {
    const gone = new Set(ids);
    commit(state.strokes.filter((s) => !gone.has(s.id)));
  },
  cut(path, r) {
    const done = cut(state.strokes, path, r, pad.nextId);
    if (!done.pieces.size) return;
    // What is left of a stroke keeps its names and choices: a box cut free of the line drawn with it keeps its name.
    const kept = [namedStrokes.shape, namedStrokes.line, shapedStrokes, styledStrokes, roledStrokes] as Map<number, unknown>[];
    for (const [was, now] of done.pieces) {
      cutInto.set(was, now);
      for (const id of now) cutFrom.set(id, was);
      for (const m of kept) if (m.has(was)) for (const id of now) m.set(id, m.get(was));
    }
    commit(done.strokes);
  },
  tap(p) {
    if (!state.strokes.length) return;
    // A shape first, then a line, and only then the group around them, so a line inside a group can be named too. A
    // tap on none of them puts away what was read, if it is showing.
    const at = (m: Reading) => shapeAt(p, "nodes", m) ?? lineAt(p, m) ?? shapeAt(p, "groups", m);
    const fresh = !!state.reading && !state.stale;
    if (!at(fresh ? state.reading! : reading(state.diagram))) {
      if (pad.overlaid) pad.setOverlay(null);
      return;
    }
    if (state.edited) {
      tell("You edited the code, so names change there now. Rebuild from the drawing to name shapes here.");
      return;
    }
    // What was read comes back, if it was put away, so the shape being named shows.
    if (!fresh) mermaidify();
    else if (!pad.overlaid) pad.setOverlay({ reading: state.reading!, labels: state.labels });
    // A start or an end has no name, and Mermaid gives a choice none.
    const hit = at(state.reading!);
    if (hit && "role" in hit && hit.role === "dot") return;
    if (hit && "role" in hit && hit.role === "choice") tell("A choice has no name in a state diagram: Mermaid draws it as a small diamond.");
    else if (hit) openNameEditor(hit);
  },
  // A tap on the bare drawing with any other tool puts away what was read too.
  empty() {
    if (pad.overlaid) pad.setOverlay(null);
  },
  penMode(on) {
    $("pen-chip").hidden = !on;
  },
  view(v) {
    const zoom = $("zoom");
    zoom.hidden = Math.abs(v.scale - 1) < 0.01;
    zoom.textContent = Math.round(v.scale * 100) + "%";
    closeNameEditor(true);
    placeSelBar();
  },
});

function commit(next: DrawnStroke[]) {
  state.undo.push(state.strokes);
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  setStrokes(next);
}
function setStrokes(next: DrawnStroke[]) {
  state.strokes = next;
  pad.setStrokes(next);
  state.stale = true;
  $("go").dataset.stale = String(next.length > 0);
  $("hint").hidden = next.length > 0;
  $<HTMLButtonElement>("undo").disabled = !state.undo.length;
  $<HTMLButtonElement>("clear").disabled = !next.length;
  $<HTMLButtonElement>("redo").disabled = !state.redo.length;
  pad.setOverlay(null);
  closeNameEditor(true);
  placeSelBar();
  persist();
  debounce("names", showNameTags, 120);
}
function undo() {
  const prev = state.undo.pop();
  if (!prev) return;
  state.redo.push(state.strokes);
  setStrokes(prev);
}
function redo() {
  const next = state.redo.pop();
  if (!next) return;
  state.undo.push(state.strokes);
  setStrokes(next);
}
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);

// The tools and the inks. The eraser takes whole strokes or only what it passes over, and the select tool chooses by a
// box or by a lasso: a tool already in use, tapped again, opens its kinds, and each kind chosen is kept for next time.
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-tool]"));
const ERASE_KEY = "mermaidify.eraser", CHOOSE_KEY = "mermaidify.select";
let eraseKind: "whole" | "part" = "whole", chooseBy: ChooseBy = "box";
try {
  if (localStorage.getItem(ERASE_KEY) === "part") eraseKind = "part";
  if (localStorage.getItem(CHOOSE_KEY) === "lasso") chooseBy = "lasso";
} catch {}
pad.setChooseBy(chooseBy);
/** The tool a toolbar button stands for: the eraser button is either eraser. */
const toolOf = (b: HTMLButtonElement): Tool => (b.dataset.tool === "erase" && eraseKind === "part" ? "cut" : (b.dataset.tool as Tool));
function setTool(t: Tool) {
  state.tool = t;
  pad.setTool(t);
  const on = t === "cut" ? "erase" : t;
  for (const b of toolButtons) b.setAttribute("aria-checked", String(b.dataset.tool === on));
  toolMenu.open(false);
  placeSelBar();
}
const TOOL_KINDS = {
  eraser: [
    ["whole", "Erase whole strokes", "A touch takes the whole stroke"],
    ["part", "Erase only what it passes over", "Cuts a line apart from its box"],
  ],
  select: [
    ["box", "Drag a box", "Takes every stroke the box reaches into"],
    ["lasso", "Draw a lasso", "Takes every stroke the loop reaches into"],
  ],
} as const;
const toolList = $("tool-menu");
let toolFor: keyof typeof TOOL_KINDS = "eraser";
const toolMenu = {
  list: toolList,
  open(on: boolean, focus = true) {
    toolList.hidden = !on;
    if (on && focus) toolList.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  },
  get isOpen() {
    return !toolList.hidden;
  },
};
/** Opens the kinds of the eraser or the select tool under its button. */
function openToolMenu(which: keyof typeof TOOL_KINDS, button: HTMLButtonElement, focus: boolean) {
  toolFor = which;
  const now = which === "eraser" ? eraseKind : chooseBy;
  toolList.setAttribute("aria-label", which === "eraser" ? "Eraser" : "Select");
  toolList.innerHTML = TOOL_KINDS[which]
    .map(([k, label, note]) => `<li role="none"><button type="button" role="menuitemradio" aria-checked="${k === now}" data-kind="${k}">${label}<small>${note}</small></button></li>`)
    .join("");
  // Under its own button, within the bar.
  const bar = button.closest(".tools")!.getBoundingClientRect(), at = button.getBoundingClientRect();
  toolList.style.left = matchMedia("(max-width: 719px)").matches ? "" : `${Math.max(0, at.left - bar.left)}px`;
  for (const m of menus) m.open(false);
  toolMenu.open(true, focus);
}
function setToolKind(which: keyof typeof TOOL_KINDS, kind: string) {
  if (which === "eraser") {
    eraseKind = kind === "part" ? "part" : "whole";
    setTool(eraseKind === "part" ? "cut" : "erase");
  } else {
    chooseBy = kind === "lasso" ? "lasso" : "box";
    pad.setChooseBy(chooseBy);
    setTool("select");
  }
  try {
    localStorage.setItem(which === "eraser" ? ERASE_KEY : CHOOSE_KEY, kind);
  } catch {}
}
for (const b of toolButtons)
  b.addEventListener("click", (e) => {
    const t = toolOf(b), which = b.dataset.options as keyof typeof TOOL_KINDS | undefined;
    // A press of the keyboard opens the kinds with the first one in focus; a tap just shows them.
    if (which && state.tool === t) {
      if (toolMenu.isOpen && toolFor === which) toolMenu.open(false);
      else openToolMenu(which, b, e.detail === 0);
    } else setTool(t);
  });
toolList.addEventListener("click", (e) => {
  const k = (e.target as Element).closest<HTMLButtonElement>("[data-kind]")?.dataset.kind;
  if (!k) return;
  setToolKind(toolFor, k);
  toolButtons.find((b) => b.dataset.options === toolFor)?.focus();
});
toolList.addEventListener("keydown", (e) => {
  const all = Array.from(toolList.querySelectorAll<HTMLButtonElement>("button")), at = all.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length].focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    toolMenu.open(false);
    toolButtons.find((b) => b.dataset.options === toolFor)?.focus();
  } else if (e.key === "Tab") toolMenu.open(false);
});

// ─── choosing strokes: cut, copy, paste, duplicate, group, delete ─────────
const keptMaps = () => [namedStrokes.shape, namedStrokes.line, shapedStrokes, styledStrokes, roledStrokes] as Map<number, unknown>[];
/** The bar of what can be done with the chosen strokes, above them, or below them when there is no room above. */
function placeSelBar() {
  const k = state.tool === "select" ? pad.chosenBox() : null, chosen = k !== null;
  for (const b of selBar.querySelectorAll<HTMLButtonElement>("[data-sel]")) b.hidden = b.dataset.sel === "paste" ? !clip : !chosen;
  const grouped = chosen && groupOf(pad.chosen) !== undefined;
  const g = selBar.querySelector<HTMLButtonElement>('[data-sel="group"]')!;
  g.textContent = grouped ? "Ungroup" : "Group";
  g.setAttribute("aria-label", grouped ? "Ungroup the chosen strokes" : "Group the chosen strokes");
  selBar.hidden = state.tool !== "select" || (!chosen && !clip);
  if (selBar.hidden) return;
  const w = selBar.offsetWidth, h = selBar.offsetHeight, W = canvas.clientWidth, H = canvas.clientHeight;
  let x = W / 2 - w / 2, y = 8;
  if (k) {
    x = (k.x0 + k.x1) / 2 - w / 2;
    y = k.turn[1] - 16 - h >= 4 ? k.turn[1] - 16 - h : k.y1 + 14;
    if (y + h > H - 4) y = Math.max(4, Math.min(H - h - 4, k.y0 + 4));
  }
  selBar.style.left = canvas.offsetLeft + Math.max(4, Math.min(W - w - 4, x)) + "px";
  selBar.style.top = canvas.offsetTop + y + "px";
}
/** The group all the chosen strokes are in, if they are all in one. */
function groupOf(ids: number[]): number | undefined {
  const gs = new Set(state.strokes.filter((s) => ids.includes(s.id)).map((s) => s.group));
  return gs.size === 1 ? [...gs][0] : undefined;
}
function copyChosen() {
  const ids = new Set(pad.chosen);
  if (!ids.size) return false;
  const strokes = state.strokes.filter((s) => ids.has(s.id));
  clip = { strokes, kept: keptMaps().map((m) => new Map(strokes.filter((s) => m.has(s.id)).map((s) => [s.id, m.get(s.id)]))) };
  pastes = 0;
  return true;
}
/** Adds copies of strokes, shifted, with the names and choices of the strokes they copy, and chooses them. */
function addCopies(strokes: DrawnStroke[], kept: Map<number, unknown>[], dx: number, dy: number) {
  const { copies, from } = copyStrokes(strokes, new Set(strokes.map((s) => s.id)), dx, dy, pad.nextId, [...state.strokes, ...strokes]);
  const maps = keptMaps();
  for (const [id, was] of from) kept.forEach((k, i) => k.has(was) && maps[i].set(id, k.get(was)));
  commit([...state.strokes, ...copies]);
  pad.choose(copies.map((s) => s.id));
}
function deleteChosen() {
  const ids = new Set(pad.chosen);
  if (ids.size) commit(state.strokes.filter((s) => !ids.has(s.id)));
}
function pasteClip() {
  if (!clip) return;
  // Into the middle of the screen, each paste a little below and right of the last, so copies never hide each other.
  const b = boxOf(clip.strokes, new Set(clip.strokes.map((s) => s.id)))!, v = pad.view, size = pad.size, step = 24 / v.scale;
  const cx = -v.x / v.scale + size.w / 2 + pastes * step, cy = -v.y / v.scale + size.h / 2 + pastes * step;
  pastes++;
  addCopies(clip.strokes, clip.kept, cx - b.cx, cy - b.cy);
}
function selAct(act: string) {
  const ids = pad.chosen;
  if (act === "copy" && copyChosen()) tell("Copied. Paste puts a copy in the middle of the screen.");
  else if (act === "cut" && copyChosen()) {
    deleteChosen();
    tell("Cut. Paste puts it back in the middle of the screen.");
  } else if (act === "paste") pasteClip();
  else if (act === "duplicate" && ids.length) {
    const strokes = state.strokes.filter((s) => ids.includes(s.id)), step = 24 / pad.view.scale;
    addCopies(strokes, keptMaps().map((m) => new Map(strokes.filter((s) => m.has(s.id)).map((s) => [s.id, m.get(s.id)]))), step, step);
  } else if (act === "delete") deleteChosen();
  else if (act === "snap" && ids.length) {
    // The shapes as read, with any look chosen from a shape's menu in place of the one read.
    const q = reading(state.diagram), looks = carry(q).shapes;
    const m = { ...q, nodes: q.nodes.map((n) => (looks[n.id] ? { ...n, kind: looks[n.id] } : n)) };
    const r = snapChosen(state.strokes, new Set(ids), m, pad.nextId);
    if (!r.shapes && !r.arrows) tell("Nothing here to snap: hold a shape or an arrow still as you draw it, or draw it closer to one Mermaid knows.");
    else {
      // A stroke that was a shape and its line is now two, and both keep its names and choices.
      const maps = keptMaps();
      for (const [id, was] of r.from) for (const m of maps) if (m.has(was)) m.set(id, m.get(was));
      commit(r.strokes);
      const live = new Set(r.strokes.map((x) => x.id));
      pad.choose([...ids.filter((id) => live.has(id)), ...r.from.keys()]);
      const parts = [r.shapes && plural(r.shapes, "shape", "shapes"), r.arrows && plural(r.arrows, "arrow", "arrows")].filter(Boolean);
      tell(`Snapped ${parts.join(" and ")} clean. Undo brings back what was drawn.`);
    }
  } else if (act === "group" && ids.length) {
    const grouped = groupOf(ids) !== undefined, g = 1 + Math.max(0, ...state.strokes.map((s) => s.group ?? 0));
    commit(state.strokes.map((s) => (ids.includes(s.id) ? (grouped ? { ...s, group: undefined } : { ...s, group: g }) : s)));
    tell(grouped ? "Ungrouped." : "Grouped: tapping any of these strokes chooses them all.");
  }
  placeSelBar();
}
selBar.addEventListener("click", (e) => {
  const act = (e.target as Element).closest<HTMLButtonElement>("[data-sel]")?.dataset.sel;
  if (act) selAct(act);
});
const inks = $("inks");
for (const ink of INKS) {
  const id = "ink-" + ink.key;
  inks.insertAdjacentHTML(
    "beforeend",
    `<input type="radio" name="ink" id="${id}" value="${ink.key}"${ink.key === "ink" ? " checked" : ""}><label for="${id}" title="${ink.name}"><span class="sr-only">${ink.name}</span><span class="swatch" style="background:var(--draw-${ink.key})"></span></label>`,
  );
}
inks.addEventListener("change", (e) => {
  state.color = (e.target as HTMLInputElement).value;
  pad.setColor(state.color);
  setTool("draw");
});
$("fingers-draw").addEventListener("click", () => {
  pad.setPenMode(false);
  $("pen-chip").hidden = true;
});
$("zoom").addEventListener("click", () => pad.fitContent());

// ─── reading ───────────────────────────────────────────────────────────────
/** The strokes each shape and line of the current reading was drawn with, as stroke ids, by shape or line id. */
let drawnWith = new Map<string, Set<number>>();
/**
 * Strokes cut from others, both ways: a name or a choice made on what is left of a stroke reaches the stroke Undo
 * brings back, and one made after Undo reaches the pieces Redo brings back.
 */
const cutFrom = new Map<number, number>(), cutInto = new Map<number, number[]>();
function kin(sid: number): number[] {
  const out = new Set([sid]);
  for (let up = cutFrom.get(sid); up !== undefined && !out.has(up); up = cutFrom.get(up)) out.add(up);
  const down = [sid];
  while (down.length)
    for (const c of cutInto.get(down.pop()!) ?? [])
      if (!out.has(c)) {
        out.add(c);
        down.push(c);
      }
  return [...out];
}
/** The strokes a shape or a line was drawn with, and those cut from them or cut into them. */
const strokesOf = (id: string) => [...(drawnWith.get(id) ?? [])].flatMap(kin);
/** The ids of the current reading's lines. */
let lineIds = new Set<string>();
/**
 * Each name typed, kept against the strokes its shape or line was drawn with: the name follows those strokes through
 * new readings, through a clear and its undo, and wherever the letters change. Shapes' names and lines' names are kept
 * apart, as one stroke can draw a shape and the line that leaves it.
 */
const namedStrokes = { shape: new Map<number, string>(), line: new Map<number, string>() };
function remember(id: string, value: string) {
  const named = namedStrokes[lineIds.has(id) ? "line" : "shape"];
  for (const sid of strokesOf(id)) {
    if (value.trim()) named.set(sid, value);
    else named.delete(sid);
  }
}
/** Each shape chosen from a shape menu, kept against strokes the same way, so it outlasts the next reading. */
const shapedStrokes = new Map<number, ShapeKind>();
/** The shape each node was read as, before any choice, by shape id. */
let readKinds = new Map<string, ShapeKind>();
function rememberKind(id: string, kind: ShapeKind) {
  for (const sid of strokesOf(id)) {
    if (kind === readKinds.get(id)) shapedStrokes.delete(sid);
    else shapedStrokes.set(sid, kind);
  }
}
/** What each shape was chosen to be in a state diagram, kept against strokes the same way. */
const roledStrokes = new Map<number, StateRole>();
/** What each node was read as in a state diagram, before any choice, by shape id. */
let readRoles = new Map<string, StateRole>();
function rememberRole(id: string, role: StateRole) {
  for (const sid of strokesOf(id)) {
    if (role === readRoles.get(id)) roledStrokes.delete(sid);
    else roledStrokes.set(sid, role);
  }
}
/** Each line style chosen from a line's menu, kept against strokes the same way. */
const styledStrokes = new Map<number, LineStyle>();
/** The style each line was read as, before any choice, by line id. */
let readStyles = new Map<string, LineStyle>();
function rememberStyle(id: string, style: LineStyle) {
  for (const sid of strokesOf(id)) {
    if (style === readStyles.get(id)) styledStrokes.delete(sid);
    else styledStrokes.set(sid, style);
  }
}
const holdsCenter = (a: ReadShape, b: ReadShape) => b.bb.cx > a.bb.x0 && b.bb.cx < a.bb.x1 && b.bb.cy > a.bb.y0 && b.bb.cy < a.bb.y1;

interface Carried {
  /** The stroke ids each shape and line was drawn with, by shape or line id. */
  drawnWith: Map<string, Set<number>>;
  /** The names that carry over, by shape or line id. */
  labels: Record<string, string>;
  /** The looks chosen from a shape menu that carry over, by node id. */
  shapes: Record<string, ShapeKind>;
  /** The styles chosen from a line menu that carry over, by line id. */
  lines: Record<string, LineStyle>;
  /** What shapes were chosen to be in a state diagram, by node id. */
  roles: Record<string, StateRole>;
}
/**
 * What a new reading keeps from the one before it. A shape or line drawn with a named stroke keeps that name, and one
 * drawn with a stroke whose look or style was chosen keeps that choice. A named shape whose strokes are all gone,
 * erased and drawn again, passes its name to a shape of the same sort in its place: each holds the other's center, and
 * the nearest wins. A named line drawn again passes its name to a new line between the same two shapes, never to one
 * that was there before.
 */
function carry(m: Reading): Carried {
  const before = state.reading, old = state.labels, oldWith = drawnWith;
  const withIds = new Map([...m.nodes, ...m.groups, ...m.edges].map((s) => [s.id, new Set(s.strokes.map((i) => state.strokes[i]?.id))]));
  const labels: Record<string, string> = {}, shapes: Record<string, ShapeKind> = {}, lines: Record<string, LineStyle> = {};
  const roles: Record<string, StateRole> = {};
  for (const n of [...m.nodes, ...m.groups, ...m.edges]) {
    const ids = [...withIds.get(n.id)!], named = namedStrokes[m.edges.includes(n as ReadEdge) ? "line" : "shape"];
    const name = ids.map((sid) => named.get(sid)).find(Boolean);
    if (name) labels[n.id] = name;
    if (m.nodes.includes(n as ReadShape)) {
      const kind = ids.map((sid) => shapedStrokes.get(sid)).find(Boolean);
      if (kind) shapes[n.id] = kind;
      const role = m.diagram === "state" ? ids.map((sid) => roledStrokes.get(sid)).find(Boolean) : undefined;
      if (role) roles[n.id] = role;
    }
    if (m.edges.includes(n as ReadEdge)) {
      const style = ids.map((sid) => styledStrokes.get(sid)).find(Boolean);
      if (style) lines[n.id] = style;
    }
  }
  if (before) {
    const live = new Set(state.strokes.map((s) => s.id));
    const kinds: ["nodes", "groups"] = ["nodes", "groups"];
    for (const kind of kinds) {
      const gone = before[kind].filter((x) => old[x.id]?.trim() && ![...(oldWith.get(x.id) ?? [])].some((sid) => live.has(sid)));
      for (const n of m[kind]) {
        if (labels[n.id] || !gone.length) continue;
        const near = gone
          .filter((x) => holdsCenter(n, x) && holdsCenter(x, n))
          .sort((a, b) => Math.hypot(a.bb.cx - n.bb.cx, a.bb.cy - n.bb.cy) - Math.hypot(b.bb.cx - n.bb.cx, b.bb.cy - n.bb.cy))[0];
        if (!near) continue;
        labels[n.id] = old[near.id];
        gone.splice(gone.indexOf(near), 1);
      }
    }
    // A shape of this reading is the one before when it keeps any of that one's strokes.
    const now = (id: string) => {
      const was = oldWith.get(id) ?? new Set();
      return [...m.nodes, ...m.groups].find((s) => [...withIds.get(s.id)!].some((sid) => was.has(sid)))?.id;
    };
    const gone = before.edges.filter((x) => old[x.id]?.trim() && ![...(oldWith.get(x.id) ?? [])].some((sid) => live.has(sid)));
    const seen = new Set([...oldWith.values()].flatMap((ids) => [...ids]));
    for (const e of m.edges) {
      if (labels[e.id] || !gone.length || [...withIds.get(e.id)!].some((sid) => seen.has(sid))) continue;
      const was = gone.find((x) => {
        const a = now(x.from), b = now(x.to);
        return (a === e.from && b === e.to) || (a === e.to && b === e.from);
      });
      if (!was) continue;
      labels[e.id] = old[was.id];
      gone.splice(gone.indexOf(was), 1);
    }
  }
  return { drawnWith: withIds, labels, shapes, lines, roles };
}

/** Reads the drawing. Code edited by hand is kept: only Rebuild from the drawing replaces it. */
function mermaidify() {
  const m = recognize(state.strokes, { diagram: state.diagram }), { labels, shapes, lines, roles, drawnWith: withIds } = carry(m);
  drawnWith = withIds;
  lineIds = new Set(m.edges.map((e) => e.id));
  readKinds = new Map(m.nodes.map((n) => [n.id, n.kind]));
  readStyles = new Map(m.edges.map((e) => [e.id, e.style]));
  readRoles = new Map(m.nodes.map((n) => [n.id, n.role ?? "state"]));
  for (const n of m.nodes)
    if (shapes[n.id]) {
      n.kind = shapes[n.id];
      n.unsure = false;
    }
  for (const e of m.edges) if (lines[e.id]) e.style = lines[e.id];
  if (Object.keys(roles).length) {
    for (const n of m.nodes) if (roles[n.id]) n.role = roles[n.id];
    numberStates(m.nodes);
  }
  state.reading = m;
  state.labels = labels;
  for (const [id, value] of Object.entries(labels)) remember(id, value);
  state.stale = false;
  $("go").dataset.stale = "false";
  readLine(m);
  if (state.edited) {
    // First, so a short line under the drawing cuts what was read rather than this.
    $("read").querySelector("span")!.insertAdjacentHTML("afterbegin", '<span class="kept">Your own code is kept; Rebuild from the drawing replaces it.</span> ');
    persist();
  } else writeCode();
  names();
  pad.setOverlay({ reading: m, labels });
  showNameTags();
}
/** A plain message on the line under the drawing. */
function tell(text: string) {
  const span = document.createElement("span");
  span.textContent = text;
  $("read").replaceChildren(span);
}
function readLine(m: Reading) {
  const kinds: Record<string, number> = {};
  for (const n of m.nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  const parts = Object.entries(kinds).map(([k, n]) => plural(n, ...WORDS[k]));
  const arrows = m.edges.length, assumed = m.edges.filter((e) => e.assumed).length, unsure = m.nodes.filter((n) => n.unsure).length;
  const styled = (["dotted", "thick"] as const).map((k) => [k, m.edges.filter((e) => e.style === k).length] as const).filter(([, n]) => n);
  const bits: string[] = [];
  const pointed = assumed ? `, ${assumed} with no head, so pointed the way ${assumed === 1 ? "it was" : "they were"} drawn` : "";
  if (m.diagram === "state") {
    // A state diagram counts what each shape is, and has transitions, which Mermaid draws plain.
    const roles = ROLES.map(([r]) => [r, m.nodes.filter((n) => n.role === r).length] as const).filter(([, n]) => n);
    bits.push(roles.length ? roles.map(([r, n], i) => (i ? plural(n, ...ROLE_WORDS[r]) : `<strong>${plural(n, ...ROLE_WORDS[r])}</strong>`)).join(", ") : "<strong>no states</strong>");
    if (m.groups.length) bits.push(plural(m.groups.length, "composite state", "composite states"));
    bits.push(plural(arrows, "transition", "transitions") + pointed);
  } else {
    bits.push(m.nodes.length ? `<strong>${plural(m.nodes.length, "shape", "shapes")}</strong> (${parts.join(", ")})` : "<strong>no shapes</strong>");
    if (m.groups.length) bits.push(plural(m.groups.length, "group", "groups"));
    bits.push(plural(arrows, "arrow", "arrows") + (styled.length ? ` (${styled.map(([k, n]) => `${n} ${k}`).join(", ")})` : "") + pointed);
  }
  if (m.loops) bits.push(`<strong>${plural(m.loops, "loop", "loops")}</strong>`);
  if (m.unused.length) bits.push(`${plural(m.unused.length, "mark", "marks")} left out, shaded on the drawing`);
  if (unsure) bits.push(`${plural(unsure, "shape", "shapes")} hard to read`);
  $("read").innerHTML = `<span>Read ${bits.join(" · ")}.</span> <span class="ms">${m.ms.toFixed(1)} ms</span> <a class="to-result" href="#result">See the diagram</a>`;
}
$("go").addEventListener("click", () => {
  if (!state.strokes.length) {
    tell("Draw something first, or load the example from More.");
    return;
  }
  mermaidify();
});
/** Whether the outlines of what was read show on the drawing: a box under it, and the same switch in More. */
function showOutlines(on: boolean) {
  pad.setShowOverlay(on);
  $<HTMLInputElement>("show-read").checked = on;
  document.querySelector('[data-act="outlines"]')!.setAttribute("aria-checked", String(on));
}
$<HTMLInputElement>("show-read").addEventListener("change", (e) => showOutlines((e.target as HTMLInputElement).checked));
/** Reads the drawing as a flowchart or as a state diagram: the menu under the diagram and the one in More agree. */
function setDiagram(kind: DiagramKind, read: boolean) {
  const changed = state.diagram !== kind;
  state.diagram = kind;
  $<HTMLSelectElement>("diagram-kind").value = kind;
  for (const b of document.querySelectorAll('[data-act="flowchart"], [data-act="state"]')) b.setAttribute("aria-checked", String(b.getAttribute("data-act") === kind));
  if (!changed || !read) return;
  // Code edited by hand stays as it is; the reading, the names, and Rebuild follow the new kind.
  if (state.strokes.length) mermaidify();
  persist();
}
$<HTMLSelectElement>("diagram-kind").addEventListener("change", (e) => setDiagram((e.target as HTMLSelectElement).value === "state" ? "state" : "flowchart", true));

/** The smallest shape, or group, around a point. */
function shapeAt(p: Point, which: "nodes" | "groups", m = state.reading): ReadShape | null {
  if (!m) return null;
  const area = (s: ReadShape) => s.bb.w * s.bb.h;
  return m[which].filter((s) => inside(p, s.poly)).sort((a, b) => area(a) - area(b))[0] ?? null;
}
/** The line nearest a point, within a fingertip's reach of it on the screen. */
function lineAt(p: Point, m = state.reading): ReadEdge | null {
  const reach = 16 / pad.view.scale;
  if (!m) return null;
  let best: { e: ReadEdge; d: number } | null = null;
  for (const e of m.edges) {
    const d = lineDist(p, e.pts);
    if (d <= reach && (!best || d < best.d)) best = { e, d };
  }
  return best?.e ?? null;
}


// ─── names on the drawing ──────────────────────────────────────────────────
const NAMES_KEY = "mermaidify.names";
let namesOn = true;
try {
  namesOn = localStorage.getItem(NAMES_KEY) !== "off";
} catch {}
/**
 * The names typed for shapes and lines, placed on the drawing: from the reading when it is fresh, and otherwise from
 * the drawing read again quietly, so each name stays on its shape or line as more is drawn, moved, or erased.
 */
function showNameTags() {
  if (pad.pressing) return debounce("names", showNameTags, 200);
  const named = state.strokes.some((s) => namedStrokes.shape.has(s.id) || namedStrokes.line.has(s.id));
  if (!named || !namesOn) return pad.setNames([]);
  const fresh = !!state.reading && !state.stale, m = fresh ? state.reading! : reading(state.diagram);
  const labels = fresh ? state.labels : carry(m).labels, tags: NameTag[] = [];
  const ids = (idx: number[]) => idx.flatMap((i) => (state.strokes[i] ? [state.strokes[i].id] : []));
  for (const s of [...m.nodes, ...m.groups]) {
    const text = labels[s.id]?.trim();
    // A start or an end has no name, and Mermaid gives a choice in a state diagram none.
    if (!text || s.role === "dot" || s.role === "choice") continue;
    tags.push({ strokes: ids(s.strokes), at: [s.bb.cx, m.groups.includes(s) ? s.bb.y0 + 16 : s.bb.cy], text, w: s.bb.w, line: false });
  }
  for (const e of m.edges) {
    const text = labels[e.id]?.trim();
    if (text && e.pts.length > 1) tags.push({ strokes: ids(e.strokes), at: halfway(e.pts), text, w: 180, line: true });
  }
  pad.setNames(tags);
}
function setNamesOn(on: boolean) {
  namesOn = on;
  pad.setShowNames(on);
  $("more-list").querySelector('[data-act="names"]')!.setAttribute("aria-checked", String(on));
  try {
    if (on) localStorage.removeItem(NAMES_KEY);
    else localStorage.setItem(NAMES_KEY, "off");
  } catch {}
  showNameTags();
}

// ─── names ─────────────────────────────────────────────────────────────────
function setName(id: string, value: string) {
  state.labels[id] = value;
  remember(id, value);
  if (state.reading && !state.stale) pad.setOverlay({ reading: state.reading, labels: state.labels });
  debounce("names", showNameTags, 60);
  const input = document.getElementById("name-" + id) as HTMLInputElement | null;
  if (input && input.value !== value) input.value = value;
  // The code follows each key at once; the diagram, which takes longer, follows a pause in the typing.
  if (!state.edited) {
    writeCodeText();
    debounce("draw", draw, 250);
  }
  persist();
}
/** Gives a line another style: Mermaid draws it so, and the choice stays with the strokes it was drawn with. */
function setStyle(id: string, style: LineStyle) {
  const e = state.reading?.edges.find((x) => x.id === id);
  if (!e || e.style === style) return;
  e.style = style;
  rememberStyle(id, style);
  if (!state.stale) readLine(state.reading!);
  if (!state.edited) writeCode();
  persist();
}
/** Gives a node another shape: Mermaid draws it so, and the choice stays with the strokes it was drawn with. */
function setKind(id: string, kind: ShapeKind) {
  const n = state.reading?.nodes.find((x) => x.id === id);
  if (!n || n.kind === kind) return;
  n.kind = kind;
  n.unsure = false;
  rememberKind(id, kind);
  document.getElementById("name-" + id)?.setAttribute("aria-label", `Name for ${id}, ${WORDS[kind][0]}`);
  if (!state.stale) {
    pad.setOverlay({ reading: state.reading!, labels: state.labels });
    readLine(state.reading!);
  }
  if (!state.edited) writeCode();
  persist();
}
/** Makes a node a state, a choice, or a start or end in a state diagram, and keeps the choice with its strokes. */
function setRole(id: string, role: StateRole) {
  const m = state.reading, n = m?.nodes.find((x) => x.id === id);
  if (!m || !n || n.role === role) return;
  n.role = role;
  numberStates(m.nodes);
  rememberRole(id, role);
  names();
  if (!state.stale) {
    pad.setOverlay({ reading: m, labels: state.labels });
    readLine(m);
  }
  if (!state.edited) writeCode();
  persist();
}
function names() {
  const box = $("names"), m = state.reading;
  box.textContent = "";
  if (!m) return;
  const states = m.diagram === "state";
  // Starts and ends have no letter in Mermaid, so the list numbers them.
  const dotNumber = (s: ReadShape) => m.nodes.filter((n) => n.role === "dot").indexOf(s) + 1;
  for (const s of [...m.nodes, ...m.groups]) {
    const group = m.groups.includes(s), sort = group ? (states ? "composite state" : "group") : states ? ROLE_WORDS[s.role ?? "state"][0] : (WORDS[s.kind]?.[0] ?? "shape");
    const label = document.createElement("label"), tag = document.createElement("span"), input = document.createElement("input");
    // In a state diagram a start or an end has no name, and Mermaid gives a choice none.
    const nameless = states && (s.role === "dot" || s.role === "choice");
    tag.className = "tag";
    tag.textContent = s.role === "dot" ? "●" : s.id;
    input.id = "name-" + s.id;
    input.value = nameless ? "" : (state.labels[s.id] ?? "");
    input.placeholder = nameless ? "No name" : s.label;
    input.autocomplete = "off";
    input.disabled = state.edited || nameless;
    if (nameless) input.dataset.nameless = "";
    const who = s.role === "dot" ? `start or end ${dotNumber(s)}` : s.id;
    input.setAttribute("aria-label", `Name for ${who}, ${sort}`);
    input.addEventListener("input", () => setName(s.id, input.value));
    label.append(tag, input);
    const row = document.createElement("div");
    row.className = "name-row";
    row.append(label);
    if (states && !group) {
      const pick = document.createElement("select");
      pick.id = "role-" + s.id;
      pick.disabled = state.edited;
      pick.setAttribute("aria-label", `What ${who} is`);
      for (const [k, name] of ROLES) pick.add(new Option(name, k, false, k === s.role));
      pick.addEventListener("change", () => setRole(s.id, pick.value as StateRole));
      row.append(pick);
    } else if (m.nodes.includes(s)) {
      const pick = document.createElement("select");
      pick.id = "shape-" + s.id;
      pick.disabled = state.edited;
      pick.setAttribute("aria-label", `Shape for ${s.id}`);
      for (const [k, name] of SHAPES) pick.add(new Option(name, k, false, k === s.kind));
      pick.addEventListener("change", () => setKind(s.id, pick.value as ShapeKind));
      row.append(pick);
    } else {
      const note = document.createElement("span");
      note.className = "shape-note";
      note.textContent = states ? "Composite" : "Group";
      row.append(note);
    }
    box.append(row);
  }
  for (const e of m.edges) {
    const label = document.createElement("label"), tag = document.createElement("span"), input = document.createElement("input");
    tag.className = "tag line-tag";
    const end = (id: string) => (m.nodes.find((n) => n.id === id)?.role === "dot" ? "●" : id);
    tag.textContent = `${end(e.from)}${e.both ? "↔" : "→"}${end(e.to)}`;
    input.id = "name-" + e.id;
    input.value = state.labels[e.id] ?? "";
    input.placeholder = "No name";
    input.autocomplete = "off";
    input.disabled = state.edited;
    input.setAttribute("aria-label", `Name for the line from ${ends(e)}`);
    input.addEventListener("input", () => setName(e.id, input.value));
    label.append(tag, input);
    const row = document.createElement("div");
    row.className = "name-row";
    row.append(label);
    // Mermaid draws every transition in a state diagram the same, so a line's style waits for a flowchart.
    if (states) {
      const note = document.createElement("span");
      note.className = "shape-note";
      note.textContent = "Transition";
      row.append(note);
    } else {
      const pick = document.createElement("select");
      pick.id = "style-" + e.id;
      pick.disabled = state.edited;
      pick.setAttribute("aria-label", `Style for the line from ${ends(e)}`);
      for (const [k, name] of STYLES) pick.add(new Option(name, k, false, k === e.style));
      pick.addEventListener("change", () => setStyle(e.id, pick.value as LineStyle));
      row.append(pick);
    }
    box.append(row);
  }
  if (!m.nodes.length && !m.groups.length) box.innerHTML = '<p class="status">No shapes were read. Draw a closed shape, like a box or a circle.</p>';
  $("names-note").textContent = state.edited ? "You edited the code, so names change there now" : namesNote();
}
const namesNote = () =>
  state.diagram === "state" ? "Each state's and transition's name, and what each shape is" : "Each shape's and line's name and look, in the code's order";

// The name editor over the drawing.
const editor = $<HTMLFormElement>("name-edit"), editorInput = $<HTMLInputElement>("name-input");
let editing: ReadShape | ReadEdge | null = null;
/** Opens the name box over a shape, or over the middle of a line. */
function openNameEditor(s: ReadShape | ReadEdge) {
  if (state.edited) {
    tell("You edited the code, so names change there now. Rebuild from the drawing to name shapes here.");
    return;
  }
  closeNameEditor(true);
  editing = s;
  const line = "pts" in s && "from" in s, at = line ? halfway(s.pts) : ([s.bb.cx, s.bb.cy] as Point);
  const wrap = $("pad-wrap").getBoundingClientRect(), [x, y] = pad.toScreen(at);
  // Room to write a name with a pen, as well as to type one.
  const w = Math.min(wrap.width - 16, Math.max(200, line ? 0 : s.bb.w * pad.view.scale));
  editor.style.width = w + "px";
  editor.style.left = Math.max(8, Math.min(wrap.width - w - 8, x - w / 2)) + "px";
  editor.style.top = Math.max(8, Math.min(wrap.height - 52, y - 22)) + "px";
  $("name-label").textContent = line ? `Name for the ${state.diagram === "state" ? "transition" : "line"} from ${ends(s)}` : `Name for ${s.id}`;
  editorInput.value = state.labels[s.id] ?? "";
  editorInput.placeholder = line ? "Name this line" : s.label;
  editor.hidden = false;
  editorInput.focus({ preventScroll: true });
  editorInput.select();
}
function closeNameEditor(save: boolean) {
  if (!editing) return;
  if (save) setName(editing.id, editorInput.value);
  editing = null;
  editor.hidden = true;
}
editor.addEventListener("submit", (e) => {
  e.preventDefault();
  closeNameEditor(true);
});
editorInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeNameEditor(false);
    canvas.focus();
  }
});
editorInput.addEventListener("blur", () => closeNameEditor(true));
// The drawing keeps focus from moving on a press, so the name being typed is kept here, before the press is handled.
canvas.addEventListener("pointerdown", () => closeNameEditor(true), { capture: true });

// ─── the code and the diagram ──────────────────────────────────────────────
const code = $<HTMLTextAreaElement>("code"), diagram = $("diagram");
function writeCodeText() {
  if (!state.reading) return;
  code.value = (state.reading.diagram === "state" ? toStateMermaid : toMermaid)(state.reading, { labels: state.labels });
  setEdited(false);
  persist();
}
function writeCode() {
  if (!state.reading) return;
  writeCodeText();
  draw();
}
function setEdited(on: boolean) {
  state.edited = on;
  $("rebuild").hidden = !on || !state.reading;
  for (const i of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#names input, #names select")) i.disabled = on || "nameless" in i.dataset;
  $("names-note").textContent = on ? "You edited the code, so names change there now" : namesNote();
}
code.addEventListener("input", () => {
  setEdited(true);
  debounce("draw", draw, 350);
  persist();
});
$("rebuild").addEventListener("click", () => {
  setEdited(false);
  if ((state.stale || !state.reading) && state.strokes.length) mermaidify();
  else writeCode();
});

let shown: SVGSVGElement | null = null;
async function draw() {
  const text = code.value.trim();
  const err = $("mm-error");
  if (!text) {
    cancelRenders();
    diagram.classList.remove("is-busy");
    diagram.innerHTML = '<p class="empty">The diagram appears here after Mermaidify.</p>';
    shown = null;
    err.hidden = true;
    saves();
    return;
  }
  diagram.classList.add("is-busy");
  let r;
  try {
    r = await render(text, { handDrawn: $<HTMLInputElement>("hand").checked });
  } catch {
    diagram.classList.remove("is-busy");
    diagram.innerHTML = '<p class="empty">Mermaid did not load, so the code is all there is for now. Check the connection and press Mermaidify again, or reload the page.</p>';
    shown = null;
    saves();
    return;
  }
  if ("stale" in r) return;
  diagram.classList.remove("is-busy");
  if (r.ok) {
    diagram.innerHTML = r.svg;
    shown = diagram.querySelector("svg");
    err.hidden = true;
  } else {
    err.hidden = false;
    err.textContent = "Mermaid can't read this yet: " + r.error;
  }
  saves();
}
$("hand").addEventListener("change", draw);
/** The line a name in the diagram belongs to: Mermaid marks it "L_" and its ends, so among lines between those two shapes, the one with that name. */
function lineOf(label: Element): string | undefined {
  const m = state.reading, hit = /^L_([A-Za-z0-9]+)_([A-Za-z0-9]+)_\d+$/.exec(label.getAttribute("data-id") ?? "");
  if (!m || !hit) return;
  const between = m.edges.filter((e) => (e.from === hit[1] && e.to === hit[2]) || (e.both && e.from === hit[2] && e.to === hit[1]));
  const text = label.textContent?.trim() ?? "";
  return (between.find((e) => (state.labels[e.id] ?? "").trim() === text) ?? between[0])?.id;
}
/** The transition a name in a state diagram belongs to: Mermaid numbers them in its own order, so the one with that name. */
function transitionOf(label: Element): string | undefined {
  const text = label.textContent?.trim() ?? "";
  return text ? state.reading?.edges.find((e) => (state.labels[e.id] ?? "").trim() === text)?.id : undefined;
}
// A tap on a shape in the diagram, or on a line's name, goes to its name.
diagram.addEventListener("click", (e) => {
  // Mermaid marks a shape "node", or "rough-node" in the hand-drawn look, a group "cluster" (a composite state
  // "statediagram-cluster"), and a line's name "edgeLabel". A state's id reads "state-A-0".
  const g = (e.target as Element).closest("g.node, g.rough-node, g.cluster, g.statediagram-cluster, g.edgeLabel");
  if (!g) return;
  const raw = g.getAttribute("data-id") || g.id || "", hit = /(?:flowchart|state)-([A-Za-z0-9_]+)-\d+$/.exec(raw);
  const label = g.matches("g.edgeLabel") ? g.querySelector("[data-id]") : null;
  const states = state.reading?.diagram === "state";
  const id = label ? (states ? transitionOf(g) : lineOf(label)) : hit ? hit[1] : (/([A-Za-z0-9_]+)$/.exec(raw) || [])[1];
  const input = id ? (document.getElementById("name-" + id) as HTMLInputElement | null) : null;
  if (input && !input.disabled) {
    input.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    input.focus({ preventScroll: true });
    input.select();
  }
});

// ─── copying and saving ────────────────────────────────────────────────────
/** A saved file's name, after the diagram the code is: a state diagram, or a flowchart. */
const fileName = (ext: string) => (/^\s*stateDiagram/.test(code.value) ? "state-diagram." : "flowchart.") + ext;
function saves() {
  $<HTMLButtonElement>("save-svg").disabled = !shown;
  $<HTMLButtonElement>("save-png").disabled = !shown;
  $<HTMLButtonElement>("embed").disabled = !shown;
}
const say = (id: string, text: string) => {
  const el = $(id);
  el.textContent = text;
  debounce("say-" + id, () => (el.textContent = ""), 4000);
};
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(code.value);
    say("copy-status", "Copied.");
  } catch {
    code.focus();
    code.select();
    say("copy-status", "Copy was blocked here; the code is selected, so copy it by hand.");
  }
});
async function offer(name: string, blob: Blob) {
  try {
    say("save-status", (await saveFile(name, blob)) === "saved" ? "Saved " + name + "." : "");
  } catch (e) {
    say("save-status", "Not saved: " + ((e as Error)?.message || e));
  }
}
const base = () => new URL("./", document.baseURI);
$("save-svg").addEventListener("click", () => {
  if (!shown) return;
  const p = portableSvg(shown, palette().surface);
  offer(fileName("svg"), new Blob([p.text], { type: "image/svg+xml" }));
});
$("save-png").addEventListener("click", async () => {
  if (!shown) return;
  try {
    const p = portableSvg(shown, palette().surface, await embeddedFonts(base()));
    await offer(fileName("png"), await toPng(p, 2));
  } catch {
    say("save-status", "The PNG could not be made here. Save SVG still works.");
  }
});
/**
 * A frame that shows this diagram on any web page: the site's embed page, with the code in its address, so the diagram
 * needs nothing stored anywhere. Its height keeps the diagram's shape at the frame's width.
 */
$("embed").addEventListener("click", async () => {
  const text = code.value.trim();
  if (!text || !shown) return;
  const q = new URLSearchParams();
  if ($<HTMLInputElement>("hand").checked) q.set("look", "hand");
  if (document.documentElement.dataset.theme) q.set("theme", document.documentElement.dataset.theme);
  q.set("code", await pack(text));
  const url = new URL("embed/", base());
  url.hash = q.toString();
  // As tall as the diagram is at the frame's width, or, for a wide one the embed page keeps readable and scrolls, at
  // a little over half its size, with room for the scroll bar.
  const vb = shown.viewBox.baseVal, w = 640, fits = vb?.width ? (w - 24) / vb.width : 1, k = Math.min(1, Math.max(fits, 0.55));
  const h = Math.round(Math.max(200, Math.min(900, vb?.width ? k * vb.height + 36 + (fits < 0.55 ? 16 : 0) : 420)));
  const title = /^\s*stateDiagram/.test(text) ? "State diagram" : "Flowchart";
  const html = `<iframe src="${url.href}" title="${title}" width="${w}" height="${h}" style="border:0;max-width:100%" loading="lazy"></iframe>`;
  try {
    await navigator.clipboard.writeText(html);
    say("save-status", "Embed code copied: paste it into a web page's HTML.");
  } catch {
    prompt("Copy this embed code:", html);
  }
});
$("save-mmd").addEventListener("click", () => offer(fileName("mmd"), new Blob([code.value.trimEnd() + "\n"], { type: "text/plain" })));

// ─── the More menu ─────────────────────────────────────────────────────────
/** A button that opens a menu under it: arrow keys move through the menu, and Escape, Tab, or a press elsewhere close it. */
function menuOf(button: HTMLButtonElement, list: HTMLElement) {
  const items = () => Array.from(list.querySelectorAll<HTMLButtonElement>("[role^=menuitem]"));
  const open = (on: boolean, focus = true) => {
    list.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
    if (on && focus) items()[0].focus();
  };
  button.addEventListener("click", () => {
    for (const m of menus) if (m.list !== list) m.open(false);
    open(button.getAttribute("aria-expanded") !== "true", false);
  });
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      open(true);
    } else if (e.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
      e.preventDefault();
      open(false);
    }
  });
  list.addEventListener("keydown", (e) => {
    const all = items(), at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      open(false);
      button.focus();
    } else if (e.key === "Tab") open(false);
  });
  const m = { list, open, get isOpen() { return button.getAttribute("aria-expanded") === "true"; } };
  menus.push(m);
  return m;
}
const menus: { list: HTMLElement; open(on: boolean, focus?: boolean): void; readonly isOpen: boolean }[] = [];
menus.push(toolMenu);
const more = $<HTMLButtonElement>("more"), moreList = $("more-list"), moreMenu = menuOf(more, moreList);
const openMore = (open: boolean, focus = true) => moreMenu.open(open, focus);
// A press anywhere but in a menu's own place, its button and its list, closes it: picking a tool closes Add and More.
document.addEventListener("pointerdown", (e) => {
  for (const m of menus) if (!m.list.parentElement!.contains(e.target as Node)) m.open(false);
});
// ─── adding shapes and templates ──────────────────────────────────────────
const add = $<HTMLButtonElement>("add"), addList = $("add-list");
/** A small picture of a shape for the Add menu, from the same outline the reader matches it to. */
function shapeIcon(kind: AddKind): string {
  const svg = (inner: string) => `<svg viewBox="0 0 28 20" aria-hidden="true">${inner}</svg>`;
  if (kind === "dot") return svg('<circle cx="14" cy="10" r="4.5" class="fill" />');
  if (kind === "bullseye") return svg('<circle cx="14" cy="10" r="7" /><circle cx="14" cy="10" r="3" class="fill" />');
  if (kind === "circle") return svg('<circle cx="14" cy="10" r="7.5" />');
  if (kind === "stadium") return svg('<rect x="2.5" y="3.5" width="23" height="13" rx="6.5" />');
  const [w, h] = kind === "diamond" || kind === "triangle" ? [18, 15] : [23, 13], x0 = 14 - w / 2, y0 = 10 - h / 2;
  return svg(`<polygon points="${OUTLINES[kind].map(([u, v]) => `${(x0 + u * w).toFixed(1)},${(y0 + v * h).toFixed(1)}`).join(" ")}" />`);
}
/**
 * The arrows the Add menu offers, each as long as a box is wide: one way; both ways in one line, for two shapes that
 * each lead to the other (a flowchart's two-way link, or two transitions in a state diagram); and a pair side by side,
 * one each way, so each can have its own name.
 */
const ARROWS: { id: string; label: string; icon: string; parts(): Part[] }[] = [
  { id: "arrow", label: "Arrow", icon: "M3 10h21M19 6l5 4-5 4", parts: () => [{ pts: cleanArrow([0, 0], [140, 0], 1), line: true }] },
  { id: "both", label: "Two-way arrow", icon: "M4 10h20M9 6l-5 4 5 4M19 6l5 4-5 4", parts: () => [{ pts: cleanArrow([0, 0], [140, 0], 1, true), line: true }] },
  {
    id: "pair",
    label: "Arrows both ways",
    icon: "M3 7h21M20 4l4 3-4 3M25 13H4M8 10l-4 3 4 3",
    parts: () => [{ pts: cleanArrow([0, 0], [140, 0], 1), line: true }, { pts: cleanArrow([140, 30], [0, 30], 1), line: true }],
  },
];
/** The templates' groups, in the menu's order. */
const templateGroups = [...new Set(TEMPLATES.map((t) => t.group))];
addList.innerHTML =
  `<p class="menu-head" id="add-shapes" role="presentation">Shapes</p><div class="add-shapes" role="group" aria-labelledby="add-shapes">` +
  ADDABLE.map((a) => `<button type="button" role="menuitem" data-add="${a.kind}">${shapeIcon(a.kind)}<span>${a.label}</span></button>`).join("") +
  `</div><p class="menu-head" id="add-arrows" role="presentation">Arrows</p><div class="add-shapes add-arrows" role="group" aria-labelledby="add-arrows">` +
  ARROWS.map((a) => `<button type="button" role="menuitem" data-arrow="${a.id}"><svg viewBox="0 0 28 20" aria-hidden="true"><path d="${a.icon}" /></svg><span>${a.label}</span></button>`).join("") +
  "</div>" +
  templateGroups
    .map(
      (g, i) =>
        `<p class="menu-head" id="add-templates-${i}" role="presentation">${g}</p><div class="add-templates" role="group" aria-labelledby="add-templates-${i}">` +
        TEMPLATES.filter((t) => t.group === g)
          .map((t) => `<button type="button" role="menuitem" data-template="${t.id}"><span>${t.label}</span></button>`)
          .join("") +
        "</div>",
    )
    .join("");
const addMenu = menuOf(add, addList);
/**
 * Adds strokes in the middle of the screen, the size on screen they are at 100%, with the names they carry, and chooses
 * them, so they can be dragged into place at once.
 */
function addParts(parts: Part[]) {
  const v = pad.view, all = parts.flatMap((p) => p.pts);
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
  // A template wider or taller than the screen is drawn smaller to fit it, though never so small its shapes go unread.
  const fit = Math.max(0.6, Math.min(1, (0.9 * canvas.clientWidth) / (x1 - x0 || 1), (0.9 * canvas.clientHeight) / (y1 - y0 || 1)));
  const k = fit / v.scale;
  const cx = -v.x / v.scale + pad.size.w / 2, cy = -v.y / v.scale + pad.size.h / 2;
  const added = parts.map((p) => {
    const s: DrawnStroke = { id: pad.nextId(), color: state.color, pts: p.pts.map(([x, y]): Point => [cx + (x - bx) * k, cy + (y - by) * k]), by: "mouse", zoom: v.scale };
    if (p.name) namedStrokes[p.line ? "line" : "shape"].set(s.id, p.name);
    return s;
  });
  commit([...state.strokes, ...added]);
  setTool("select");
  pad.choose(added.map((s) => s.id));
}
addList.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("[data-add], [data-arrow], [data-template]");
  if (!b) return;
  addMenu.open(false);
  add.focus();
  if (b.dataset.arrow) {
    const a = ARROWS.find((x) => x.id === b.dataset.arrow)!;
    addParts(a.parts());
    tell(`Added: ${a.label.toLowerCase()}. Drag it between two shapes; the plus adds those too.`);
  } else if (b.dataset.add) {
    const a = ADDABLE.find((x) => x.kind === b.dataset.add)!;
    addParts(shapeParts(a.kind, 0, 0, a.w, a.h));
    tell(`Added: ${a.label.toLowerCase()}. Drag it into place, or pick the pen to draw.`);
  } else {
    const t = TEMPLATES.find((x) => x.id === b.dataset.template)!;
    if (t.diagram !== state.diagram) setDiagram(t.diagram, false);
    addParts(t.parts());
    tell(`Added: ${t.label.toLowerCase()}, chosen so you can drag it into place. Press Mermaidify to read it.`);
  }
});

moreList.addEventListener("click", (e) => {
  const act = (e.target as Element).closest<HTMLButtonElement>("[data-act]")?.dataset.act;
  if (!act) return;
  openMore(false);
  more.focus();
  if (act === "example") loadExample();
  if (act === "fit") pad.fitContent();
  if (act === "snap") setSnap(!snapOn);
  if (act === "outlines") showOutlines(!$<HTMLInputElement>("show-read").checked);
  if (act === "names") setNamesOn(!namesOn);
  if (act === "flowchart" || act === "state") setDiagram(act, true);
  if (act === "save-drawing") saveDrawing();
  if (act === "open-drawing") $<HTMLInputElement>("open-file").click();
});
function clearAll() {
  if (!state.strokes.length) return;
  commit([]);
  // No reading to carry names by place from; names kept against the strokes come back with an undo.
  state.reading = null;
  state.labels = {};
  tell("Cleared. Undo brings the drawing back.");
  names();
}
function loadExample() {
  const w = Math.max(320, Math.min(pad.size.w, 520));
  // A fresh start: nothing carries over from the drawing it replaces, and the example is a flowchart.
  state.reading = null;
  setDiagram("flowchart", false);
  setEdited(false);
  commit(exampleStrokes(w).map((s) => ({ id: pad.nextId(), color: s.color ?? "ink", pts: s.pts, by: "mouse" as const })));
  pad.resetView();
  pad.fitContent();
  mermaidify();
}
$("hint-example").addEventListener("click", loadExample);
$("clear").addEventListener("click", clearAll);
function stamp() {
  const d = new Date(), two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}
function saveDrawing() {
  if (!state.strokes.length) {
    tell("There is no drawing to save yet.");
    return;
  }
  if (state.stale && !state.edited) mermaidify();
  const { labels, shapes, lines, roles } = choices();
  const file = toFile(state.strokes, labels, code.value, state.edited, shapes, lines, state.diagram, roles);
  offer(`drawing-${stamp()}.json`, new Blob([JSON.stringify(file)], { type: "application/json" }));
}
$<HTMLInputElement>("open-file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement, f = input.files?.[0];
  input.value = "";
  if (!f) return;
  if (f.size > 5_000_000) {
    tell("That file is too large to be a drawing.");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await f.text());
  } catch {
    tell("That file is not a drawing: it is not JSON.");
    return;
  }
  const r = fromFile(parsed);
  if (!r.ok) {
    tell(r.error);
    return;
  }
  restore(r.file);
  tell(`Opened ${f.name}.`);
});

/** Puts a saved drawing back: its strokes, its names, and its code. */
function restore(file: NonNullable<ReturnType<typeof loadKept>>) {
  state.reading = null;
  setDiagram(file.diagram ?? "flowchart", false);
  setEdited(false);
  commit(file.strokes.map((s) => ({ id: pad.nextId(), color: s.color, pts: s.pts, by: s.by, open: s.open, zoom: s.zoom, group: s.group })));
  pad.fitContent();
  if (file.strokes.length) {
    mermaidify();
    for (const [k, v] of Object.entries(file.labels))
      if (drawnWith.has(k)) {
        state.labels[k] = v;
        remember(k, v);
      }
    for (const [k, v] of Object.entries(file.shapes ?? {})) {
      const n = state.reading!.nodes.find((x) => x.id === k);
      if (!n) continue;
      n.kind = v;
      n.unsure = false;
      rememberKind(k, v);
    }
    for (const [k, v] of Object.entries(file.lines ?? {})) {
      const e = state.reading!.edges.find((x) => x.id === k);
      if (!e) continue;
      e.style = v;
      rememberStyle(k, v);
    }
    if (state.reading!.diagram === "state") {
      for (const [k, v] of Object.entries(file.roles ?? {})) {
        const n = state.reading!.nodes.find((x) => x.id === k);
        if (!n) continue;
        n.role = v;
        rememberRole(k, v);
      }
      numberStates(state.reading!.nodes);
    } else keepRoles(file.roles ?? {});
    readLine(state.reading!);
    pad.setOverlay({ reading: state.reading!, labels: state.labels });
    names();
    writeCode();
  }
  if (file.edited || !file.strokes.length) {
    code.value = file.mermaid;
    setEdited(file.strokes.length > 0);
    draw();
  }
}

// ─── snapping and full screen ──────────────────────────────────────────────
const SNAP_KEY = "mermaidify.snap";
let snapOn = true;
try {
  snapOn = localStorage.getItem(SNAP_KEY) !== "off";
} catch {}
function setSnap(on: boolean) {
  snapOn = on;
  pad.setSnap(on);
  moreList.querySelector('[data-act="snap"]')!.setAttribute("aria-checked", String(on));
  try {
    if (on) localStorage.removeItem(SNAP_KEY);
    else localStorage.setItem(SNAP_KEY, "off");
  } catch {}
}
setSnap(snapOn);
setNamesOn(namesOn);

/**
 * Full screen gives the drawing the whole window, with the tools above it and what was read below. Where the browser
 * allows it, the browser's own bars go too; leaving the browser's full screen leaves this one.
 */
// The toolbar's height, for fitting the drawing under it on a phone on its side.
const toolbar = document.querySelector<HTMLElement>(".toolbar")!;
new ResizeObserver(() => document.documentElement.style.setProperty("--toolbar", toolbar.offsetHeight + "px")).observe(toolbar);

const full = $<HTMLButtonElement>("full");
const isFull = () => document.body.classList.contains("is-full");
/** What full screen covers: out of reach of the keyboard and of screen readers while it is on. */
const underneath = () => document.querySelectorAll<HTMLElement>(".skip, .site-header, .result, .site-footer");
function setFull(on: boolean) {
  if (isFull() === on) return;
  document.body.classList.toggle("is-full", on);
  full.setAttribute("aria-pressed", String(on));
  full.title = on ? "Leave full screen (F or Esc)" : "Full screen (F)";
  for (const el of underneath()) el.inert = on;
  openMore(false);
  closeNameEditor(true);
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
full.addEventListener("click", () => setFull(!isFull()));
// The browser's full screen follows this one: leaving it leaves this one, and one that arrives after this one was
// already left again is left too.
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) setFull(false);
  else if (!isFull()) document.exitFullscreen().catch(() => {});
});
// From full screen, "See the diagram" leaves it first, then goes to the diagram once the page is back.
$("read").addEventListener("click", (e) => {
  if (!(e.target as Element).closest(".to-result") || !isFull()) return;
  e.preventDefault();
  const go = () => $("result").scrollIntoView({ block: "start" });
  if (!document.fullscreenElement) {
    setFull(false);
    return go();
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    requestAnimationFrame(go);
  };
  document.addEventListener("fullscreenchange", once, { once: true });
  setTimeout(once, 1000);
  setFull(false);
});

// ─── keeping the drawing in this browser ───────────────────────────────────
/**
 * The names, looks, and line styles to keep, by the ids that reading the strokes as they stand gives, which is how they
 * are put back. A drawing changed since its last reading gives other ids, so it is read again here, without showing it:
 * only when it has choices to carry, and once for each change.
 */
let quiet: { strokes: DrawnStroke[]; diagram: DiagramKind; m: Reading }[] = [];
type Choices = Pick<Carried, "labels" | "shapes" | "lines" | "roles">;
function choices(): Choices {
  if (state.reading && !state.stale) {
    const shapes: Record<string, ShapeKind> = {}, lines: Record<string, LineStyle> = {}, roles: Record<string, StateRole> = {};
    const chosen = <T>(id: string, from: Map<number, T>) => [...(drawnWith.get(id) ?? [])].map((sid) => from.get(sid)).find(Boolean);
    for (const n of state.reading.nodes) {
      const kind = chosen(n.id, shapedStrokes);
      if (kind) shapes[n.id] = kind;
      const role = state.reading.diagram === "state" ? chosen(n.id, roledStrokes) : undefined;
      if (role) roles[n.id] = role;
    }
    for (const e of state.reading.edges) {
      const style = chosen(e.id, styledStrokes);
      if (style) lines[e.id] = style;
    }
    return { labels: state.labels, shapes, lines, roles: state.reading.diagram === "state" ? roles : statedRoles() };
  }
  const named = state.strokes.some(
    (s) => namedStrokes.shape.has(s.id) || namedStrokes.line.has(s.id) || shapedStrokes.has(s.id) || styledStrokes.has(s.id) || roledStrokes.has(s.id),
  );
  if (!named && !Object.values(state.labels).some((v) => v.trim())) return { labels: {}, shapes: {}, lines: {}, roles: {} };
  const { labels, shapes, lines, roles } = carry(reading(state.diagram));
  return { labels, shapes, lines, roles: state.diagram === "state" ? roles : statedRoles() };
}
/** The drawing read as it stands, without showing it: once for each change, and each kind of diagram. */
function reading(diagram: DiagramKind): Reading {
  const at = quiet.find((q) => q.diagram === diagram);
  if (at?.strokes === state.strokes) return at.m;
  const m = recognize(state.strokes, { diagram });
  quiet = [...quiet.filter((q) => q.diagram !== diagram), { strokes: state.strokes, diagram, m }];
  return m;
}
/**
 * What each shape was chosen to be in a state diagram, by the ids a state reading gives, which is how roles are put
 * back: kept while the drawing reads as a flowchart too, so they come back with State diagram.
 */
function statedRoles(): Record<string, StateRole> {
  if (!state.strokes.some((s) => roledStrokes.has(s.id))) return {};
  return carry(reading("state")).roles;
}
/** Keeps roles read from a file against the strokes of the shapes a state reading gives them, as a choice keeps them. */
function keepRoles(roles: Record<string, StateRole>) {
  if (!Object.keys(roles).length) return;
  const m = reading("state");
  for (const [k, v] of Object.entries(roles)) {
    const n = m.nodes.find((x) => x.id === k);
    if (n && n.role !== v) for (const i of n.strokes) if (state.strokes[i]) roledStrokes.set(state.strokes[i].id, v);
  }
}
let restoring = true, unkept = false;
function persist() {
  if (restoring) return;
  unkept = true;
  debounce("keep", keepNow, 500);
}
function keepNow() {
  if (!unkept) return;
  // Reading the drawing again can take a moment on a big one, so it never runs while a stroke is being drawn, unless
  // the page is going away.
  if (pad.pressing && document.visibilityState === "visible") return debounce("keep", keepNow, 500);
  unkept = false;
  clearTimeout(timers.keep);
  if (!state.strokes.length && !code.value.trim()) return keep(null);
  const { labels, shapes, lines, roles } = choices();
  keep(toFile(state.strokes, labels, code.value, state.edited, shapes, lines, state.diagram, roles));
}
// A phone may close a tab it has put away, so the last change is kept as the page goes out of sight.
addEventListener("pagehide", keepNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") keepNow();
});

// ─── keys ──────────────────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "Enter") {
    e.preventDefault();
    // In the code box it draws the code now; elsewhere it presses Mermaidify.
    if (e.target === code) draw();
    else $("go").click();
    return;
  }
  if (typing) return;
  // Escape closes an open menu first, then lets go of the chosen strokes, then puts away what was read, and only then
  // leaves full screen.
  if (e.key === "Escape" && e.defaultPrevented) return;
  if (e.key === "Escape" && menus.some((m) => m.isOpen)) for (const m of menus) m.open(false);
  else if (e.key === "Escape" && state.tool === "select" && pad.chosen.length) pad.choose([]);
  else if (e.key === "Escape" && pad.overlaid) pad.setOverlay(null);
  else if (e.key === "Escape" && isFull()) setFull(false);
  else if (e.key === " " && !mod && overPad) {
    // Space held with the pointer over the drawing moves it with a drag, as the hand does, even when a toolbar button
    // has the focus, which the key then does not press. Elsewhere Space scrolls the page and presses buttons as usual.
    e.preventDefault();
    spaceTaken = true;
    pad.setSpace(true);
  } else if (!mod && !e.altKey && e.key.toLowerCase() === "f") {
    if (!e.repeat) setFull(!isFull());
  } else if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  } else if (state.tool === "select" && mod && (["c", "x", "d"].includes(e.key.toLowerCase()) ? pad.chosen.length > 0 : e.key.toLowerCase() === "v" && !!clip)) {
    e.preventDefault();
    selAct({ c: "copy", x: "cut", v: "paste", d: "duplicate" }[e.key.toLowerCase()]!);
  } else if (state.tool === "select" && (e.key === "Delete" || e.key === "Backspace") && pad.chosen.length) {
    e.preventDefault();
    selAct("delete");
  } else if (!mod && !e.altKey && e.key.toLowerCase() === "d") setTool("draw");
  // E is the eraser that takes whole strokes, and S, or C, the one that takes only what it passes over.
  else if (!mod && !e.altKey && e.key.toLowerCase() === "e") setToolKind("eraser", "whole");
  else if (!mod && !e.altKey && (e.key.toLowerCase() === "s" || e.key.toLowerCase() === "c")) setToolKind("eraser", "part");
  else if (!mod && !e.altKey && e.key.toLowerCase() === "v") setTool("select");
  else if (!mod && !e.altKey && e.key.toLowerCase() === "h") setTool("hand");
});
/** Whether the pointer is over the drawing, where Space moves it, and whether Space was taken for that. */
let overPad = false, spaceTaken = false;
canvas.addEventListener("pointermove", () => (overPad = true));
canvas.addEventListener("pointerleave", () => (overPad = false));
document.addEventListener("keyup", (e) => {
  if (e.key !== " ") return;
  pad.setSpace(false);
  // A button presses itself as Space comes up, so a Space that moved the drawing stops here.
  if (spaceTaken) e.preventDefault();
  spaceTaken = false;
});
// Space let go where the page could not hear it, as when the window lost focus, lets go of the hand.
addEventListener("blur", () => {
  pad.setSpace(false);
  spaceTaken = false;
});

const timers: Record<string, ReturnType<typeof setTimeout>> = {};
function debounce(key: string, f: () => void, ms: number) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(f, ms);
}

// ─── start ─────────────────────────────────────────────────────────────────
// Offline: once the site has been opened, its service worker keeps every file, so it opens, draws, and reads with no
// connection.
keepOffline("./");
initChrome(() => {
  pad.repaint();
  if (code.value.trim()) draw();
});
const kept = loadKept();
if (kept && (kept.strokes.length || kept.mermaid.trim())) {
  restore(kept);
  state.undo = [];
  $<HTMLButtonElement>("undo").disabled = true;
}
restoring = false;
