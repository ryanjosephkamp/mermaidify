/**
 * Reads a drawing: strokes in, the flowchart they show out. Five steps, in order:
 *
 * 1. Closed or open. A stroke whose end comes back to its start is a shape, and open strokes that meet end to end and
 *    close up are one shape drawn in several strokes. A shape and a line drawn in one stroke are both.
 * 2. Which shape (shapes.ts).
 * 3. Inside and around. A round shape centered in another is a double circle, a box centered in a box is a subroutine,
 *    and any other shape that holds shapes is a group.
 * 4. Lines and heads. An open stroke whose ends reach two shapes is a line, short dashes in a row are one dotted line,
 *    and a line gone over again is one thick line. A hook or a knot of ink at its tip, a short mark at its end, or a
 *    small closed mark where it meets a shape, is its head; with no head it points the way it was drawn.
 * 5. Direction, and ids and default names in reading order.
 *
 * Read as a state diagram, a small dot, a small circle, or a circle with a dot or a circle inside is a start or an end,
 * and a diamond is a choice. A group is a composite state, as it is a group in a flowchart.
 */
import { knotAt, trimHooks } from "./arrows.ts";
import { bbox, dist, halfway, inside, lineDist, pathLength, polyDist, resample, segDist, walk, type Box, type Point } from "./geometry.ts";
import { classify, closedPart, closure, ROUND, type Fit, type ShapeKind } from "./shapes.ts";

export interface Stroke {
  pts: Point[];
  /** The ink's name, carried through to the reading. */
  color?: string;
  /**
   * The zoom it was drawn at: how many screen pixels one drawing unit spanned. A hand draws the same size on screen at
   * any zoom, so the reader reads a drawing at the size it was drawn on screen; with no zoom, 1.
   */
  zoom?: number;
}

export type Direction = "TD" | "BT" | "LR" | "RL";

/** How a line was drawn: in one go, as dashes ("dotted"), or gone over again ("thick"). */
export type LineStyle = "plain" | "dotted" | "thick";

/** Which diagram the strokes are read as. */
export type DiagramKind = "flowchart" | "state";

/** What a shape is in a state diagram: a state, a choice, or a dot, which is a start or an end (`[*]`). */
export type StateRole = "state" | "choice" | "dot";

export interface ReadOptions {
  /** Read the strokes as a flowchart (the default) or as a state diagram. */
  diagram?: DiagramKind;
}

export interface ReadShape {
  /** "A", "B", and so on in reading order for a shape; "G1", "G2", and so on for a group. */
  id: string;
  kind: ShapeKind;
  /**
   * The default name: "Node 1", "Node 2", and so on in reading order, or "Group 1" for a group. A shape's kind is only
   * how it looks, so it gives the name nothing.
   */
  label: string;
  color: string;
  bb: Box;
  /** The outline, evenly resampled. */
  poly: Point[];
  /** The outline fits its kind poorly. */
  unsure: boolean;
  /** Which input strokes make it, by index. A shape and a line drawn in one stroke share it. */
  strokes: number[];
  /** The id of the smallest group around it, or null. */
  parent: string | null;
  /** In a state diagram, what the shape is. */
  role?: StateRole;
}

export interface ReadEdge {
  /** "L1", "L2", and so on, in the code's order. */
  id: string;
  from: string;
  to: string;
  /** Heads at both ends. */
  both: boolean;
  /** No head anywhere, so it points the way it was drawn. */
  assumed: boolean;
  style: LineStyle;
  color: string;
  /** The line without its hooks, as drawn. */
  pts: Point[];
  /** The line and its arrowhead marks, by index. A shape and a line drawn in one stroke share it. */
  strokes: number[];
}

export interface Reading {
  diagram: DiagramKind;
  direction: Direction;
  nodes: ReadShape[];
  groups: ReadShape[];
  edges: ReadEdge[];
  /** Strokes that are neither a shape, a line, nor a head, by index. */
  unused: number[];
  /** Groups of shapes that reach each other along the arrows, and shapes with an arrow to themselves. */
  loops: number;
  /** How long the reading took, in milliseconds. */
  ms: number;
}

interface Item {
  index: number;
  color: string;
  pts: Point[];
  len: number;
  bb: Box;
  diag: number;
  /** Which ends of a line run on into a shape drawn in the same stroke, start then end. */
  joints?: [boolean, boolean];
}
interface Shape {
  kind: ShapeKind;
  unsure: boolean;
  bb: Box;
  poly: Point[];
  pts: Point[];
  color: string;
  diag: number;
  strokes: number[];
  isGroup?: boolean;
  parent?: Shape;
  id?: string;
  label?: string;
  /** The line drawn on from this shape in the same stroke, and which of its ends meets the shape. */
  line?: { it: Item; end: 0 | 1 };
  role?: StateRole;
}
interface Line {
  pts: Point[];
  color: string;
  len: number;
  strokes: number[];
  host?: Shape;
  /** The dashes a dotted line was drawn with. */
  dashes?: Item[];
  joints?: [boolean, boolean];
}
interface Edge {
  from: Shape;
  to: Shape;
  pts: Point[];
  headEnd: boolean;
  headStart: boolean;
  color: string;
  line: Line;
  both?: boolean;
  assumed?: boolean;
  /** Gone over again: two or more strokes that run together. */
  thick?: boolean;
}

const area = (s: Shape) => s.bb.w * s.bb.h;
/** Whether o holds i: o is bigger and i's box is inside o's, give or take a few units. */
const holds = (o: Shape, i: Shape) =>
  o !== i && area(o) > area(i) && i.bb.x0 >= o.bb.x0 - 6 && i.bb.x1 <= o.bb.x1 + 6 && i.bb.y0 >= o.bb.y0 - 6 && i.bb.y1 <= o.bb.y1 + 6;
/** Whether a point is within d of a box: a quick test before measuring against an outline. */
const nearBox = (p: Point, b: Box, d: number) => p[0] >= b.x0 - d && p[0] <= b.x1 + d && p[1] >= b.y0 - d && p[1] <= b.y1 + d;
/** How far a point is from a shape: 0 inside it. */
const gap = (p: Point, s: Shape) => (inside(p, s.poly) ? 0 : polyDist(p, s.poly));
/** Whether a point is within d of a shape. */
const within = (p: Point, s: Shape, d: number) => nearBox(p, s.bb, d) && gap(p, s) < d;
/** How far from a shape a line's end may stop and still reach it. */
const reach = (s: Shape) => Math.max(18, Math.min(44, 0.3 * Math.max(s.bb.w, s.bb.h)));
/** Whether a line goes well out from a shape between its ends, as a loop on the shape does. */
const leaves = (pts: readonly Point[], s: Shape) => {
  const out = Math.max(...pts.map((p) => gap(p, s))), ends = Math.max(gap(pts[0], s), gap(pts[pts.length - 1], s));
  return out > 22 && out > ends + 15;
};

const shapeOf = (pts: Point[], c: Fit, color: string, strokes: number[]): Shape => ({
  kind: c.kind,
  unsure: c.unsure,
  bb: c.bb,
  poly: c.poly,
  pts,
  color,
  diag: Math.hypot(c.bb.w, c.bb.h),
  strokes,
});

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The zoom a drawing was drawn at: the middle of its strokes' zooms, a stroke with none counting as 1. One zoom for the
 * whole drawing keeps where each stroke lies against the others.
 */
export function drawnZoom(strokes: readonly Stroke[]): number {
  const z = strokes
    .filter((s) => s && Array.isArray(s.pts))
    .map((s) => (typeof s.zoom === "number" && s.zoom >= 0.01 && s.zoom <= 100 ? s.zoom : 1))
    .sort((a, b) => a - b);
  return z.length ? z[z.length >> 1] : 1;
}

export function recognize(strokes: readonly Stroke[], options: ReadOptions = {}): Reading {
  const k = drawnZoom(strokes);
  if (k === 1) return read(strokes, options);
  const at = (pts: readonly Point[], f: number) => pts.map((p): Point => (Array.isArray(p) ? [p[0] * f, p[1] * f] : [NaN, NaN]));
  const r = read(
    strokes.map((s) => (s && Array.isArray(s.pts) ? { ...s, pts: at(s.pts, k) } : s)),
    options,
  );
  const box = (b: Box): Box => ({ x0: b.x0 / k, y0: b.y0 / k, x1: b.x1 / k, y1: b.y1 / k, w: b.w / k, h: b.h / k, cx: b.cx / k, cy: b.cy / k });
  const shape = (s: ReadShape): ReadShape => ({ ...s, bb: box(s.bb), poly: at(s.poly, 1 / k) });
  return { ...r, nodes: r.nodes.map(shape), groups: r.groups.map(shape), edges: r.edges.map((e) => ({ ...e, pts: at(e.pts, 1 / k) })) };
}

function read(strokes: readonly Stroke[], options: ReadOptions): Reading {
  const t0 = now(), diagram: DiagramKind = options.diagram === "state" ? "state" : "flowchart";
  const items: Item[] = [];
  strokes.forEach((s, index) => {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) return;
    const len = pathLength(s.pts);
    if (!(len >= 8)) return;
    const bb = bbox(s.pts);
    items.push({ index, color: s.color ?? "ink", pts: s.pts, len, bb, diag: Math.hypot(bb.w, bb.h) });
  });

  // 1. A stroke that comes back to its start is a shape; a tiny one is an arrowhead. A shape drawn in the same stroke
  // as a line that runs off it is the two, which share the stroke.
  let shapes: Shape[] = [];
  const open: Item[] = [];
  for (const it of items) {
    // Twice, for a shape, a line, and another shape all in one stroke.
    let pts = it.pts, joints: [boolean, boolean] = [false, false];
    const drawnWith: Shape[] = [];
    for (let k = 0; k < 2; k++) {
      const split = loopEnd(pts);
      if (!split || joints[split.end]) break;
      const s = shapeOf(split.loop, split.fit, it.color, [it.index]);
      s.line = { it, end: split.end };
      shapes.push(s);
      drawnWith.push(s);
      joints = split.end ? [joints[0], true] : [true, joints[1]];
      pts = split.line;
    }
    if (drawnWith.length) {
      const bb = bbox(pts), len = pathLength(pts);
      const line: Item = { index: it.index, color: it.color, pts, len, bb, diag: Math.hypot(bb.w, bb.h), joints };
      for (const s of drawnWith) s.line!.it = line;
      open.push(line);
      continue;
    }
    const c = closedFit(it.pts);
    if (c) shapes.push(shapeOf(it.pts, c, it.color, [it.index]));
    else open.push(it);
  }

  // A small closed mark at the edge of a shape six or more times its size, where a line ends, is that line's head
  // drawn as a closed triangle, not a shape: the line runs on to the mark's tip. The line must arrive through the mark,
  // ending inside it or beyond it from the shape, and the nearest such line wins. A mark drawn in the same stroke as a
  // line is that line's head, and may be bigger and nearer the shape's size. Marks drawn in one stroke are taken before
  // curls, as a mark whose ends touch the shape is no line back to it, and marks drawn in several strokes once those
  // are joined.
  const marks: Line[] = [], used = new Set<Item>();
  const takeMarks = () => {
    for (const n of shapes.slice()) {
      const size = Math.max(n.bb.w, n.bb.h), mid: Point = [n.bb.cx, n.bb.cy];
      if (size > (n.line ? SPLIT_HEAD_MAX : HEAD_MAX)) continue;
      // The shape it points into: much bigger, close by, and no group, as a group's wall is no line's end. A mark in
      // the line's own stroke may stop as far short of it as a line's end may.
      const big = shapes.find(
        (s) =>
          s !== n &&
          area(s) >= (n.line ? 4 : 6) * area(n) &&
          polyDist(mid, s.poly) < 0.5 * size + 10 &&
          n.pts.some((q) => gap(q, s) <= (n.line ? reach(s) : 10)) &&
          !shapes.some((o) => o !== s && o !== n && holds(s, o)),
      );
      if (!big) continue;
      const touches = (p: Point) => nearBox(p, n.bb, 10) && gap(p, n) <= 10;
      const through = (p: Point) => inside(p, n.poly) || gap(p, big) > gap(mid, big);
      let o: Item | undefined, end: 0 | 1 = 0, best = Infinity;
      if (n.line) [o, end] = [n.line.it, n.line.end];
      else
        for (const c of open) {
          if (used.has(c) || c.len <= size) continue;
          const a = touches(c.pts[0]), b = touches(c.pts[c.pts.length - 1]), p = a ? c.pts[0] : c.pts[c.pts.length - 1];
          if (a !== b && through(p) && gap(p, n) < best) [o, end, best] = [c, a ? 0 : 1, gap(p, n)];
        }
      if (!o) continue;
      const tip = n.pts.reduce((a, q) => (gap(q, big) < gap(a, big) ? q : a));
      o.pts = end ? [...o.pts, tip] : [tip, ...o.pts];
      o.len = pathLength(o.pts);
      shapes = shapes.filter((s) => s !== n);
      marks.push({ pts: n.pts, color: n.color, len: pathLength(n.pts), strokes: n.strokes });
    }
  };
  takeMarks();

  // A closed curl that starts and ends on another shape is a line back to that shape.
  const curls: Line[] = [];
  for (const c of shapes.slice()) {
    const a = c.pts[0], b = c.pts[c.pts.length - 1];
    const host = shapes.find((s) => s !== c && within(a, s, 8) && within(b, s, 8) && !holds(c, s) && !holds(s, c));
    if (host) {
      shapes = shapes.filter((s) => s !== c);
      curls.push({ pts: c.pts, color: c.color, len: pathLength(c.pts), strokes: c.strokes, host });
    }
  }

  // Lines that meet end to end and close up are one shape drawn in several strokes.
  // A stroke that reaches shapes at both ends is a line between them, however close another line runs beside it.
  const reaches = (p: Point) => shapes.some((s) => within(p, s, reach(s)));
  const pool = open.filter(
    (o) =>
      o.len >= 20 &&
      !shapes.some((s) => within(o.pts[0], s, 10) || within(o.pts[o.pts.length - 1], s, 10)) &&
      !(reaches(o.pts[0]) && reaches(o.pts[o.pts.length - 1])),
  );
  for (const a of pool) {
    if (used.has(a)) continue;
    const chain = [a];
    let pts = a.pts.slice();
    for (let step = 0; step < 3; step++) {
      const head = pts[0], tail = pts[pts.length - 1], cb = bbox(pts), tol = Math.max(14, 0.18 * Math.hypot(cb.w, cb.h));
      let best: { b: Item; d: number; end: "head" | "tail"; rev: boolean } | null = null;
      for (const b of pool) {
        if (used.has(b) || chain.includes(b)) continue;
        const b0 = b.pts[0], b1 = b.pts[b.pts.length - 1];
        const options: [number, "head" | "tail", boolean][] = [
          [dist(tail, b0), "tail", false],
          [dist(tail, b1), "tail", true],
          [dist(head, b1), "head", false],
          [dist(head, b0), "head", true],
        ];
        for (const [d, end, rev] of options) if (d < tol && (!best || d < best.d)) best = { b, d, end, rev };
      }
      if (!best) break;
      const bp = best.rev ? best.b.pts.slice().reverse() : best.b.pts;
      pts = best.end === "tail" ? pts.concat(bp) : bp.concat(pts);
      chain.push(best.b);
      const nb = bbox(pts);
      if (dist(pts[0], pts[pts.length - 1]) < Math.max(14, 0.18 * Math.hypot(nb.w, nb.h)) && Math.min(nb.w, nb.h) >= 14) {
        const c = classify(pts);
        if (c) {
          shapes.push(shapeOf(pts, c, a.color, chain.map((x) => x.index)));
          chain.forEach((x) => used.add(x));
        }
        break;
      }
    }
  }

  takeMarks();

  // 3. A shape inside a like shape is one shape (a double circle, a box in a box); a shape around others is a group.
  shapes.sort((p, q) => area(q) - area(p));
  const gone = new Set<Shape>();
  // A shape that holds two shapes apart from each other is a group, never one shape with a ring or a box inside it. In
  // a state diagram a shape around another is a composite state, unless it is a small ring around a ring, an end.
  const holdsTwo = new Set(
    shapes.filter((o) => {
      const held = shapes.filter((i) => holds(o, i));
      return held.filter((i) => !held.some((j) => holds(j, i))).length >= 2;
    }),
  );
  for (const o of shapes)
    for (const i of shapes) {
      if (gone.has(o) || gone.has(i) || !holds(o, i) || holdsTwo.has(o)) continue;
      if (diagram === "state" && Math.max(o.bb.w, o.bb.h) > DOT_RING) continue;
      const ratio = area(o) / area(i), centered = dist([o.bb.cx, o.bb.cy], [i.bb.cx, i.bb.cy]) < 0.2 * o.diag;
      // A small inner ring loses much of its area to a wobble, so its width counts too.
      const wide = Math.max(o.bb.w, o.bb.h) / Math.max(i.bb.w, i.bb.h);
      if (centered && (ratio < 3.2 || wide < 1.9) && (ROUND.has(o.kind) || ROUND.has(i.kind))) {
        o.kind = Math.max(i.bb.w, i.bb.h) <= DOT_MAX && filledIn(i.pts) ? "bullseye" : "double";
        o.strokes.push(...i.strokes);
        gone.add(i);
      } else if (centered && ratio < 2 && o.kind === "rect" && i.kind === "rect" && diagram === "flowchart") {
        o.kind = "subroutine";
        o.strokes.push(...i.strokes);
        gone.add(i);
      }
    }
  const live = shapes.filter((s) => !gone.has(s));
  for (const s of live) s.isGroup = live.some((o) => holds(s, o));
  const nodes = live.filter((s) => !s.isGroup), groups = live.filter((s) => s.isGroup);
  for (const s of live) s.parent = groups.filter((g) => holds(g, s)).sort((p, q) => area(p) - area(q))[0];
  const parentOf = (s: Shape) => groups.filter((g) => holds(g, s)).sort((p, q) => area(p) - area(q))[0];

  // Dots. In a state diagram, dots are starts and ends: a small circle, a circle in a circle, and a small closed or
  // filled mark that a line ends at, standing clear of every shape and group. A mark within reach of a shape that no
  // line touching it leads to is that line's head, drawn short of the shape, and a mark no line touches is no dot: a
  // letter, say. In either diagram, a small shape drawn filled in is a filled dot, and a filled mark inside a small
  // circle fills it in, making a ring around a dot. A flowchart's filled mark is more often a filled head, so there it
  // makes a dot only in the middle of a ring, and only when densely filled.
  const state = diagram === "state", dots = new Set<Shape>();
  const dot = (pts: Point[], color: string, strokes: number[]): Shape => {
    const s = shapeOf(pts, dotFit(pts), color, strokes);
    s.kind = "dot";
    s.parent = parentOf(s);
    nodes.push(s);
    dots.add(s);
    return s;
  };
  // A wobbly small circle can fit a hexagon or an oval better, so any round-looking small shape will do.
  const round = (n: Shape, most: number) => RINGS.has(n.kind) && Math.max(n.bb.w, n.bb.h) <= most && n.bb.w < 1.6 * n.bb.h && n.bb.h < 1.6 * n.bb.w;
  /** Whether a point is too near a shape, or a group's wall, for a dot to stand there. */
  const crowded = (q: Point) => live.some((s) => (s.isGroup ? nearBox(q, s.bb, DOT_WALL) && polyDist(q, s.poly) < DOT_WALL : within(q, s, DOT_CLEAR)));
  /** Whether a mark at a line's end is that line's head: within reach of a shape the line does not run from. */
  const headOf = (mark: readonly Point[], from: readonly Point[]) =>
    nodes.some((t) => !dots.has(t) && mark.some((q) => within(q, t, reach(t))) && !from.some((q) => within(q, t, reach(t))));
  for (const n of nodes) {
    if (dots.has(n)) continue;
    if (Math.max(n.bb.w, n.bb.h) <= DOT_MAX && filledIn(n.pts)) {
      n.kind = "dot";
      dots.add(n);
    } else if (state && (n.kind === "double" || round(n, DOT_CIRCLE))) dots.add(n);
  }
  for (const o of open) {
    const size = Math.max(o.bb.w, o.bb.h), mid: Point = [o.bb.cx, o.bb.cy];
    if (used.has(o) || size > DOT_MAX || o.len < DOT_INK * size) continue;
    const filled = filledIn(o.pts) || (state && closure(o.pts, o.len) < 0.3 * size);
    if (!filled) continue;
    // In a flowchart the mark must be centered and dense: a letter written in a circle, a "W" say, turns back and forth
    // too, but leaves the circle a circle.
    const ring = nodes.find(
      (n) => inside(mid, n.poly) && round(n, DOT_RING) && (state || (dist(mid, [n.bb.cx, n.bb.cy]) < 0.2 * Math.max(n.bb.w, n.bb.h) && o.len >= DOT_FILL * size)),
    );
    if (ring) {
      ring.kind = "bullseye";
      dots.add(ring);
      ring.strokes.push(o.index);
      used.add(o);
      continue;
    }
    if (!state) continue;
    // The far ends of the lines that run from the mark to a shape: a transition always does, fairly straight once its
    // hook is trimmed, and the curling strokes of a word written beside it do not.
    const reaches = (q: Point) => live.some((t) => (t.isGroup ? nearBox(q, t.bb, reach(t)) && polyDist(q, t.poly) <= reach(t) : within(q, t, reach(t))));
    const straight = (l: Item) => {
      const t = trimHooks(l.pts).pts;
      return dist(t[0], t[t.length - 1]) >= 0.7 * pathLength(t);
    };
    const far = open
      .filter((l) => l !== o && !used.has(l) && l.len >= DOT_LINE)
      .flatMap((l) => [[l.pts[0], l.pts[l.pts.length - 1], l], [l.pts[l.pts.length - 1], l.pts[0], l]] as const)
      .filter(([near, f, l]) => dist(near, mid) <= DOT_REACH + size / 2 && reaches(f) && straight(l))
      .map(([, f]) => f);
    if (far.length && !o.pts.some(crowded) && !headOf(o.pts, far)) {
      dot(o.pts, o.color, [o.index]);
      used.add(o);
    }
  }

  // 4. Lines join shapes; short marks at a line's end are its arrowheads.
  // A dot is so small that a line aimed at it may stop a little farther off, for its size, than at a shape.
  const reachOf = (s: Shape) => (dots.has(s) ? Math.max(DOT_REACH, reach(s)) : reach(s));
  const attach = (p: Point): Shape | undefined => {
    let best: { s: Shape; d: number } | null = null;
    for (const s of nodes) {
      if (!nearBox(p, s.bb, reachOf(s))) continue;
      const d = gap(p, s);
      if (d <= reachOf(s) && (!best || d < best.d || (d === best.d && area(s) < area(best.s)))) best = { s, d };
    }
    if (best) {
      const outside = groups.find((g) => holds(g, best!.s) && !inside(p, g.poly) && polyDist(p, g.poly) < best!.d);
      return outside ?? best.s;
    }
    for (const g of groups) {
      if (!nearBox(p, g.bb, reach(g))) continue;
      const d = polyDist(p, g.poly);
      if (d <= reach(g) && (!best || d < best.d)) best = { s: g, d };
    }
    return best?.s;
  };
  // People stop a line short of the shape it points at, more so the longer the line: an end that reaches no shape
  // reaches the first one straight ahead of it, within a share of the line's length. A head's barb is too short to aim.
  const aim = (pts: readonly Point[], end: 0 | 1): Shape | undefined => {
    if (pathLength(pts) < AIM_LEAST) return undefined;
    const i = end ? pts.length - 1 : 0, p = pts[i], q = walk(pts, i, 20, end ? -1 : 1);
    const dx = p[0] - q[0], dy = p[1] - q[1], n = Math.hypot(dx, dy);
    if (n < 10) return undefined;
    const far = Math.min(AIM_MAX, AIM * pathLength(pts));
    for (let d = 3; d <= far; d += 3) {
      const r: Point = [p[0] + (dx / n) * d, p[1] + (dy / n) * d];
      const hit = nodes.find((s) => within(r, s, 2));
      if (hit) return hit;
    }
    return undefined;
  };
  // Dashes in a row are one line, in the place of the dash drawn first; a row that joins no shapes is read dash by dash.
  const single = (o: Item): Line => ({ pts: o.pts, color: o.color, len: o.len, strokes: [o.index], joints: o.joints });
  const rest = open.filter((o) => !used.has(o)), chains = dashChains(rest, (p, d) => nodes.some((s) => within(p, s, d)));
  const firstDash = new Map(chains.map((c) => [c.reduce((x, y) => (y.it.index < x.it.index ? y : x)).it, c]));
  const dashed = new Set(chains.flat().map((d) => d.it));
  const lines: Line[] = [];
  for (const o of rest) {
    const c = firstDash.get(o);
    if (c) {
      const pts = c.flatMap((d) => (d.flip ? d.it.pts.slice().reverse() : d.it.pts));
      lines.push({ pts, color: c[0].it.color, len: pathLength(pts), strokes: c.map((d) => d.it.index), dashes: c.map((d) => d.it) });
    } else if (!dashed.has(o)) lines.push(single(o));
  }
  lines.push(...curls);
  // In a state diagram, a dot drawn at a line's free end, in the same stroke, is a start or an end, not a head.
  for (const line of lines) {
    if (!state || line.host || line.dashes) continue;
    for (const end of [0, 1] as const) {
      const p = end ? line.pts.slice().reverse() : line.pts, k = knotAt(p, DOT_KNOT, DOT_KNOT_INK);
      if (!k) continue;
      const knot = p.slice(0, k.at + 1), kb = bbox(knot), mid: Point = [kb.cx, kb.cy];
      if (knot.some(crowded) || headOf(knot, [p[p.length - 1]])) continue;
      dot(knot, line.color, line.strokes.slice(0, 1));
      const rest = [mid, ...p.slice(k.at)];
      line.pts = end ? rest.reverse() : rest;
      line.len = pathLength(line.pts);
      line.joints = end ? [line.joints?.[0] ?? false, true] : [true, line.joints?.[1] ?? false];
    }
  }
  const edges: Edge[] = [], heads: Line[] = [], unused: number[] = [], filled = new Set<Line>(), loose: Line[] = [];
  // A line's hooks are found once, though its ends are looked at more than once.
  const hooks = new Map<readonly Point[], ReturnType<typeof trimHooks>>();
  const trimmed = (line: Line) => {
    const p = line.pts, found = hooks.get(p) ?? hooks.set(p, trimHooks(p)).get(p)!, t = { ...found };
    // Where a line runs on into the shape drawn in its stroke, the pen's turn into the outline is no head.
    if (line.joints?.[0] && t.headStart) [t.pts, t.headStart] = [[p[0], ...t.pts], false];
    if (line.joints?.[1] && t.headEnd) [t.pts, t.headEnd] = [[...t.pts, p[p.length - 1]], false];
    return t;
  };
  for (const line of lines) {
    const t = trimmed(line);
    const a = line.host || attach(t.pts[0]), b = line.host || attach(t.pts[t.pts.length - 1]);
    const e: Edge = { from: a!, to: b!, pts: t.pts, headEnd: t.headEnd, headStart: t.headStart, color: line.color, line };
    // A "V" whose legs stop short of the shape they face is a head drawn past a line's end, not a loop on that shape.
    const floats = () => veeAt(t.pts) >= 0 && gap(t.pts[0], a!) > 10 && gap(t.pts[t.pts.length - 1], a!) > 10;
    if (a && b && a !== b) edges.push(e);
    else if (a && b && (line.host || (line.len > 50 && leaves(t.pts, a) && !floats()))) edges.push(e);
    else if (line.dashes) lines.push(...line.dashes.map(single));
    // A head may be filled in with many strokes of the pen, so it is told by its size, not its length; such a mark
    // must come within a few units of the line's end, as a filled head does and a word written beside the line does not.
    else if (line.len < 70) heads.push(line);
    else if (Math.max(bbox(line.pts).w, bbox(line.pts).h) <= HEAD_MAX) {
      heads.push(line);
      filled.add(line);
    } else loose.push(line);
  }
  for (const m of marks) {
    heads.push(m);
    filled.add(m);
  }
  // A short mark that touches another line's end is that line's arrowhead (a "V", or one barb of it), even when it
  // happens to reach two shapes, unless, its hook aside, it is straight and runs alongside that line all the way,
  // going over it. Between two short strokes, a bent one is the head and a straight one the line, even
  // when the line is the shorter: shapes drawn close together leave little room between them.
  const bentLine = (l: Line) => dist(l.pts[0], l.pts[l.pts.length - 1]) < 0.8 * l.len;
  // An open line back to its own shape that stays small beside it, or that is a "V", is more often a head drawn with
  // its tip on the shape or at a short line's end, a "V" or a narrow triangle, so it looks further.
  for (const e of edges.slice()) {
    const line = e.line, bent = bentLine(line), lb = bbox(line.pts);
    const self = e.from === e.to && (Math.max(lb.w, lb.h) < 0.5 * Math.max(e.from.bb.w, e.from.bb.h) || veeAt(line.pts) >= 0);
    if (line.host || line.dashes || (e.from === e.to && !self) || line.len >= (self ? 160 : bent ? 70 : 45)) continue;
    const near = self ? 22 : bent ? 10 : 8, cover = self ? 8 : near;
    const barbOf = edges.some(
      (f) =>
        f !== e &&
        (nearBox(f.pts[0], lb, cover) || nearBox(f.pts[f.pts.length - 1], lb, cover)) &&
        (bent === bentLine(f.line) ? f.line.len > line.len : bent) &&
        line.pts.some((q) => dist(q, f.pts[0]) < near || dist(q, f.pts[f.pts.length - 1]) < near) &&
        !(dist(e.pts[0], e.pts[e.pts.length - 1]) >= 0.8 * pathLength(e.pts) && together(e.pts, f.pts)),
    );
    if (barbOf) {
      edges.splice(edges.indexOf(e), 1);
      heads.push(line);
    }
  }
  /** A head finds the line whose end it is nearest to, or none: whether it found one. */
  const headFor = (h: Line, among: readonly Edge[]) => {
    let best: { e: Edge; end: "start" | "end"; d: number } | null = null;
    const hb = bbox(h.pts);
    for (const e of among)
      for (const [end, p] of [["start", e.pts[0]], ["end", e.pts[e.pts.length - 1]]] as const) {
        if (!nearBox(p, hb, filled.has(h) ? 8 : 22)) continue;
        let d = Infinity;
        for (const q of h.pts) d = Math.min(d, dist(p, q));
        if (d < 22 && (!best || d < best.d)) best = { e, end, d };
      }
    if (!best) return false;
    if (best.end === "end") best.e.headEnd = true;
    else best.e.headStart = true;
    // A head drawn in the line's own stroke is already among its strokes.
    best.e.line.strokes.push(...h.strokes.filter((i) => !best!.e.line.strokes.includes(i)));
    return true;
  };
  for (const h of heads) if (!headFor(h, edges)) loose.push(h);
  // Once every head has its line, the lines left over look farther. One that stops short of the shape it is aimed at
  // reaches it: read only now, as a long barb is aimed back along its own line. A "V" drawn a little past a line's
  // free end is its head, and the line runs on to its point. And a "V" too big to be taken for a head before is the
  // head of the line it ends.
  const late = new Set<Line>();
  /**
   * Where a head left loose lies just past a line's end (0 its start, 1 its end), the head's tip, or null: a "V" whose
   * point is a little ahead, or a bent or filled mark that the end touches, running on ahead of it. A straight piece is
   * no head: a line drawn in two pieces stays two.
   */
  const vees = new Map<Line, number>(), boxes = new Map<Line, Box>();
  const veeOf = (h: Line) => vees.get(h) ?? vees.set(h, veeAt(h.pts)).get(h)!;
  const boxOf = (h: Line) => boxes.get(h) ?? boxes.set(h, bbox(h.pts)).get(h)!;
  const headPast = (h: Line, pts: readonly Point[], len: number, end: 0 | 1): Point | null => {
    const i = end ? pts.length - 1 : 0, p = pts[i];
    // Most loose strokes lie far from the end: a glance at their box rules them out before any point is looked at.
    if (!nearBox(p, boxOf(h), Math.max(40, 0.5 * len) + 12)) return null;
    const at = veeOf(h);
    if (at >= 0 && veePast(h.pts, at, pts, len, end)) return h.pts[at];
    if (!heads.includes(h) || !(filled.has(h) || dist(h.pts[0], h.pts[h.pts.length - 1]) < 0.8 * h.len)) return null;
    const q = walk(pts, i, 20, end ? -1 : 1), n = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (n < 10 || !nearBox(p, boxOf(h), 12) || !h.pts.some((r) => dist(r, p) < 12)) return null;
    const ux = (p[0] - q[0]) / n, uy = (p[1] - q[1]) / n;
    const tip = h.pts.reduce((a, r) => ((r[0] - p[0]) * ux + (r[1] - p[1]) * uy > (a[0] - p[0]) * ux + (a[1] - p[1]) * uy ? r : a));
    const ahead = (tip[0] - p[0]) * ux + (tip[1] - p[1]) * uy, aside = Math.abs((tip[1] - p[1]) * ux - (tip[0] - p[0]) * uy);
    return ahead >= 8 && aside <= 0.5 * ahead + 6 ? tip : null;
  };
  // A "V" read as a line back to its own shape, its legs reaching that shape, may yet be the head of a short line.
  const selfVees = edges.filter((e) => e.from === e.to && !e.line.host && !e.line.dashes && veeOf(e.line) >= 0);
  for (const line of loose) {
    if (late.has(line) || line.dashes || line.host || line.len < SHORT_LEAST) continue;
    if (line.len < AIM_LEAST && !nodes.some((s) => nearBox(line.pts[0], s.bb, reach(s) + 40) || nearBox(line.pts[line.pts.length - 1], s.bb, reach(s) + 40))) continue;
    const t = trimmed(line), ends = [attach(t.pts[0]), attach(t.pts[t.pts.length - 1])], len = pathLength(t.pts);
    // A line shorter than aiming needs runs from a shape: only then is a "V" past its free end taken for its head.
    if (line.len < AIM_LEAST && !ends[0] === !ends[1]) continue;
    const taken: Line[] = [];
    for (const end of [0, 1] as const) {
      if (ends[end]) continue;
      let tip: Point | null = null;
      const pick = (o: Line) => o !== line && !late.has(o) && !taken.includes(o) && !!(tip = headPast(o, t.pts, len, end));
      const v = loose.find(pick) ?? selfVees.find((e) => edges.includes(e) && pick(e.line))?.line;
      if (!v || !tip) continue;
      t.pts = end ? [...t.pts, tip] : [tip, ...t.pts];
      if (end) t.headEnd = true;
      else t.headStart = true;
      taken.push(v);
      ends[end] = attach(tip);
    }
    const a = ends[0] || aim(t.pts, 0), b = ends[1] || aim(t.pts, 1);
    if (!a || !b || a === b) continue;
    for (const v of taken) {
      late.add(v);
      line.strokes.push(...v.strokes);
      const was = edges.findIndex((e) => e.line === v);
      if (was >= 0) edges.splice(was, 1);
    }
    edges.push({ from: a, to: b, pts: t.pts, headEnd: t.headEnd, headStart: t.headStart, color: line.color, line });
    late.add(line);
  }
  // A "V" too big to be taken for a head before is the head of a line whose end is at its point, with its legs opening
  // back along the line; a stroke that only bends near a line's end, as a stray connector does, is not.
  const veeHead = (h: Line): boolean => {
    const at = veeOf(h);
    if (at < 0) return false;
    const tip = h.pts[at], hb = boxOf(h), mx = (h.pts[0][0] + h.pts[h.pts.length - 1][0]) / 2, my = (h.pts[0][1] + h.pts[h.pts.length - 1][1]) / 2;
    for (const e of edges)
      for (const end of [0, 1] as const) {
        const i = end ? e.pts.length - 1 : 0, p = e.pts[i];
        if (!nearBox(p, hb, 22) || dist(tip, p) >= 22) continue;
        const q = walk(e.pts, i, 20, end ? -1 : 1), n = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (n < 10 || (mx - tip[0]) * (p[0] - q[0]) + (my - tip[1]) * (p[1] - q[1]) >= 0) continue;
        if (end) e.headEnd = true;
        else e.headStart = true;
        e.line.strokes.push(...h.strokes.filter((k) => !e.line.strokes.includes(k)));
        return true;
      }
    return false;
  };
  for (const h of loose) if (!late.has(h) && (heads.includes(h) ? headFor(h, edges) : veeHead(h))) late.add(h);
  for (const h of loose) if (!late.has(h)) unused.push(...h.strokes);
  // A line gone over again is one thick line: lines between the same shapes that run together, unless their heads
  // point opposite ways, as two arrows drawn close together do. Lines whose middles lie far apart are passed over
  // first, which keeps a drawing with many lines between two shapes quick.
  const mids = new Map(edges.map((e) => [e, { at: halfway(e.pts), len: pathLength(e.pts) }]));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i], f = edges[j], me = mids.get(e)!, mf = mids.get(f)!;
      if (e.line.dashes || f.line.dashes || dist(me.at, mf.at) > 2 * BAND_MAX + Math.abs(me.len - mf.len) / 2) continue;
      let same: boolean;
      if (e.from === f.from && e.to === f.to) same = e.from !== e.to || dist(e.pts[0], f.pts[0]) <= dist(e.pts[0], f.pts[f.pts.length - 1]);
      else if (e.from === f.to && e.to === f.from) same = false;
      else continue;
      const fEnd = same ? f.headEnd : f.headStart, fStart = same ? f.headStart : f.headEnd;
      if ((e.headEnd && !e.headStart && fStart && !fEnd) || (e.headStart && !e.headEnd && fEnd && !fStart) || !together(e.pts, f.pts)) continue;
      e.headEnd ||= fEnd;
      e.headStart ||= fStart;
      e.thick = true;
      e.line.strokes.push(...f.line.strokes);
      edges.splice(j--, 1);
    }
  for (const e of edges) {
    if (e.headStart && !e.headEnd) [e.from, e.to] = [e.to, e.from];
    e.both = e.headStart && e.headEnd;
    e.assumed = !e.headStart && !e.headEnd;
  }

  // 5. Direction, ids in reading order, and names.
  let ax = 0, ay = 0, sx = 0, sy = 0;
  for (const e of edges)
    if (e.from !== e.to) {
      const dx = e.to.bb.cx - e.from.bb.cx, dy = e.to.bb.cy - e.from.bb.cy;
      ax += Math.abs(dx);
      ay += Math.abs(dy);
      sx += dx;
      sy += dy;
    }
  let direction: Direction;
  if (ax + ay === 0) {
    const all = bbox(nodes.flatMap((n): Point[] => [[n.bb.x0, n.bb.y0], [n.bb.x1, n.bb.y1]]).concat([[0, 0]]));
    direction = all.w > all.h * 1.2 ? "LR" : "TD";
  } else direction = ay >= ax ? (sy >= 0 ? "TD" : "BT") : sx >= 0 ? "LR" : "RL";
  const vertical = direction === "TD" || direction === "BT", sign = direction === "BT" || direction === "RL" ? -1 : 1;
  const sizes = nodes.map((n) => (vertical ? n.bb.h : n.bb.w)).sort((x, y) => x - y), band = sizes[sizes.length >> 1] || 40;
  const key = (n: Shape) => (vertical ? [Math.round((sign * n.bb.cy) / band), n.bb.cx] : [Math.round((sign * n.bb.cx) / band), n.bb.cy]);
  nodes.sort((p, q) => {
    const a = key(p), b = key(q);
    return a[0] - b[0] || a[1] - b[1];
  });
  nodes.forEach((n, i) => {
    n.id = i < 26 ? String.fromCharCode(65 + i) : "N" + (i + 1);
    n.label = "Node " + (i + 1);
  });
  // A state diagram letters its states alone: a dot is a start or an end (`[*]` in Mermaid, so its id is never
  // written). Its default names come once the shapes are read out, below.
  if (diagram === "state") {
    let letter = 0, d = 0;
    for (const n of nodes) {
      n.role = dots.has(n) ? "dot" : n.kind === "diamond" ? "choice" : "state";
      n.id = n.role === "dot" ? "dot" + ++d : letter < 26 ? String.fromCharCode(65 + letter++) : "N" + ++letter;
    }
    for (const g of groups) g.role = "state";
  }
  groups
    .sort((p, q) => area(q) - area(p))
    .forEach((g, i) => {
      g.id = "G" + (i + 1);
      g.label = "Group " + (i + 1);
    });

  const out = (s: Shape): ReadShape => ({
    id: s.id!,
    kind: s.kind,
    label: s.label!,
    color: s.color,
    bb: s.bb,
    poly: s.poly,
    unsure: s.unsure,
    strokes: s.strokes.slice().sort((x, y) => x - y),
    parent: s.parent?.id ?? null,
    ...(s.role ? { role: s.role } : {}),
  });
  const read = nodes.map(out);
  if (diagram === "state") numberStates(read);
  return {
    diagram,
    direction,
    nodes: read,
    groups: groups.map(out),
    edges: edges.map((e, i) => ({
      id: "L" + (i + 1),
      from: e.from.id!,
      to: e.to.id!,
      both: e.both!,
      assumed: e.assumed!,
      style: e.line.dashes ? "dotted" : e.thick ? "thick" : "plain",
      color: e.color,
      pts: e.pts,
      strokes: e.line.strokes.slice().sort((x, y) => x - y),
    })),
    unused: unused.sort((x, y) => x - y),
    loops: loopCount(nodes, edges),
    ms: now() - t0,
  };
}

/**
 * A state diagram's default names, in reading order: "State 1", "State 2", and so on for its states alone. A dot is a
 * start or an end, which has no name, and Mermaid gives a choice none either.
 */
export function numberStates(nodes: ReadShape[]): void {
  let k = 0;
  for (const n of nodes) n.label = n.role === "state" ? "State " + ++k : "";
}

/**
 * State diagrams' dots: the widest mark that may be a dot, the least ink it holds for its width, and the least for it
 * to count as filled in when it does not close; the widest circle that is a dot alone, and with a mark inside; and how
 * far a dot stands clear of every shape, and of a group's wall. A dot drawn at a line's end, in the same stroke, is
 * filled in: this much ink inside a box this wide, more than a hook holds. A line's end reaches a dot from this far,
 * and a line that ends at a dot is at least this long.
 */
const RINGS: ReadonlySet<ShapeKind> = new Set(["circle", "double", "hexagon", "stadium", "dot", "bullseye"]);
const DOT_MAX = 44, DOT_INK = 2.5, DOT_FILL = 5, DOT_TURNS = 3, DOT_MIDDLE = 0.25, DOT_CIRCLE = 50, DOT_RING = 70, DOT_CLEAR = 16, DOT_WALL = 8;
const DOT_KNOT = 24, DOT_KNOT_INK = 96, DOT_REACH = 26, DOT_LINE = 16;

/**
 * Whether a small mark is ink filled in: much ink for its width, or a pen going back and forth across it, as hatching
 * does, and ink in its middle either way. A "V" or a tick turns back once at most, and a wobbly ring, however much it
 * wavers, leaves its middle empty.
 */
function filledIn(pts: readonly Point[]): boolean {
  const bb = bbox(pts), size = Math.max(bb.w, bb.h), len = pathLength(pts), mid: Point = [bb.cx, bb.cy];
  if (!pts.some((p, i) => i > 0 && segDist(mid, pts[i - 1], p) < DOT_MIDDLE * size)) return false;
  if (len >= DOT_FILL * size) return true;
  if (len < DOT_INK * size) return false;
  // Turns back: where the way the pen came and the way it goes on, a few units each way, nearly oppose.
  const step = Math.max(6, 0.3 * size);
  let turns = 0, since = Infinity;
  for (let i = 1, walked = 0; i < pts.length - 1; i++) {
    walked += dist(pts[i - 1], pts[i]);
    since += dist(pts[i - 1], pts[i]);
    if (walked < step || len - walked < step) continue;
    const b = walk(pts, i, step, -1), f = walk(pts, i, step, 1);
    const v1x = pts[i][0] - b[0], v1y = pts[i][1] - b[1], v2x = f[0] - pts[i][0], v2y = f[1] - pts[i][1];
    const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (n > 0 && (v1x * v2x + v1y * v2y) / n < -0.4 && since > step) {
      turns++;
      since = 0;
    }
  }
  return turns >= DOT_TURNS;
}

/** A dot's outline: a circle around its ink. */
function dotFit(pts: readonly Point[]): Fit {
  const bb = bbox(pts), r = Math.max(bb.w, bb.h) / 2 + 2, poly: Point[] = [];
  for (let i = 0; i < 24; i++) poly.push([bb.cx + r * Math.cos((i / 24) * 2 * Math.PI), bb.cy + r * Math.sin((i / 24) * 2 * Math.PI)]);
  return { kind: "circle", score: 0, unsure: false, bb: bbox(poly), poly };
}

/**
 * How far ahead of a line's end the shape it is aimed at may be: this share of the line's length, and at most so far;
 * and the shortest line that is aimed.
 */
const AIM = 0.4, AIM_MAX = 90, AIM_LEAST = 60, SHORT_LEAST = 20;

/**
 * Where an open stroke shaped like a "V" has its point, or -1: two nearly straight legs, neither tiny and neither more
 * than three times the other, meeting at an angle of about 20 to 120 degrees.
 */
function veeAt(p: readonly Point[]): number {
  if (p.length < 5) return -1;
  const a = p[0], b = p[p.length - 1];
  let at = -1, far = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = segDist(p[i], a, b);
    if (d > far) [at, far] = [i, d];
  }
  if (at < 0) return -1;
  const s1 = dist(a, p[at]), s2 = dist(p[at], b);
  if (s1 < 8 || s2 < 8 || Math.max(s1, s2) > 3 * Math.min(s1, s2)) return -1;
  if (pathLength(p.slice(0, at + 1)) > 1.25 * s1 || pathLength(p.slice(at)) > 1.25 * s2) return -1;
  const cos = ((a[0] - p[at][0]) * (b[0] - p[at][0]) + (a[1] - p[at][1]) * (b[1] - p[at][1])) / (s1 * s2);
  return cos < 0.94 && cos > -0.5 ? at : -1;
}

/**
 * Whether a "V" with its point at `at` lies a little past a line's end (0 its start, 1 its end), the line `len` long:
 * its point ahead of the end, near the line's way, within half the line's length, and its legs opening back toward it.
 */
function veePast(v: readonly Point[], at: number, line: readonly Point[], len: number, end: 0 | 1): boolean {
  const i = end ? line.length - 1 : 0, p = line[i], q = walk(line, i, 20, end ? -1 : 1);
  const n = Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (n < 10) return false;
  const ux = (p[0] - q[0]) / n, uy = (p[1] - q[1]) / n, tip = v[at];
  const ahead = (tip[0] - p[0]) * ux + (tip[1] - p[1]) * uy, aside = Math.abs((tip[1] - p[1]) * ux - (tip[0] - p[0]) * uy);
  if (ahead < -8 || ahead > Math.max(40, 0.5 * len) || aside > 12 + 0.5 * Math.max(0, ahead)) return false;
  const mx = (v[0][0] + v[v.length - 1][0]) / 2, my = (v[0][1] + v[v.length - 1][1]) / 2;
  return (mx - tip[0]) * ux + (my - tip[1]) * uy < 0;
}

/** The widest a closed arrowhead may be, drawn apart from its line or in the same stroke. */
const HEAD_MAX = 50, SPLIT_HEAD_MAX = 80;
/** The widest a short arrow drawn in one stroke can be and still come back near its start. */
const SHORT_ARROW = 160;

/**
 * The shape a stroke that comes back to its start makes, or null: it must be big enough, long enough to go around, and
 * closed, and fit a shape. A small closed mark that fits no shape is a short arrow whose head curls back, not a shape.
 */
function closedFit(pts: Point[]): Fit | null {
  if (!closes(pts)) return null;
  // A knot of ink at one end, with a line going on from it, is a filled head or a dot: so much ink can make a line
  // look closed, so without its knots the stroke must close too.
  const ks = knotAt(pts), ke = knotAt(pts.slice().reverse());
  if ((ks || ke) && !closes(pts.slice(ks ? ks.at : 0, ke ? pts.length - ke.at : pts.length))) return null;
  // A short line with a big head drawn in its stroke can come back near its start: a straight line to a head is no
  // shape. Only a small stroke can be such an arrow, which keeps a big outline quick to read.
  const bb = bbox(pts);
  if (Math.max(bb.w, bb.h) <= SHORT_ARROW) {
    const t = trimHooks(pts), rest = pathLength(t.pts);
    if (t.headEnd !== t.headStart && rest >= 10 && dist(t.pts[0], t.pts[t.pts.length - 1]) >= 0.9 * rest) return null;
  }
  // The outline without its overshoot, when what is left is still big enough to be a shape.
  const part = closedPart(pts), c = classify(closes(part) ? part : pts);
  return c && !(c.unsure && Math.max(c.bb.w, c.bb.h) < 50) ? c : null;
}

/** Whether a stroke comes back to its start: big enough, long enough to go around, and closed. */
function closes(pts: readonly Point[]): boolean {
  if (pts.length < 3) return false;
  const len = pathLength(pts), bb = bbox(pts), big = Math.max(bb.w, bb.h) >= 28 && Math.min(bb.w, bb.h) >= 18;
  return big && len > 1.3 * (bb.w + bb.h) && closure(pts, len) < Math.max(14, 0.22 * Math.hypot(bb.w, bb.h));
}

/** The shortest line, and the shortest loop, that one stroke may hold together. */
const LEAD = 45, LOOP = 60;

/**
 * A shape drawn in the same stroke as a line, either way round: the loop, which closes where the line meets it, the
 * line, and which end of the line meets the loop, or null. The line must leave the loop, as the overshoot of a shape
 * drawn past its start does not.
 */
function loopEnd(p: Point[]): { loop: Point[]; line: Point[]; end: 0 | 1; fit: Fit } | null {
  for (const q of [p, p.slice().reverse()]) {
    const n = q.length, last = q[n - 1], total = pathLength(q);
    let at = -1, best = Infinity, walked = 0;
    for (let j = 1; j < n - 1; j++) {
      walked += dist(q[j - 1], q[j]);
      if (total - walked < LOOP) break;
      if (walked >= LEAD && dist(q[j], last) < best) {
        best = dist(q[j], last);
        at = j;
      }
    }
    if (at < 0) continue;
    // The quick tests first, as most strokes are a line or a shape alone: the loop must close, and the line leave it.
    // A loop no wider than a head is the line's head, and a "line" that comes back to its start is a shape's outline.
    const loop = q.slice(at), lb = bbox(loop), line = q.slice(0, at + 1);
    if (best >= Math.max(14, 0.22 * Math.hypot(lb.w, lb.h)) || Math.max(lb.w, lb.h) <= HEAD_MAX) continue;
    const ln = bbox(line);
    const out = Math.max(lb.x0 - q[0][0], q[0][0] - lb.x1, lb.y0 - q[0][1], q[0][1] - lb.y1);
    if (out < Math.max(20, 0.2 * Math.hypot(lb.w, lb.h)) || dist(q[0], q[at]) < Math.max(14, 0.22 * Math.hypot(ln.w, ln.h))) continue;
    const fit = closedFit(loop);
    if (!fit || inside(q[0], fit.poly) || polyDist(q[0], fit.poly) < 20) continue;
    return q === p ? { loop, line, end: 1, fit } : { loop: loop.reverse(), line: line.reverse(), end: 0, fit };
  }
  return null;
}

/** The longest a dash may be, and the most it may bend: its ends at least this share of its length apart. */
const DASH = 44, DASH_STRAIGHT = 0.65;

/**
 * Lines drawn as dashes: short, nearly straight strokes, each beginning a small gap past the end of the one before and
 * carrying on its way. Two or more make a row; a dash may carry a hook at the row's outer end, which is its head. A
 * dash's end at a shape is where its line ends, so it joins no other dash, and no gap runs along or through a shape
 * (`near` says whether a point is within a distance of one). Each row lists its dashes in order along the line,
 * starting from the end of the dash drawn first, and says which run backward.
 */
function dashChains(open: readonly Item[], near: (p: Point, d: number) => boolean): { it: Item; flip: boolean }[][] {
  interface Dash {
    it: Item;
    /** The ends without hooks, the way the dash runs out through each, whether each end had a hook, and whether each is at a shape. */
    end: [Point, Point];
    out: [Point, Point];
    hook: [boolean, boolean];
    atShape: [boolean, boolean];
    len: number;
  }
  const unit = (p: Point, q: Point): Point => {
    const d = dist(p, q) || 1;
    return [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
  };
  const dashes: Dash[] = [];
  for (const it of open) {
    if (it.len > 3 * DASH) continue;
    const t = trimHooks(it.pts);
    let p = t.pts;
    // A hook as big as its dash can leave part of a barb on what is trimmed, so a hooked dash runs to its tip: where it
    // first comes within a few units of its farthest reach from its other end (the pen passes the tip twice).
    if (t.headEnd !== t.headStart) {
      const q = t.headEnd ? it.pts : it.pts.slice().reverse(), far = Math.max(...q.map((x) => dist(x, q[0])));
      const tip = q.findIndex((x) => dist(x, q[0]) >= far - 3);
      p = t.headEnd ? q.slice(0, tip + 1) : q.slice(0, tip + 1).reverse();
    }
    const len = pathLength(p), a = p[0], b = p[p.length - 1];
    if (p.length < 2 || len < 6 || len > DASH || dist(a, b) < DASH_STRAIGHT * len || (t.headStart && t.headEnd)) continue;
    // Each end's own way, from a few units in, so a dash that bends around a corner turns with it.
    const out: [Point, Point] = [unit(walk(p, 0, 6, 1), a), unit(walk(p, p.length - 1, 6, -1), b)];
    dashes.push({ it, end: [a, b], out, hook: [t.headStart, t.headEnd], atShape: [near(a, 6), near(b, 6)], len });
  }
  if (dashes.length < 2) return [];
  const dot = (u: Point, v: Point) => u[0] * v[0] + u[1] * v[1];
  // Every way two dashes could follow each other: the gap between an end of one and an end of the other, which must be
  // a real gap, no longer than a dash or two, and must carry on the way both dashes run.
  const links: [gap: number, i: number, ei: 0 | 1, j: number, ej: 0 | 1][] = [];
  for (let i = 0; i < dashes.length; i++)
    for (let j = i + 1; j < dashes.length; j++)
      for (const ei of [0, 1] as const)
        for (const ej of [0, 1] as const) {
          const d = dashes[i], e = dashes[j];
          if (d.hook[ei] || e.hook[ej] || d.atShape[ei] || e.atShape[ej]) continue;
          const p = d.end[ei], q = e.end[ej], gap = dist(p, q);
          if (gap < 3 || gap > Math.min(48, Math.max(16, 1.8 * Math.max(d.len, e.len)))) continue;
          // The gap runs on the way both dashes run, or turns a corner of about a right angle at most, even one where a
          // dash starts or stops. The two arms of a "V" turn further, so they never join.
          const u = d.out[ei], w = unit(p, q), v: Point = [-e.out[ej][0], -e.out[ej][1]];
          const on = dot(u, w) >= -0.1 && dot(w, v) >= -0.1 && dot(u, w) + dot(w, v) >= 0.9 && dot(u, v) >= -0.4;
          const along = (t: number): Point => [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
          if (on && ![0.25, 0.5, 0.75].some((t) => near(along(t), 3))) links.push([gap, i, ei, j, ej]);
        }
  links.sort((x, y) => x[0] - y[0]);
  // The closest links first; each end takes one, and no row comes back on itself.
  const next = dashes.map((): [[number, 0 | 1] | null, [number, 0 | 1] | null] => [null, null]);
  const root = dashes.map((_, i) => i), find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (const [, i, ei, j, ej] of links) {
    if (next[i][ei] || next[j][ej] || find(i) === find(j)) continue;
    next[i][ei] = [j, ej];
    next[j][ej] = [i, ei];
    root[find(i)] = find(j);
  }
  const rows: { it: Item; flip: boolean }[][] = [], seen = new Set<number>();
  dashes.forEach((_, s) => {
    const free = !next[s][0] ? 0 : !next[s][1] ? 1 : -1;
    if (seen.has(s) || free < 0 || !next[s][1 - free]) return;
    const row: { it: Item; flip: boolean }[] = [];
    let at: [number, 0 | 1] | null = [s, free as 0 | 1];
    while (at && !seen.has(at[0])) {
      const [k, entered]: [number, 0 | 1] = at;
      seen.add(k);
      row.push({ it: dashes[k].it, flip: entered === 1 });
      at = next[k][1 - entered];
    }
    if (row[0].it.index > row[row.length - 1].it.index) {
      row.reverse();
      for (const d of row) d.flip = !d.flip;
    }
    rows.push(row);
  });
  return rows;
}

/** How far apart a line and the stroke that goes over it may run: 8 units, and more on a long line, up to 10. */
const BAND_MIN = 8, BAND_MAX = 10;

/**
 * Whether two lines run together, as a line and the stroke that goes over it again do: they span about the same
 * distance end to end, and along the middle of each, no point is more than a few units from the other line. Near the
 * ends they may part, where one stops shorter. A "V" beside a short line spans much less than the line.
 */
function together(p: readonly Point[], q: readonly Point[]): boolean {
  const span = (a: readonly Point[]) => Math.max(20, dist(a[0], a[a.length - 1]));
  if (Math.min(span(p), span(q)) < 0.6 * Math.max(span(p), span(q))) return false;
  const band = Math.min(BAND_MAX, Math.max(BAND_MIN, 0.04 * Math.min(pathLength(p), pathLength(q))));
  const middle = (a: readonly Point[], b: readonly Point[]) => resample(a, 16).slice(3, 13).every((x) => lineDist(x, b) <= band);
  return middle(p, q) && middle(q, p);
}

/** Loops: groups of shapes that reach each other (strongly connected), and shapes that point at themselves. */
function loopCount(nodes: Shape[], edges: Edge[]): number {
  const out = new Map(nodes.map((n) => [n, [] as Shape[]])), inn = new Map(nodes.map((n) => [n, [] as Shape[]]));
  for (const e of edges)
    if (out.has(e.from) && out.has(e.to)) {
      out.get(e.from)!.push(e.to);
      inn.get(e.to)!.push(e.from);
      if (e.both) {
        out.get(e.to)!.push(e.from);
        inn.get(e.from)!.push(e.to);
      }
    }
  const order: Shape[] = [], seen = new Set<Shape>();
  // Iterative depth-first search, so a long chain cannot overflow the stack.
  for (const start of nodes) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack: [Shape, number][] = [[start, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1], next = out.get(top[0])!;
      if (top[1] < next.length) {
        const m = next[top[1]++];
        if (!seen.has(m)) {
          seen.add(m);
          stack.push([m, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Set<Shape>();
  let loops = 0;
  for (const n of order.reverse()) {
    if (comp.has(n)) continue;
    const stack = [n];
    let members = 0;
    comp.add(n);
    while (stack.length) {
      const m = stack.pop()!;
      members++;
      for (const k of inn.get(m)!)
        if (!comp.has(k)) {
          comp.add(k);
          stack.push(k);
        }
    }
    if (members > 1 || out.get(n)!.includes(n)) loops++;
  }
  return loops;
}
