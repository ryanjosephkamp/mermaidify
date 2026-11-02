/**
 * Snap, for chosen strokes: each shape read from them becomes its clean outline, and each arrow a clean line with a
 * clean head. Pieces read as neither snap as a stroke held still does, and an arrow drawn in several strokes with no
 * shape at its ends, its line and a head drawn apart, becomes one clean arrow. A clean stroke keeps the id of the first
 * stroke it replaces, so the names and choices kept against that stroke stay with it. Every point is in drawing units.
 */
import { oneStrokeArrow, trimHooks } from "../reader/arrows.ts";
import { bbox, dist, pathLength, type Point } from "../reader/geometry.ts";
import type { Reading, ReadShape } from "../reader/recognize.ts";
import type { OutlineKind, ShapeKind } from "../reader/shapes.ts";
import { cleanArrow, cleanOutline, snap } from "../reader/snap.ts";
import type { DrawnStroke } from "./pad.ts";

/** The shapes that snap to a clean outline. Filled dots, rings, double circles, and boxes in boxes stay as drawn. */
const OUTLINED: ReadonlySet<ShapeKind> = new Set(["rect", "stadium", "circle", "diamond", "hexagon", "trapezoid", "inv-trapezoid", "lean-right", "lean-left", "triangle", "flip-triangle"]);
/** Scaled to the size it was drawn at on screen, and back. */
const at = (p: readonly Point[], k: number): Point[] => p.map(([x, y]): Point => [x * k, y * k]);

/**
 * The drawing with the chosen strokes snapped, read as `m` (a reading of all of `strokes`, so an arrow is read with the
 * shapes it joins, with any look chosen for a shape in place of the one read). Strokes that fit no clean shape or
 * arrow stay as they are, and so do dotted and thick lines, which a clean line would make plain. A stroke that was a shape and its line
 * becomes two, the second with a new id from `next`: `from` gives each new id and the stroke it came from. Also gives
 * how many shapes, and how many arrows and lines, were made clean.
 */
export function snapChosen(
  strokes: readonly DrawnStroke[],
  chosen: ReadonlySet<number>,
  m: Reading,
  next: () => number,
): { strokes: DrawnStroke[]; from: Map<number, number>; shapes: number; arrows: number } {
  /** What each replaced stroke becomes: one or more clean paths, or nothing when another clean stroke took its place. */
  const into = new Map<number, Point[][]>();
  const put = (id: number, pts: Point[]) => into.set(id, [...(into.get(id) ?? []), pts]);
  const all = (idx: number[]) => idx.length > 0 && idx.every((i) => strokes[i] && chosen.has(strokes[i].id));
  let shapes = 0, arrows = 0;

  // Strokes chosen alone that make an arrow in pieces are that arrow: a line and a V, or a small triangle drawn apart
  // at its end, which is its head and not a shape. Any other shape read among them, such as a dot or a box at the
  // arrow's end, keeps the strokes from being one arrow.
  const shapeOf = new Map<DrawnStroke, ReadShape>();
  for (const n of [...m.nodes, ...m.groups]) for (const i of n.strokes) if (strokes[i]) shapeOf.set(strokes[i], n);
  const picked = strokes.filter((s) => chosen.has(s.id)), pieces = picked.length > 1 ? arrowOf(picked) : null;
  const head = (s: DrawnStroke, line: number) => {
    const n = shapeOf.get(s);
    return !n || ((n.kind === "triangle" || n.kind === "flip-triangle") && n.strokes.length === 1 && Math.max(n.bb.w, n.bb.h) <= 0.55 * line);
  };
  const whole = pieces && !shapeOf.has(pieces.shaft) && picked.every((s) => s === pieces.shaft || head(s, dist(pieces.tail, pieces.tip))) ? pieces : null;
  if (whole) {
    put(whole.shaft.id, cleanArrow(whole.tail, whole.tip, whole.shaft.zoom ?? 1));
    for (const s of picked) if (s !== whole.shaft) into.set(s.id, []);
    arrows++;
  }

  // A shape drawn in one stroke with a line snaps only with that line, so the line is never lost.
  const linesOf = (i: number) => m.edges.filter((e) => e.strokes.includes(i));
  for (const n of whole ? [] : m.nodes) {
    if (!all(n.strokes) || n.strokes.length !== 1 || !OUTLINED.has(n.kind) || n.role === "dot") continue;
    const s = strokes[n.strokes[0]], shared = linesOf(n.strokes[0]).length > 0;
    if (shared && !linesOf(n.strokes[0]).every((e) => all(e.strokes))) continue;
    // A shape alone in its stroke snaps as holding it would: level, its own size, and starting where it was drawn.
    const held = shared ? null : snap(s.pts, 0, s.zoom);
    put(s.id, held && held.kind !== "line" && held.from <= 2 ? held.pts : cleanOutline(n.kind as OutlineKind, n.bb));
    shapes++;
  }
  for (const e of whole ? [] : m.edges) {
    if (!all(e.strokes) || e.pts.length < 2 || e.style !== "plain") continue;
    const [first, ...rest] = e.strokes.map((i) => strokes[i]);
    const tail = e.pts[0], tip = e.assumed ? e.pts[e.pts.length - 1] : farTip(e.pts, e.strokes.map((i) => strokes[i].pts));
    const straight = dist(tail, tip) >= 0.9 * pathLength(e.pts), k = first.zoom ?? 1;
    // A curved line with no head stays as drawn, kept whole only when a shape drawn with it snaps.
    if (!straight && e.assumed) {
      if (into.has(first.id)) put(first.id, e.pts.slice());
      continue;
    }
    put(first.id, straight ? (e.assumed ? [tail, tip] : cleanArrow(tail, tip, k, e.both)) : headed([...e.pts.slice(0, -1), tip], k, e.both));
    for (const s of rest) if (!into.has(s.id)) into.set(s.id, []);
    arrows++;
  }

  // What was read as neither: an arrow in pieces, then each stroke as holding it would snap it.
  // Only strokes the reader left out are left: a shape or a line it read and that stays as drawn, such as a dot or a
  // dotted line, stays as drawn.
  const read = new Set([...m.nodes, ...m.groups, ...m.edges].flatMap((x) => x.strokes.map((i) => strokes[i])));
  const left = strokes.filter((s) => chosen.has(s.id) && !into.has(s.id) && !read.has(s));
  const rest = left.length > 1 ? arrowOf(left) : null;
  if (rest && !shapeOf.has(rest.shaft) && left.every((s) => s === rest.shaft || head(s, dist(rest.tail, rest.tip)))) {
    put(rest.shaft.id, cleanArrow(rest.tail, rest.tip, rest.shaft.zoom ?? 1));
    for (const s of left) if (s !== rest.shaft) into.set(s.id, []);
    arrows++;
  } else
    for (const s of left) {
      const k = s.zoom ?? 1, a = oneStrokeArrow(at(s.pts, k));
      if (a) {
        put(s.id, cleanArrow(at([a.tail], 1 / k)[0], at([a.tip], 1 / k)[0], k));
        arrows++;
        continue;
      }
      const r = snap(s.pts, 0, k);
      if (!r) continue;
      // A shape a line led to keeps the line, as holding it does.
      if (r.kind !== "line" && r.from > 2) put(s.id, s.pts.slice(0, r.from + 1));
      put(s.id, r.pts);
      if (r.kind === "line") arrows++;
      else shapes++;
    }

  const out: DrawnStroke[] = [], from = new Map<number, number>();
  for (const s of strokes) {
    const paths = into.get(s.id);
    if (!paths) {
      out.push(s);
      continue;
    }
    // A clean shape and its line from one stroke each become a stroke of their own; the first keeps the stroke's id.
    paths.forEach((pts, i) => {
      const id = i ? next() : s.id;
      if (i) from.set(id, s.id);
      out.push({ ...s, id, pts, open: undefined });
    });
  }
  return { strokes: out, from, shapes, arrows };
}

/**
 * An arrow's tip: the end of its line, or a point of its head drawn past that end, the one farthest on along the way the
 * line goes as it ends, so a head drawn apart from its line and beyond it keeps its point.
 */
function farTip(line: readonly Point[], drawn: readonly (readonly Point[])[]): Point {
  const end = line[line.length - 1];
  let k = line.length - 2;
  while (k > 0 && dist(line[k], end) < 12) k--;
  const d = dist(line[k], end);
  if (d < 1) return end;
  const ux = (end[0] - line[k][0]) / d, uy = (end[1] - line[k][1]) / d;
  let tip = end, far = 0;
  for (const pts of drawn)
    for (const q of pts) {
      const ahead = (q[0] - end[0]) * ux + (q[1] - end[1]) * uy, aside = Math.abs((q[0] - end[0]) * uy - (q[1] - end[1]) * ux);
      if (ahead > far && ahead <= 40 && aside <= Math.max(6, 0.5 * ahead)) {
        far = ahead;
        tip = q;
      }
    }
  return tip;
}

/** A curved line kept as drawn, with a clean head at its end, and at its start too for a two-way arrow. */
function headed(line: readonly Point[], scale: number, both: boolean): Point[] {
  // What a clean arrow along the line's last stretch draws once it reaches the tip: its two barbs.
  const head = (p: readonly Point[]) => {
    const tip = p[p.length - 1];
    let k = p.length - 2;
    while (k > 0 && dist(p[k], tip) < 14 / scale) k--;
    const clean = cleanArrow(p[k], tip, scale);
    return clean.slice(clean.findIndex((q, i) => i > 0 && dist(q, tip) < 1e-6) + 1);
  };
  const out = [...line, ...head(line)];
  return both ? [...head([...line].reverse()).reverse(), ...out] : out;
}

/**
 * An arrow drawn in pieces with nothing at its ends to read it with: the longest stroke is its line, and every other
 * stroke lies near one end of it and is no bigger than it, a head drawn apart. Gives the line's stroke, its tail, and the
 * tip, the head's point farthest on along the line, or null.
 */
function arrowOf(list: readonly DrawnStroke[]): { shaft: DrawnStroke; tail: Point; tip: Point } | null {
  const lines = list.map((s) => ({ s, t: trimHooks(s.pts).pts })).sort((a, b) => dist(b.t[0], b.t[b.t.length - 1]) - dist(a.t[0], a.t[a.t.length - 1]));
  const { s: shaft, t } = lines[0], len = pathLength(t);
  if (len < 20 || dist(t[0], t[t.length - 1]) < 0.85 * len) return null;
  const others = list.filter((s) => s !== shaft), reach = Math.max(40, 0.4 * len);
  for (const [tail, end] of [[t[0], t[t.length - 1]], [t[t.length - 1], t[0]]]) {
    if (!others.every((s) => s.pts.every((q) => dist(q, end) <= reach))) continue;
    const b = bbox(others.flatMap((s) => s.pts));
    if (Math.max(b.w, b.h) > len) return null;
    const ux = (end[0] - tail[0]) / dist(tail, end), uy = (end[1] - tail[1]) / dist(tail, end);
    let tip = end, far = 0;
    for (const s of others)
      for (const q of s.pts) {
        const ahead = (q[0] - end[0]) * ux + (q[1] - end[1]) * uy;
        if (ahead > far) {
          far = ahead;
          tip = q;
        }
      }
    return { shaft, tail, tip };
  }
  return null;
}
