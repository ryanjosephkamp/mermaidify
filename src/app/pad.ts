/**
 * The drawing surface: a canvas that takes strokes from a finger, a pen, or a mouse, erases whole strokes or cuts away
 * the parts of strokes it passes over, chooses and moves strokes, pans and zooms, and paints the names typed for shapes
 * and lines, and what the reader found, on top. Strokes are kept in drawing units, which match CSS pixels at 100%,
 * so turning the phone or resizing the window keeps the drawing as it was. A stroke held still for a moment snaps:
 * an outline becomes a clean shape and a line becomes straight, and the press goes on drawing.
 */
import { dist, halfway, pathLength, segDist, type Box, type Point } from "../reader/geometry.ts";
import type { Reading } from "../reader/recognize.ts";
import { OUTLINE, TEMPLATES } from "../reader/shapes.ts";
import { oneStrokeArrow } from "../reader/arrows.ts";
import { cleanArrow, snap } from "../reader/snap.ts";
import { around, boxOf, boxPath, lassoed, moveStrokes, moved, nearest, snapAngle, still, withKin, type Move } from "./select.ts";

export type Input = "pen" | "touch" | "mouse";
export interface DrawnStroke {
  id: number;
  color: string;
  pts: Point[];
  by: Input;
  /** What is left of a stroke after a cut: open where it was cut, so a later cut never joins its ends. */
  open?: boolean;
  /** The zoom it was drawn at, which the reader reads it at. */
  zoom?: number;
  /** Strokes grouped together are chosen together. */
  group?: number;
}
export type Tool = "draw" | "erase" | "cut" | "select" | "hand";
/** How a press on the bare drawing chooses strokes with the select tool: by a box dragged out, or by a lasso drawn. */
export type ChooseBy = "box" | "lasso";
/** A name typed for a shape or a line, shown on the drawing where the shape's middle, or the line's, is. */
export interface NameTag {
  /** The strokes the shape or the line is drawn with, by id: the name moves with them and goes when they all go. */
  strokes: number[];
  at: Point;
  text: string;
  /** How wide the name may be: a shape's width, or a set width along a line. */
  w: number;
  line: boolean;
}
/** screen = world * scale + (x, y) */
export interface View {
  scale: number;
  x: number;
  y: number;
}
export interface Overlay {
  reading: Reading;
  /** Names typed by a person, by shape or line id. */
  labels: Record<string, string>;
}

export interface PadEvents {
  /** The strokes one press drew, kept together as it lifts: any snapped shapes and lines to them, then the rest. */
  stroke(...added: DrawnStroke[]): void;
  erase(ids: number[]): void;
  /** A press with the cutting eraser: the path it swept, and how far either side of it it cuts, in drawing units. */
  cut(path: Point[], r: number): void;
  /** A press began to draw. */
  begin(): void;
  /** The chosen strokes changed. */
  select(ids: number[]): void;
  /** The chosen strokes were moved, turned, or grown: the whole drawing after it. */
  edit(next: DrawnStroke[]): void;
  /** A tap with the pen that drew nothing, in drawing units. */
  tap(p: Point): void;
  /** A tap with another tool on the bare drawing, that did nothing. */
  empty(): void;
  /** The pen was seen, or fingers were let draw again. */
  penMode(on: boolean): void;
  view(v: View): void;
}

const MIN_SCALE = 0.1, MAX_SCALE = 4;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function createPad(canvas: HTMLCanvasElement, on: PadEvents) {
  const ctx = canvas.getContext("2d")!;
  let W = 0, H = 0, queued = false;
  let strokes: DrawnStroke[] = [];
  let overlay: Overlay | null = null, showOverlay = true;
  /** The names typed for shapes and lines, shown on the drawing while what was read is not. */
  let names: NameTag[] = [], showNames = true;
  let tool: Tool = "draw", color = "ink";
  let view: View = { scale: 1, x: 0, y: 0 };
  let nextId = 1;
  /** Once a pen is seen, fingers move the drawing instead of drawing, so a resting palm draws nothing. */
  let penMode = false, lastPen = -1e9;

  const toWorld = (sx: number, sy: number): Point => [(sx - view.x) / view.scale, (sy - view.y) / view.scale];
  const local = (e: PointerEvent | WheelEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // ─── painting ────────────────────────────────────────────────────────────
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  }
  function fit() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    const changed = r.width !== W || r.height !== H;
    W = r.width;
    H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (changed && strokes.length && !contentVisible()) fitContent();
    paint();
  }
  /** Whether every stroke is on screen. */
  function contentVisible(): boolean {
    const b = bounds();
    if (!b) return true;
    const [x0, y0] = [b[0] * view.scale + view.x, b[1] * view.scale + view.y], [x1, y1] = [b[2] * view.scale + view.x, b[3] * view.scale + view.y];
    return x0 >= -2 && y0 >= -2 && x1 <= W + 2 && y1 <= H + 2;
  }
  function bounds(): [number, number, number, number] | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes)
      for (const [x, y] of s.pts) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    return x0 === Infinity ? null : [x0, y0, x1, y1];
  }
  /** Shows the whole drawing, at 100% when it fits and smaller when it does not. */
  function fitContent() {
    const b = bounds();
    if (!b || !W || !H) {
      setView({ scale: 1, x: 0, y: 0 });
      return;
    }
    const pad = 16, w = b[2] - b[0], h = b[3] - b[1];
    const scale = Math.max(MIN_SCALE, Math.min(1, (W - 2 * pad) / Math.max(w, 1), (H - 2 * pad) / Math.max(h, 1)));
    // At 100%, keep the drawing where it was drawn when it fits there; otherwise center it.
    if (scale === 1 && b[0] >= pad - 2 && b[1] >= pad - 2 && b[2] <= W - pad + 2 && b[3] <= H - pad + 2) setView({ scale: 1, x: 0, y: 0 });
    else setView({ scale, x: (W - w * scale) / 2 - b[0] * scale, y: (H - h * scale) / 2 - b[1] * scale });
  }
  function setView(v: View) {
    view = v;
    on.view(view);
    schedule();
  }
  function trace(p: readonly Point[]) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  }
  function paint() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    // The dot grid moves with the drawing, and spreads out as it zooms out so the dots stay apart.
    let step = 24;
    while (step * view.scale < 10) step *= 2;
    const gs = step * view.scale;
    ctx.fillStyle = css("--dots");
    const ox = ((view.x % gs) + gs) % gs, oy = ((view.y % gs) + gs) % gs, r = Math.max(0.6, Math.min(1, view.scale));
    for (let x = ox; x < W; x += gs) for (let y = oy; y < H; y += gs) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Ink thins a little as the drawing zooms out, and never below a pixel and a bit.
    const width = Math.max(3 / Math.sqrt(view.scale), 1.3 / view.scale);
    const reading = overlay && showOverlay ? overlay.reading : null;
    // Under the ink: each line read as an arrow glows the accent color, and each mark left out the warning color.
    if (reading) {
      ctx.save();
      ctx.lineWidth = width + 8 / view.scale;
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = css("--accent");
      for (const e of reading.edges)
        for (const i of e.strokes) {
          if (!strokes[i]) continue;
          trace(strokes[i].pts);
          ctx.stroke();
        }
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = css("--warning");
      for (const i of reading.unused) {
        if (!strokes[i]) continue;
        trace(strokes[i].pts);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Chosen strokes glow, and while they are moved they are drawn where they are going.
    const shown = (s: DrawnStroke) => (grab && chosen.has(s.id) ? s.pts.map((p) => moved(p, grab!.m)) : s.pts);
    if (chosen.size && tool === "select") {
      ctx.save();
      ctx.lineWidth = width + 6 / view.scale;
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = css("--accent");
      for (const s of strokes)
        if (chosen.has(s.id)) {
          trace(shown(s));
          ctx.stroke();
        }
      ctx.restore();
    }
    ctx.lineWidth = width;
    for (const s of strokes) {
      ctx.globalAlpha = erasing.has(s.id) ? 0.2 : 1;
      ctx.strokeStyle = css("--draw-" + s.color) || css("--draw-ink");
      trace(shown(s));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The box or the lasso being drawn, dashed, with a faint wash inside so what it takes in shows.
    if (lasso && (chooseBy === "lasso" || lasso.length > 1)) {
      ctx.save();
      ctx.lineWidth = 1.5 / view.scale;
      ctx.setLineDash([5 / view.scale, 4 / view.scale]);
      ctx.strokeStyle = ctx.fillStyle = css("--accent");
      ctx.beginPath();
      if (chooseBy === "box") {
        const [a, b] = [lasso[0], lasso[lasso.length - 1]];
        ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      } else {
        trace(lasso);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.globalAlpha = 0.06;
      ctx.fill();
      ctx.restore();
    }
    // The cutting eraser's path, as wide as it cuts: what it covers goes as it lifts.
    if (cutting) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = css("--error");
      ctx.lineWidth = (2 * ERASE_R) / view.scale;
      trace(cutting);
      ctx.stroke();
      ctx.restore();
    }
    for (const s of [...(drawing?.done ?? []), ...(current ? [current] : [])]) {
      ctx.strokeStyle = css("--draw-" + s.color);
      trace(s.pts);
      ctx.stroke();
    }
    if (reading && overlay && !grab) paintReading(reading, overlay.labels);
    else if (!reading && showNames) paintNames();
    ctx.restore();
    paintChosen();
    if (eraserAt && (tool === "erase" || tool === "cut")) {
      ctx.save();
      ctx.strokeStyle = css("--ink-3");
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(eraserAt[0], eraserAt[1], ERASE_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  /**
   * Each name typed, in the ink of its strokes and the size of the drawing: a shape's in its middle, and a line's on a
   * patch of the page halfway along it. Names too small to read at this zoom are left out.
   */
  function paintNames() {
    const size = 14;
    if (!names.length || size * view.scale < 7) return;
    const live = new Map(strokes.map((s) => [s.id, s]));
    ctx.save();
    ctx.font = `600 ${size}px ${css("--font")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const t of names) {
      const own = t.strokes.flatMap((id) => live.get(id) ?? []);
      if (!own.length) continue;
      const at = grab && own.some((s) => chosen.has(s.id)) ? moved(t.at, grab.m) : t.at, max = Math.max(40, t.w - 12);
      let text = t.text;
      while (text.length > 1 && ctx.measureText(text).width > max) text = text.slice(0, -2) + "…";
      if (t.line) {
        const w = ctx.measureText(text).width + 10;
        ctx.fillStyle = css("--surface");
        ctx.beginPath();
        ctx.roundRect(at[0] - w / 2, at[1] - 10, w, 20, 6);
        ctx.fill();
      }
      ctx.fillStyle = css("--draw-" + own[0].color) || css("--draw-ink");
      ctx.fillText(text, at[0], at[1] + 0.5);
    }
    ctx.restore();
  }
  function outline(kind: keyof typeof OUTLINE, bb: { cx: number; cy: number; w: number; h: number }, k = 1) {
    const w = bb.w * k, h = bb.h * k, x0 = bb.cx - w / 2, y0 = bb.cy - h / 2, t = OUTLINE[kind];
    ctx.beginPath();
    if (t === "ellipse") ctx.ellipse(bb.cx, bb.cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    else {
      TEMPLATES[t].forEach(([u, v], i) => (i ? ctx.lineTo(x0 + u * w, y0 + v * h) : ctx.moveTo(x0 + u * w, y0 + v * h)));
      ctx.closePath();
    }
    ctx.stroke();
  }
  function paintReading(m: Reading, labels: Record<string, string>) {
    const px = 1 / view.scale, accent = css("--accent");
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 5 * px]);
    ctx.strokeStyle = accent;
    for (const s of [...m.groups, ...m.nodes]) {
      outline(s.kind, s.bb);
      if (s.kind === "double") outline("circle", s.bb, 0.64);
      if (s.kind === "subroutine") outline("rect", s.bb, 0.8);
    }
    ctx.setLineDash([]);
    // A line drawn with no head points the way it was drawn: a small chevron shows which way that was.
    ctx.lineWidth = 2 * px;
    for (const e of m.edges) {
      if (!e.assumed || e.pts.length < 2) continue;
      const end = e.pts[e.pts.length - 1];
      let k = e.pts.length - 2;
      while (k > 0 && dist(e.pts[k], end) < 10 * px) k--;
      const a = Math.atan2(end[1] - e.pts[k][1], end[0] - e.pts[k][0]), L = 9 * px;
      ctx.beginPath();
      ctx.moveTo(end[0] - L * Math.cos(a - 0.5), end[1] - L * Math.sin(a - 0.5));
      ctx.lineTo(end[0], end[1]);
      ctx.lineTo(end[0] - L * Math.cos(a + 0.5), end[1] - L * Math.sin(a + 0.5));
      ctx.stroke();
    }
    ctx.textBaseline = "middle";
    // Each line's name, on a patch of the drawing's own color halfway along it.
    for (const e of m.edges) {
      const name = labels[e.id]?.trim();
      if (!name || e.pts.length < 2) continue;
      ctx.font = `600 ${12 * px}px ${css("--font")}`;
      let text = name;
      while (text.length > 1 && ctx.measureText(text).width > 160 * px) text = text.slice(0, -2) + "…";
      const [x, y] = halfway(e.pts), w = ctx.measureText(text).width + 12 * px;
      ctx.fillStyle = css("--surface");
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 10 * px, w, 20 * px, 6 * px);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = css("--ink");
      ctx.textAlign = "center";
      ctx.fillText(text, x, y + 0.5 * px);
      ctx.textAlign = "start";
    }
    // Each shape's id, and the name typed for it. A state diagram's start or end has neither.
    for (const s of [...m.groups, ...m.nodes]) {
      if (s.role === "dot") continue;
      ctx.font = `600 ${11 * px}px ${css("--mono")}`;
      const w = ctx.measureText(s.id).width + 10 * px, x = s.bb.x0 - 4 * px, y = s.bb.y0 - 9 * px;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 18 * px, 5 * px);
      ctx.fill();
      ctx.fillStyle = css("--accent-ink");
      ctx.fillText(s.id, x + 5 * px, y + 9.5 * px);
      // Mermaid gives a choice no name, so neither does the drawing.
      const name = s.role === "choice" ? undefined : labels[s.id]?.trim();
      if (name) {
        ctx.font = `600 ${13 * px}px ${css("--font")}`;
        ctx.fillStyle = css("--ink");
        ctx.textAlign = "center";
        const max = Math.max(40 * px, s.bb.w - 12 * px);
        let text = name;
        while (text.length > 1 && ctx.measureText(text).width > max) text = text.slice(0, -2) + "…";
        const ty = m.groups.includes(s) ? s.bb.y0 + 14 * px : s.bb.cy;
        ctx.fillText(text, s.bb.cx, ty);
        ctx.textAlign = "start";
      }
    }
  }

  // ─── input ───────────────────────────────────────────────────────────────
  const ERASE_R = 14;
  let current: DrawnStroke | null = null;
  let drawing: {
    id: number;
    by: string;
    start: number;
    moved: number;
    at: [number, number];
    last: [number, number];
    /** Where the pointer was when it last moved enough to count, for telling a hold from a slow stroke. */
    still: [number, number];
    /** Where a line may be straightened from: the end of the part straightened last. */
    anchor: number;
    /** The shape snapped last in this press, if any. */
    snapped: Box | null;
    /** Strokes this press finished by snapping: kept when it lifts, and dropped with it if it is canceled. */
    done: DrawnStroke[];
    /** An arrow snapped clean, which the press now aims: its tail, its tip when it snapped, and where the press was then. */
    aim?: { before: Point[]; tail: Point; tip: Point; from: Point };
  } | null = null;
  const erasing = new Set<number>();
  let eraseId: number | null = null, eraserAt: [number, number] | null = null;
  /** The path a cutting press has swept so far, in drawing units. */
  let cutting: Point[] | null = null;
  /** What an erasing or cutting press is made with, and where on the screen it began. */
  let eraseBy = "", eraseFrom: [number, number] = [0, 0];
  const touches = new Map<number, [number, number]>();
  let gesture: { d: number; c: [number, number]; view: View } | null = null;
  /** A press that moves the drawing: the mouse's middle button, or a mouse or a pen with the hand or with Space held. */
  let mousePan: { id: number; at: [number, number]; view: View } | null = null;
  /** Space is held: a press moves the drawing, as the hand does. */
  let spaceHeld = false;

  // The pen's eraser end (32) or its side button (2) erases too, whole strokes whichever eraser is chosen.
  const penErases = (e: PointerEvent) => e.pointerType === "pen" && (e.buttons & 34) !== 0;
  const isEraser = (e: PointerEvent) => tool === "erase" || tool === "cut" || penErases(e);
  function erase(at: [number, number]) {
    const w = toWorld(at[0], at[1]), r = ERASE_R / view.scale;
    for (const s of strokes) {
      if (erasing.has(s.id)) continue;
      const p = s.pts;
      for (let i = 0; i < p.length; i++)
        if ((p.length === 1 ? dist(w, p[0]) : segDist(w, p[i], p[Math.min(i + 1, p.length - 1)])) <= r) {
          erasing.add(s.id);
          break;
        }
    }
  }
  function startGesture() {
    const pts = [...touches.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = { d: Math.max(1, dist(a, b)), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: { ...view } };
    } else if (pts.length === 1) gesture = { d: 0, c: pts[0], view: { ...view } };
    else gesture = null;
  }
  function moveGesture() {
    if (!gesture) return;
    const pts = [...touches.values()];
    if (gesture.d && pts.length >= 2) {
      const [a, b] = pts, c: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (gesture.view.scale * dist(a, b)) / gesture.d));
      // The point under the fingers' center stays under it.
      const wx = (gesture.c[0] - gesture.view.x) / gesture.view.scale, wy = (gesture.c[1] - gesture.view.y) / gesture.view.scale;
      setView({ scale, x: c[0] - wx * scale, y: c[1] - wy * scale });
    } else if (!gesture.d && pts.length === 1) {
      setView({ scale: gesture.view.scale, x: gesture.view.x + pts[0][0] - gesture.c[0], y: gesture.view.y + pts[0][1] - gesture.c[1] });
    }
  }
  function cancelStroke() {
    clearTimeout(holdTimer);
    current = null;
    drawing = null;
  }

  // ─── holding to snap ─────────────────────────────────────────────────────
  const HOLD_MS = 500;
  let snapOn = true, holdTimer: ReturnType<typeof setTimeout> | undefined;
  function armHold() {
    clearTimeout(holdTimer);
    if (snapOn && tool === "draw") holdTimer = setTimeout(holdSnap, HOLD_MS);
  }
  /**
   * The stroke was held still. Its end becomes a clean shape, a stroke of its own, and the press goes on as a new
   * stroke, so a second shape can be drawn inside the first without lifting. Or its last part becomes a straight
   * line, and the stroke goes on from the line's end.
   */
  function holdSnap() {
    const d = drawing, s = current;
    if (!d || !s || d.aim) return;
    // An arrow drawn in one stroke, its head last, open or a closed triangle, and its line fairly straight, becomes a
    // clean arrow that the press goes on to aim. It is judged at the size it has on screen, as the reader judges it.
    const k = s.zoom ?? 1, a = oneStrokeArrow(s.pts.slice(d.anchor).map((p): Point => [p[0] * k, p[1] * k]));
    if (a) {
      const tail: Point = [a.tail[0] / k, a.tail[1] / k], tip: Point = [a.tip[0] / k, a.tip[1] / k];
      d.aim = { before: s.pts.slice(0, d.anchor), tail, tip, from: s.pts[s.pts.length - 1] };
      s.pts = [...d.aim.before, ...cleanArrow(tail, tip, view.scale)];
      try {
        navigator.vibrate?.(12);
      } catch {}
      schedule();
      return;
    }
    const r = snap(s.pts, d.anchor, s.zoom);
    if (!r) return;
    if (r.kind === "line") {
      s.pts = [...s.pts.slice(0, r.from), ...r.pts];
      d.anchor = s.pts.length - 1;
    } else {
      // What led to the shape stays as a line, unless it only crossed the shape snapped before it or this one.
      const lead = s.pts.slice(0, r.from + 1);
      const m = 4 / view.scale, near = (p: Point) => [d.snapped, r.box].some((b) => b && p[0] >= b.x0 - m && p[0] <= b.x1 + m && p[1] >= b.y0 - m && p[1] <= b.y1 + m);
      if (pathLength(lead) * view.scale >= 12 && !lead.every(near)) d.done.push({ id: nextId++, color: s.color, pts: lead, by: s.by, zoom: s.zoom });
      d.done.push({ id: nextId++, color: s.color, pts: r.pts, by: s.by, zoom: s.zoom });
      current = { id: 0, color: s.color, pts: [s.pts[s.pts.length - 1]], by: s.by, zoom: s.zoom };
      d.anchor = 0;
      d.snapped = r.box;
    }
    try {
      navigator.vibrate?.(12);
    } catch {}
    schedule();
  }

  // ─── choosing and moving strokes ─────────────────────────────────────────
  let chosen = new Set<number>();
  let chooseBy: ChooseBy = "box";
  /** The box or the lasso being drawn, in drawing units: a box's first corner and where the press is, or the lasso's path. */
  let lasso: Point[] | null = null;
  /**
   * A press with the select tool, and how far it has gone on screen. `adding` keeps what was chosen before it, with
   * Shift, or Command on a Mac and Ctrl elsewhere; `took` is the stroke it landed on, with its kin, and whether they
   * were chosen already.
   */
  let selPress: {
    id: number;
    by: string;
    at: [number, number];
    last: [number, number];
    moved: number;
    adding: boolean;
    took?: { ids: Set<number>; was: boolean };
  } | null = null;
  /** The chosen strokes being moved, turned about their middle, or grown from their top left corner. */
  let grab: { mode: "move" | "turn" | "grow"; box: Box; from: Point; m: Move } | null = null;
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const screenOf = (p: Point): [number, number] => [p[0] * view.scale + view.x, p[1] * view.scale + view.y];
  /** The chosen strokes' box on screen, with a margin; the knob above it turns them, the one at its corner grows them. */
  function knobs() {
    const b = boxOf(strokes, chosen);
    if (!b) return null;
    const [x0, y0] = screenOf([b.x0, b.y0]), [x1, y1] = screenOf([b.x1, b.y1]), m = 8;
    return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m, turn: [(x0 + x1) / 2, y0 - m - 26] as [number, number], grow: [x1 + m, y1 + m] as [number, number] };
  }
  function paintChosen() {
    const k = knobs();
    if (!k || tool !== "select") return;
    const at = (q: [number, number]) => (grab ? screenOf(moved(toWorld(q[0], q[1]), grab.m)) : q);
    const corners = ([[k.x0, k.y0], [k.x1, k.y0], [k.x1, k.y1], [k.x0, k.y1]] as [number, number][]).map(at);
    ctx.save();
    ctx.strokeStyle = css("--accent");
    ctx.fillStyle = css("--surface");
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    corners.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    const top = at([(k.x0 + k.x1) / 2, k.y0]), turn = at(k.turn), grow = at(k.grow);
    ctx.beginPath();
    ctx.moveTo(top[0], top[1]);
    ctx.lineTo(turn[0], turn[1]);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(turn[0], turn[1], 7, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(grow[0] - 6, grow[1] - 6, 12, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function startChoose(e: PointerEvent, at: [number, number]) {
    const adding = e.shiftKey || (mac ? e.metaKey : e.ctrlKey);
    const p = (selPress = { id: e.pointerId, by: e.pointerType, at, last: at, moved: 0, adding } as NonNullable<typeof selPress>);
    const k = knobs(), b = boxOf(strokes, chosen), w = toWorld(at[0], at[1]), r = e.pointerType === "touch" ? 22 : 14;
    const moveFrom = (box: Box) => (grab = { mode: "move", box, from: w, m: still((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2) });
    const inBox = !!k && at[0] >= k.x0 && at[0] <= k.x1 && at[1] >= k.y0 && at[1] <= k.y1;
    if (k && b && !adding) {
      if (dist(at, k.turn) <= r) grab = { mode: "turn", box: b, from: w, m: still((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) };
      else if (dist(at, k.grow) <= r) grab = { mode: "grow", box: b, from: w, m: still(b.x0, b.y0) };
    }
    if (!grab) {
      // A press on a stroke takes it, with its kin, and moves at once: with Shift or Command they join what is chosen.
      // Within the chosen strokes' box, a press on no stroke moves them all; inside a closed stroke, it takes that one.
      const reach = (e.pointerType === "touch" ? 14 : 8) / view.scale;
      // With Shift or Command, a press inside a shape waits: a tap adds it, and a drag draws a box.
      const hit = nearest(strokes, w, reach) ?? (inBox || adding ? null : around(strokes, w));
      if (hit !== null) {
        const ids = withKin(strokes, [hit]), was = [...ids].every((id) => chosen.has(id));
        p.took = { ids, was };
        if (!was) {
          chosen = adding ? new Set([...chosen, ...ids]) : ids;
          on.select([...chosen]);
        }
        moveFrom(boxOf(strokes, chosen)!);
      } else if (inBox && b && !adding) moveFrom(b);
    }
    if (!grab) lasso = [w];
    schedule();
  }
  function moveChoose(at: [number, number]) {
    const p = selPress!, w = toWorld(at[0], at[1]);
    p.moved = Math.max(p.moved, dist(at, p.at));
    p.last = at;
    if (lasso && chooseBy === "box") lasso = [lasso[0], w];
    else if (lasso && dist(w, lasso[lasso.length - 1]) * view.scale >= 2) lasso.push(w);
    else if (grab) {
      const g = grab, b = g.box;
      if (g.mode === "move") g.m = { ...g.m, dx: w[0] - g.from[0], dy: w[1] - g.from[1] };
      else if (g.mode === "turn") {
        const turned = Math.atan2(w[1] - g.m.cy, w[0] - g.m.cx) - Math.atan2(g.from[1] - g.m.cy, g.from[0] - g.m.cx);
        g.m = { ...g.m, angle: snapAngle(turned) };
      } else {
        const from = dist(g.from, [b.x0, b.y0]);
        if (from > 0) g.m = { ...g.m, scale: Math.max(0.2, Math.min(5, dist(w, [b.x0, b.y0]) / from)) };
      }
    }
    schedule();
  }
  function finishChoose(keep: boolean) {
    const p = selPress!, l = lasso, g = grab;
    selPress = null;
    lasso = null;
    grab = null;
    const tap = p.moved < 4;
    if (keep && l) {
      // A tap on the bare drawing lets go of everything; with Shift or Command, a tap inside a shape adds it, or lets
      // it go. A box or a lasso takes every stroke it reaches into.
      let found = tap ? new Set<number>() : lassoed(strokes, chooseBy === "box" ? boxPath(l[0], l[l.length - 1]) : l);
      const inside = tap && p.adding ? around(strokes, l[0]) : null;
      if (inside !== null) {
        found = withKin(strokes, [inside]);
        if ([...found].every((id) => chosen.has(id))) {
          chosen = new Set([...chosen].filter((id) => !found.has(id)));
          found = new Set();
        }
      }
      if (tap && !p.adding) on.empty();
      chosen = p.adding ? new Set([...chosen, ...found]) : found;
      on.select([...chosen]);
    } else if (keep && g && !tap && (g.m.dx || g.m.dy || g.m.angle || g.m.scale !== 1)) {
      // The names of what moved go with it at once, until the next reading places them.
      names = names.map((t) => (t.strokes.some((id) => chosen.has(id)) ? { ...t, at: moved(t.at, g.m) } : t));
      on.edit(moveStrokes(strokes, chosen, g.m));
    }
    else if (keep && tap && p.took?.was) {
      // A tap on a chosen stroke: with Shift or Command it is let go, and otherwise it alone stays chosen.
      const ids = p.took.ids;
      chosen = p.adding ? new Set([...chosen].filter((id) => !ids.has(id))) : ids;
      on.select([...chosen]);
    }
    schedule();
  }

  canvas.addEventListener("pointerdown", (e) => {
    const at = local(e);
    lastType = e.pointerType;
    if (e.pointerType === "pen") {
      lastPen = e.timeStamp;
      if (!penMode) {
        penMode = true;
        on.penMode(true);
      }
      // A hand that touched down first was a palm: it stops moving the drawing, and a stroke, a lasso, or a move it
      // started is dropped.
      if (touches.size) {
        touches.clear();
        gesture = null;
      }
      if (drawing && drawing.by === "touch") {
        cancelStroke();
        schedule();
      }
      if (selPress && selPress.by === "touch") {
        selPress = lasso = grab = null;
        schedule();
      }
    }
    if (e.pointerType === "touch") {
      // While the pen is in use, a touch is a palm. In pen mode fingers move the drawing; otherwise a second finger
      // turns a stroke, an erase, or a cut that has barely started into a pinch, and is ignored once it is under way.
      if (e.timeStamp - lastPen < 600) return;
      const join = () => {
        touches.set(e.pointerId, at);
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {}
        startGesture();
        e.preventDefault();
      };
      // With the hand, one finger moves the drawing too.
      if (penMode || touches.size || tool === "hand") return join();
      if (eraseId !== null && eraseBy === "touch") {
        const was = eraserAt ?? eraseFrom;
        if (dist(was, eraseFrom) > 14) return;
        touches.set(eraseId, was);
        eraseId = null;
        eraserAt = null;
        erasing.clear();
        cutting = null;
        schedule();
        return join();
      }
      if (drawing && drawing.by === "touch") {
        if (drawing.moved > 14) return;
        touches.set(drawing.id, drawing.last);
        cancelStroke();
        schedule();
        return join();
      }
      if (selPress && selPress.by === "touch") {
        if (selPress.moved > 14) return;
        touches.set(selPress.id, selPress.last);
        selPress = lasso = grab = null;
        schedule();
        return join();
      }
    }
    if ((e.pointerType === "mouse" && e.button === 1) || (e.button === 0 && (tool === "hand" || spaceHeld) && !drawing && eraseId === null && !selPress)) {
      mousePan = { id: e.pointerId, at, view: { ...view } };
      canvas.dataset.panning = "";
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if ((e.pointerType === "mouse" && e.button !== 0) || drawing || eraseId !== null || selPress) return;
    ctrlPress = e.pointerType === "mouse" && e.ctrlKey;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
    if (isEraser(e)) {
      eraseId = e.pointerId;
      eraseBy = e.pointerType;
      eraseFrom = at;
      eraserAt = at;
      if (tool === "cut" && !penErases(e)) cutting = [toWorld(at[0], at[1])];
      else erase(at);
      schedule();
      return;
    }
    if (tool === "select") {
      startChoose(e, at);
      return;
    }
    drawing = { id: e.pointerId, by: e.pointerType, start: e.timeStamp, moved: 0, at, last: at, still: at, anchor: 0, snapped: null, done: [] };
    current = { id: 0, color, pts: [toWorld(at[0], at[1])], by: e.pointerType as Input, zoom: view.scale };
    on.begin();
    armHold();
    schedule();
  });

  canvas.addEventListener("pointermove", (e) => {
    const at = local(e);
    if (e.pointerType === "pen") lastPen = e.timeStamp;
    if (e.pointerType === "pen" && !penMode && e.buttons === 0) {
      // A pen hovering over the screen counts too, so the first stroke is already safe from the palm.
      penMode = true;
      on.penMode(true);
    }
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, at);
      // While the pen is in use, a hand on the screen moves nothing.
      if (e.timeStamp - lastPen >= 600) moveGesture();
      return;
    }
    if (mousePan && mousePan.id === e.pointerId) {
      if (e.buttons === 0) {
        mousePan = null;
        delete canvas.dataset.panning;
        return;
      }
      setView({ scale: mousePan.view.scale, x: mousePan.view.x + at[0] - mousePan.at[0], y: mousePan.view.y + at[1] - mousePan.at[1] });
      return;
    }
    // A mouse that moves with no button down has been let go where the canvas could not hear it, so the press ends.
    if (e.pointerType === "mouse" && e.buttons === 0 && (eraseId === e.pointerId || drawing?.id === e.pointerId || selPress?.id === e.pointerId)) finish(e, true);
    if ((tool === "erase" || tool === "cut") && e.pointerType === "mouse") {
      eraserAt = at;
      schedule();
    }
    // With the select tool, a mouse over a stroke shows that a press there moves it.
    if (tool === "select" && e.pointerType === "mouse" && !selPress) {
      const w = toWorld(at[0], at[1]), over = nearest(strokes, w, 8 / view.scale) !== null;
      if (over !== "over" in canvas.dataset) {
        if (over) canvas.dataset.over = "";
        else delete canvas.dataset.over;
      }
    }
    if (eraseId === e.pointerId) {
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) {
        const q = local(ev);
        if (!cutting) erase(q);
        // Every screen pixel or so is enough to cut along.
        else if (dist(toWorld(q[0], q[1]), cutting[cutting.length - 1]) * view.scale >= 1) cutting.push(toWorld(q[0], q[1]));
      }
      eraserAt = at;
      schedule();
      return;
    }
    if (selPress && selPress.id === e.pointerId) {
      moveChoose(at);
      return;
    }
    if (!drawing || drawing.id !== e.pointerId || !current) return;
    // A snapped arrow's tip follows the press, and its head turns to point the way the arrow now goes.
    if (drawing.aim) {
      const a = drawing.aim, p = toWorld(at[0], at[1]), tip: Point = [a.tip[0] + p[0] - a.from[0], a.tip[1] + p[1] - a.from[1]];
      if (dist(a.tail, tip) * view.scale >= 12) current.pts = [...a.before, ...cleanArrow(a.tail, tip, view.scale)];
      drawing.moved = Math.max(drawing.moved, dist(at, drawing.at));
      schedule();
      return;
    }
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      const s = local(ev), p = toWorld(s[0], s[1]), q = current.pts[current.pts.length - 1];
      drawing.moved = Math.max(drawing.moved, dist(s, drawing.at));
      drawing.last = s;
      if (dist(p, q) * view.scale >= 1.5) current.pts.push(p);
    }
    // A hand holding still trembles a little; a finger more than a pen.
    if (dist(at, drawing.still) > (drawing.by === "touch" ? 6 : 4)) {
      drawing.still = at;
      armHold();
    }
    schedule();
  });

  function finish(e: PointerEvent, keep: boolean) {
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      startGesture();
      return;
    }
    if (mousePan && mousePan.id === e.pointerId) {
      if (keep && dist(local(e), mousePan.at) < 4) on.empty();
      mousePan = null;
      delete canvas.dataset.panning;
      return;
    }
    if (eraseId === e.pointerId) {
      eraseId = null;
      if (e.pointerType !== "mouse") eraserAt = null;
      if (keep && erasing.size) on.erase([...erasing]);
      else if (keep && !cutting && dist(local(e), eraseFrom) < 4) on.empty();
      if (keep && cutting) on.cut(cutting, ERASE_R / view.scale);
      erasing.clear();
      cutting = null;
      schedule();
      return;
    }
    if (selPress && selPress.id === e.pointerId) {
      finishChoose(keep);
      return;
    }
    if (!drawing || drawing.id !== e.pointerId) return;
    const s = current, d = drawing;
    cancelStroke();
    if (keep && s) {
      const at = local(e);
      d.moved = Math.max(d.moved, dist(at, d.at));
      // After a snap, what is left of the press is a stroke if it went anywhere, and never a tap.
      if (d.snapped) {
        if (pathLength(s.pts) * view.scale >= 10) d.done.push({ ...s, id: nextId++ });
        on.stroke(...d.done);
      } else if (d.moved < 6 && e.timeStamp - d.start < 500 && pathLength(s.pts) * view.scale < 8) on.tap(s.pts[0]);
      else {
        s.id = nextId++;
        on.stroke(s);
      }
    }
    schedule();
  }
  canvas.addEventListener("pointerup", (e) => finish(e, true));
  // Holding still is how a shape snaps, so a long press with a finger or a pen must not open the browser's menu for the
  // canvas. A mouse's right button still does, unless a stroke or an erase is under way, which the menu would cut off.
  // On a Mac, Ctrl and a click is the right button: the menu opens, and the press it began draws and erases nothing.
  let lastType = "mouse", ctrlPress = false;
  canvas.addEventListener("contextmenu", (e) => {
    if (lastType === "mouse" && ctrlPress && (drawing || eraseId !== null || selPress)) {
      cancelStroke();
      eraseId = null;
      erasing.clear();
      cutting = null;
      selPress = lasso = grab = null;
      schedule();
      return;
    }
    if (lastType !== "mouse" || drawing || eraseId !== null || selPress) e.preventDefault();
  });
  canvas.addEventListener("pointercancel", (e) => finish(e, false));
  // A select press whose pointer is taken away without lifting moves nothing.
  canvas.addEventListener("lostpointercapture", (e) => {
    if (selPress?.id !== e.pointerId) return;
    selPress = lasso = grab = null;
    schedule();
  });
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && eraseId === null) {
      eraserAt = null;
      schedule();
    }
  });
  // Over the drawing, the wheel zooms about the pointer, up to come closer and down to go back, as a pinch on a
  // trackpad does; a scroll to the side moves the drawing sideways.
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1, dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
        setView({ ...view, x: view.x - dx });
        return;
      }
      // A pinch sends small steps, and a wheel's notch a large one.
      const [sx, sy] = local(e), scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002))));
      const wx = (sx - view.x) / view.scale, wy = (sy - view.y) / view.scale;
      setView({ scale, x: sx - wx * scale, y: sy - wy * scale });
    },
    { passive: false },
  );
  new ResizeObserver(() => fit()).observe(canvas);

  return {
    setStrokes(list: DrawnStroke[]) {
      strokes = list;
      const ids = new Set(list.map((s) => s.id));
      chosen = new Set([...chosen].filter((id) => ids.has(id)));
      for (const s of list) if (s.id >= nextId) nextId = s.id + 1;
      schedule();
    },
    setOverlay(o: Overlay | null) {
      overlay = o;
      // Marked on the drawing, so the page and its tests can tell whether what was read is there.
      if (o) canvas.dataset.read = "";
      else delete canvas.dataset.read;
      schedule();
    },
    setShowOverlay(on: boolean) {
      showOverlay = on;
      schedule();
    },
    /** Whether what was read is on the drawing now. */
    get overlaid() {
      return !!overlay && showOverlay;
    },
    setNames(list: NameTag[]) {
      names = list;
      schedule();
    },
    setShowNames(on: boolean) {
      showNames = on;
      schedule();
    },
    setTool(t: Tool) {
      tool = t;
      if (t !== "erase" && t !== "cut") eraserAt = null;
      delete canvas.dataset.over;
      if (t !== "select" && chosen.size) {
        chosen = new Set();
        on.select([]);
      }
      canvas.dataset.tool = t;
      schedule();
    },
    setColor(c: string) {
      color = c;
    },
    setChooseBy(by: ChooseBy) {
      chooseBy = by;
    },
    /** Space is held or let go: while it is held, a press moves the drawing. */
    setSpace(on: boolean) {
      spaceHeld = on;
      if (on) canvas.dataset.space = "";
      else delete canvas.dataset.space;
    },
    setPenMode(on: boolean) {
      penMode = on;
    },
    /** Whether holding a stroke still snaps it. */
    setSnap(on: boolean) {
      snapOn = on;
      if (!on) clearTimeout(holdTimer);
    },
    fitContent,
    resetView: () => setView({ scale: 1, x: 0, y: 0 }),
    /** A stroke, an erase, a pinch, or a pan is under way. */
    get pressing() {
      return !!drawing || eraseId !== null || touches.size > 0 || !!mousePan || !!selPress;
    },
    /** The chosen strokes' ids. */
    get chosen() {
      return [...chosen];
    },
    choose(ids: Iterable<number>) {
      chosen = new Set(ids);
      on.select([...chosen]);
      schedule();
    },
    /** The chosen strokes' box on screen, with its knobs, or null. */
    chosenBox: knobs,
    get view() {
      return view;
    },
    /** The drawing's size on screen, in drawing units. */
    get size() {
      return { w: W / view.scale, h: H / view.scale };
    },
    toScreen: (p: Point): [number, number] => [p[0] * view.scale + view.x, p[1] * view.scale + view.y],
    nextId: () => nextId++,
    repaint: schedule,
  };
}
export type Pad = ReturnType<typeof createPad>;
