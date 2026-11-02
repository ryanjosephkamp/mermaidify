/**
 * Shapes to add without drawing them, and whole diagrams to start from. Both are clean strokes, drawn the way a person
 * draws them, so the reader reads them like anything drawn by hand, and they can be moved, cut, and drawn over.
 * Every size is in drawing units, as the drawing is at 100%.
 */
import { bbox, densify, type Box, type Point } from "../reader/geometry.ts";
import type { DiagramKind } from "../reader/recognize.ts";
import { cleanOutline } from "../reader/snap.ts";
import type { OutlineKind } from "../reader/shapes.ts";

/** One stroke to add, with the name of the shape or the line it draws, if it has one. */
export interface Part {
  pts: Point[];
  name?: string;
  /** The name is the line's, not a shape's. */
  line?: boolean;
}

export type AddKind = OutlineKind | "dot" | "bullseye";
/** The shapes the Add menu offers, in its order, each at a size that holds a short name. */
export const ADDABLE: { kind: AddKind; label: string; w: number; h: number }[] = [
  { kind: "rect", label: "Box", w: 140, h: 64 },
  { kind: "stadium", label: "Oval", w: 140, h: 60 },
  { kind: "circle", label: "Circle", w: 80, h: 80 },
  { kind: "diamond", label: "Diamond", w: 120, h: 92 },
  { kind: "hexagon", label: "Hexagon", w: 150, h: 64 },
  { kind: "lean-right", label: "Parallelogram", w: 150, h: 64 },
  { kind: "trapezoid", label: "Trapezoid", w: 150, h: 64 },
  { kind: "triangle", label: "Triangle", w: 110, h: 92 },
  { kind: "dot", label: "Start dot", w: 30, h: 30 },
  { kind: "bullseye", label: "End ring", w: 42, h: 42 },
];

const box = (cx: number, cy: number, w: number, h: number): Box => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, w, h, cx, cy });

/** A dot filled in: around its edge, a spiral in to its middle, and straight back out to where it began. */
function filledDot(cx: number, cy: number, r: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= 32; i++) out.push([cx + r * Math.cos(-Math.PI / 2 + (i / 32) * 2 * Math.PI), cy + r * Math.sin(-Math.PI / 2 + (i / 32) * 2 * Math.PI)]);
  const turns = Math.max(2, Math.round(r / 2.5));
  for (let i = 0; i <= turns * 24; i++) {
    const t = i / (turns * 24), rr = r * (1 - t), a = -Math.PI / 2 + t * turns * 2 * Math.PI;
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return densify([...out, [cx, cy - r]], 2);
}

/** The strokes of one shape of a kind, centered on (cx, cy). */
export function shapeParts(kind: AddKind, cx: number, cy: number, w: number, h: number, name?: string): Part[] {
  if (kind === "dot") return [{ pts: filledDot(cx, cy, w / 2) }];
  if (kind === "bullseye") return [{ pts: cleanOutline("circle", box(cx, cy, w, h)) }, { pts: filledDot(cx, cy, w * 0.22) }];
  return [{ pts: cleanOutline(kind, box(cx, cy, w, h)), name }];
}

/** An arrow along a path, its head at the last point: one barb out and back through the tip, then the other. */
function arrow(path: Point[], name?: string): Part {
  const line = densify(path, 3), tip = line[line.length - 1], from = path[path.length - 2];
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]), b = 14;
  const barb = (s: number): Point => [tip[0] - b * Math.cos(a + s), tip[1] - b * Math.sin(a + s)];
  return { pts: [...line, ...densify([tip, barb(0.5), tip, barb(-0.5)], 2).slice(1)], name, line: true };
}

/** Where a straight line from one shape's middle toward another's leaves the first one's box, a little outside it. */
function edgePoint(b: Box, toward: Point, gap = 7): Point {
  const dx = toward[0] - b.cx, dy = toward[1] - b.cy;
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  const n = Math.hypot(dx, dy) || 1;
  return [b.cx + dx * t + (dx / n) * gap, b.cy + dy * t + (dy / n) * gap];
}

/** An arrow straight from one shape to another, shifted to one side by `side` (to draw two arrows between them). */
function link(a: Part[], b: Part[], name?: string, side = 0): Part {
  const pa = bbox(a.flatMap((p) => p.pts)), pb = bbox(b.flatMap((p) => p.pts));
  const dx = pb.cx - pa.cx, dy = pb.cy - pa.cy, n = Math.hypot(dx, dy), ox = (-dy / n) * side, oy = (dx / n) * side;
  const sa = { ...pa, cx: pa.cx + ox, cy: pa.cy + oy }, sb = { ...pb, cx: pb.cx + ox, cy: pb.cy + oy };
  return arrow([edgePoint(sa, [sb.cx, sb.cy]), edgePoint(sb, [sa.cx, sa.cy])], name);
}

/** A double circle: a circle with a smaller one inside it, the name on the outer one. */
function doubleCircle(cx: number, cy: number, d: number, name: string): Part[] {
  return [...shapeParts("circle", cx, cy, d, d, name), ...shapeParts("circle", cx, cy, d * 0.72, d * 0.72)];
}

export interface Template {
  id: string;
  label: string;
  /** The heading the Add menu lists it under: "Flowcharts", "State diagrams", or "Agent workflows". */
  group: string;
  diagram: DiagramKind;
  parts(): Part[];
}

/**
 * The templates, in the Add menu's order: flowcharts, then state diagrams, then agent workflows.
 *
 * Each agent workflow is one of grooph's patterns drawn as a flowchart, one shape for each step and one arrow for each
 * edge, so grooph reads it back as the same pattern. Its shapes are the ones grooph writes in Mermaid: a builder or a
 * planner is a box, a critic, a judge, or a red team is a diamond, a check is a hexagon, a person's gate is a
 * trapezoid, and a stop is a double circle. An arrow with a condition is named with it as grooph writes it: "pass",
 * "fail", or "verdict: rebut".
 */
export const TEMPLATES: Template[] = [
  {
    id: "steps",
    label: "Steps in order",
    group: "Flowcharts",
    diagram: "flowchart",
    parts() {
      const start = shapeParts("stadium", 0, 0, 140, 56, "Start");
      const one = shapeParts("rect", 0, 120, 150, 64, "First step");
      const two = shapeParts("rect", 0, 240, 150, 64, "Second step");
      const end = shapeParts("stadium", 0, 360, 140, 56, "Done");
      return [...start, ...one, ...two, ...end, link(start, one), link(one, two), link(two, end)];
    },
  },
  {
    id: "decision",
    label: "A yes-or-no choice",
    group: "Flowcharts",
    diagram: "flowchart",
    parts() {
      const start = shapeParts("stadium", 0, 0, 140, 56, "Start");
      const ask = shapeParts("diamond", 0, 140, 140, 104, "Ready?");
      const yes = shapeParts("rect", -120, 300, 140, 64, "Go ahead");
      const no = shapeParts("rect", 120, 300, 140, 64, "Wait");
      return [...start, ...ask, ...yes, ...no, link(start, ask), arrow([[-70, 140], [-120, 140], [-120, 261]], "Yes"), arrow([[70, 140], [120, 140], [120, 261]], "No")];
    },
  },
  {
    id: "loop",
    label: "Try until done",
    group: "Flowcharts",
    diagram: "flowchart",
    parts() {
      const start = shapeParts("stadium", 0, 0, 140, 56, "Start");
      const step = shapeParts("rect", 0, 120, 150, 64, "Try");
      const ask = shapeParts("diamond", 0, 260, 140, 104, "Done?");
      const end = shapeParts("stadium", 0, 400, 140, 56, "Finish");
      return [...start, ...step, ...ask, ...end, link(start, step), link(step, ask), link(ask, end, "Yes"), arrow([[70, 260], [150, 260], [150, 120], [82, 120]], "No")];
    },
  },
  {
    id: "sign-in",
    label: "Sign in, with retries",
    group: "Flowcharts",
    diagram: "flowchart",
    parts() {
      const start = shapeParts("stadium", 0, 0, 140, 56, "Start");
      const enter = shapeParts("lean-right", 0, 120, 170, 64, "Enter password");
      const right = shapeParts("diamond", 0, 260, 140, 104, "Correct?");
      const tries = shapeParts("diamond", 210, 260, 140, 104, "Tries left?");
      const signed = shapeParts("stadium", 0, 400, 140, 56, "Signed in");
      const locked = shapeParts("stadium", 210, 400, 140, 56, "Locked out");
      return [
        ...start, ...enter, ...right, ...tries, ...signed, ...locked,
        link(start, enter), link(enter, right), link(right, signed, "Yes"), link(right, tries, "No"),
        arrow([[210, 208], [210, 120], [74, 120]], "Yes"), link(tries, locked, "No"),
      ];
    },
  },
  {
    id: "retry",
    label: "A request, retried",
    group: "Flowcharts",
    diagram: "flowchart",
    parts() {
      const start = shapeParts("stadium", 0, 0, 140, 56, "Start");
      const send = shapeParts("rect", 0, 120, 150, 64, "Send request");
      const ask = shapeParts("diamond", 0, 260, 140, 104, "Worked?");
      const wait = shapeParts("rect", 210, 260, 120, 64, "Wait");
      const end = shapeParts("stadium", 0, 400, 140, 56, "Done");
      return [
        ...start, ...send, ...ask, ...wait, ...end,
        link(start, send), link(send, ask), link(ask, end, "Yes"), link(ask, wait, "No"), arrow([[210, 224], [210, 120], [82, 120]]),
      ];
    },
  },
  {
    id: "door",
    label: "A door: closed, open, locked",
    group: "State diagrams",
    diagram: "state",
    parts() {
      const start = shapeParts("dot", -150, 0, 30, 30);
      const closed = shapeParts("rect", 0, 0, 130, 60, "Closed");
      const open = shapeParts("rect", 230, 0, 130, 60, "Open");
      const locked = shapeParts("rect", 0, 160, 130, 60, "Locked");
      return [
        ...start, ...closed, ...open, ...locked,
        link(start, closed),
        link(closed, open, "open", -14), link(open, closed, "close", -14),
        link(closed, locked, "lock", 24), link(locked, closed, "unlock", 24),
      ];
    },
  },
  {
    id: "light",
    label: "A traffic light",
    group: "State diagrams",
    diagram: "state",
    parts() {
      const start = shapeParts("dot", -170, 0, 30, 30);
      const red = shapeParts("rect", 0, 0, 120, 60, "Red");
      const green = shapeParts("rect", 210, 150, 120, 60, "Green");
      const yellow = shapeParts("rect", -90, 150, 120, 60, "Yellow");
      return [...start, ...red, ...green, ...yellow, link(start, red), link(red, green, "go"), link(green, yellow, "slow"), link(yellow, red, "stop")];
    },
  },
  {
    id: "order",
    label: "An order, start to end",
    group: "State diagrams",
    diagram: "state",
    parts() {
      const start = shapeParts("dot", 0, 0, 30, 30);
      const placed = shapeParts("rect", 0, 110, 140, 60, "Placed");
      const paid = shapeParts("rect", 0, 230, 140, 60, "Paid");
      const shipped = shapeParts("rect", 0, 350, 140, 60, "Shipped");
      const canceled = shapeParts("rect", 220, 230, 140, 60, "Canceled");
      const end = shapeParts("bullseye", 0, 460, 42, 42);
      return [
        ...start, ...placed, ...paid, ...shipped, ...canceled, ...end,
        link(start, placed), link(placed, paid, "pay"), link(paid, shipped, "ship"), link(shipped, end),
        link(placed, canceled, "cancel"), arrow([[220, 264], [220, 460], [29, 460]]),
      ];
    },
  },
  {
    id: "player",
    label: "A media player",
    group: "State diagrams",
    diagram: "state",
    parts() {
      const start = shapeParts("dot", 0, -110, 30, 30);
      const stopped = shapeParts("rect", 0, 0, 130, 60, "Stopped");
      const playing = shapeParts("rect", 230, 0, 130, 60, "Playing");
      const paused = shapeParts("rect", 230, 160, 130, 60, "Paused");
      const end = shapeParts("bullseye", 0, 160, 42, 42);
      return [
        ...start, ...stopped, ...playing, ...paused, ...end,
        link(start, stopped),
        link(stopped, playing, "play", -14), link(playing, stopped, "stop", -14),
        link(playing, paused, "pause", 30), link(paused, playing, "play", 30),
        link(paused, stopped, "stop"), link(stopped, end, "close"),
      ];
    },
  },
  {
    id: "vending",
    label: "A vending machine",
    group: "State diagrams",
    diagram: "state",
    parts() {
      const start = shapeParts("dot", -160, 0, 30, 30);
      const idle = shapeParts("rect", 0, 0, 130, 60, "Idle");
      const paid = shapeParts("rect", 0, 160, 130, 60, "Paid");
      const vending = shapeParts("rect", 230, 160, 130, 60, "Vending");
      return [
        ...start, ...idle, ...paid, ...vending,
        link(start, idle),
        link(idle, paid, "coin", 30), link(paid, idle, "refund", 30),
        link(paid, vending, "choose"), arrow([[230, 126], [230, 0], [72, 0]], "done"),
      ];
    },
  },
  {
    id: "grind-loop",
    label: "Grind loop",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const builder = shapeParts("rect", 0, 0, 150, 64, "Builder");
      const tests = shapeParts("hexagon", 0, 130, 150, 64, "Tests");
      const done = doubleCircle(0, 260, 84, "Done");
      return [...builder, ...tests, ...done, link(builder, tests), link(tests, done, "pass"), arrow([[75, 130], [150, 130], [150, 0], [82, 0]], "fail")];
    },
  },
  {
    id: "ralph-loop",
    label: "Ralph loop",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const builder = shapeParts("rect", 0, 0, 150, 64, "Builder");
      const tests = shapeParts("hexagon", 0, 130, 150, 64, "Tests");
      const plan = shapeParts("hexagon", 0, 260, 150, 64, "Plan empty?");
      const done = doubleCircle(0, 410, 84, "Done");
      return [
        ...builder, ...tests, ...plan, ...done,
        link(builder, tests), arrow([[75, 130], [150, 130], [150, 0], [82, 0]], "fail"), link(tests, plan, "pass"),
        arrow([[-75, 260], [-150, 260], [-150, 0], [-82, 0]], "fail"), link(plan, done, "pass"),
      ];
    },
  },
  {
    id: "red-team-loop",
    label: "Red-team loop",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const builder = shapeParts("rect", 0, 0, 150, 64, "Builder");
      const red = shapeParts("diamond", 0, 140, 140, 104, "Red team");
      const done = doubleCircle(0, 290, 84, "Done");
      return [...builder, ...red, ...done, link(builder, red), link(red, done, "pass"), arrow([[70, 140], [150, 140], [150, 0], [82, 0]], "fail")];
    },
  },
  {
    id: "review-gate",
    label: "Review gate",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const builder = shapeParts("rect", 0, 0, 150, 64, "Builder");
      const critic = shapeParts("diamond", 0, 140, 140, 104, "Critic");
      const merge = shapeParts("trapezoid", 0, 290, 170, 64, "Merge approval");
      const done = doubleCircle(0, 450, 84, "Done");
      return [
        ...builder, ...critic, ...merge, ...done,
        link(builder, critic), arrow([[70, 140], [150, 140], [150, 0], [82, 0]], "fail"), link(critic, merge, "pass"),
        link(merge, done, "pass"), arrow([[-70, 290], [-150, 290], [-150, 0], [-82, 0]], "fail"),
      ];
    },
  },
  {
    id: "spec-then-loop",
    label: "Spec then loop",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const planner = shapeParts("rect", 0, 0, 150, 64, "Planner");
      const spec = shapeParts("trapezoid", 0, 130, 170, 64, "Spec approval");
      const builder = shapeParts("rect", 0, 260, 150, 64, "Builder");
      const critic = shapeParts("diamond", 0, 400, 140, 104, "Critic");
      const done = doubleCircle(0, 550, 84, "Done");
      return [
        ...planner, ...spec, ...builder, ...critic, ...done,
        link(planner, spec), link(spec, builder, "pass"), link(builder, critic),
        arrow([[70, 400], [150, 400], [150, 260], [82, 260]], "fail"), link(critic, done, "pass"),
      ];
    },
  },
  {
    id: "human-gated-irreversible",
    label: "Human gate, then act",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const gate = shapeParts("trapezoid", 0, 0, 160, 64, "Step approval");
      const act = shapeParts("rect", 0, 120, 180, 64, "Irreversible step");
      const done = doubleCircle(0, 240, 84, "Done");
      return [...gate, ...act, ...done, link(gate, act, "pass"), link(act, done)];
    },
  },
  {
    id: "debate-then-build",
    label: "Debate then build",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const a = shapeParts("rect", -110, 0, 150, 64, "Planner A");
      const b = shapeParts("rect", 110, 0, 150, 64, "Planner B");
      const judge = shapeParts("diamond", 110, 140, 140, 104, "Judge");
      const gate = shapeParts("trapezoid", 110, 290, 170, 64, "Plan approval");
      const builder = shapeParts("rect", -110, 290, 150, 64, "Builder");
      const tests = shapeParts("hexagon", -110, 420, 150, 64, "Tests");
      const done = doubleCircle(-110, 550, 84, "Done");
      return [
        ...a, ...b, ...judge, ...gate, ...builder, ...tests, ...done,
        link(a, b), link(b, judge), arrow([[40, 140], [-110, 140], [-110, 39]], "verdict: rebut"), link(judge, gate, "pass"),
        arrow([[40, 290], [-28, 290]], "pass"), link(builder, tests),
        arrow([[-185, 420], [-240, 420], [-240, 290], [-192, 290]], "fail"), link(tests, done, "pass"),
      ];
    },
  },
  {
    id: "tournament-then-judge",
    label: "Tournament then judge",
    group: "Agent workflows",
    diagram: "flowchart",
    parts() {
      const a = shapeParts("rect", -150, 0, 124, 64, "Candidate A");
      const b = shapeParts("rect", 0, 0, 124, 64, "Candidate B");
      const c = shapeParts("rect", 150, 0, 124, 64, "Candidate C");
      const filter = shapeParts("hexagon", 0, 150, 170, 64, "Finalist filter");
      const judge = shapeParts("diamond", 0, 290, 140, 104, "Judge");
      const finisher = shapeParts("rect", 0, 430, 150, 64, "Finisher");
      const done = doubleCircle(0, 560, 84, "Done");
      return [
        ...a, ...b, ...c, ...filter, ...judge, ...finisher, ...done,
        link(a, filter), link(b, filter), link(c, filter), link(filter, judge, "pass"), link(judge, finisher, "pass"), link(finisher, done),
      ];
    },
  },
];

/** Parts moved so their middle is at (x, y). */
export function centered(parts: Part[], x: number, y: number): Part[] {
  const b = bbox(parts.flatMap((p) => p.pts)), dx = x - b.cx, dy = y - b.cy;
  return parts.map((p) => ({ ...p, pts: p.pts.map(([px, py]): Point => [px + dx, py + dy]) }));
}
