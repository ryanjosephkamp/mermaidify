/**
 * Clean shapes from rough ones. A stroke held still at its end is looked at as it stands: an outline that comes back
 * to where it began becomes the shape it is nearest, drawn clean, and a nearly straight line becomes straight. The
 * clean shape is still a stroke, read like any other, so snapping changes how a drawing looks and not what it means.
 */
import { bbox, convexHull, densify, dist, pathLength, polyArea, segDist, type Box, type Point } from "./geometry.ts";
import { classify, OUTLINE, TEMPLATES, type OutlineKind } from "./shapes.ts";

export interface Snap {
  /** The shape the end of the stroke became, or "line" for a straightened line. */
  kind: OutlineKind | "line";
  /** The clean shape, closed (its last point is its first), or the straight line's two ends. */
  pts: Point[];
  /**
   * Where the part that snapped begins in the stroke. Before a shape, the points up to here led to it from elsewhere;
   * before a line, they are the stroke as it was, kept.
   */
  from: number;
  box: Box;
}

/** How far apart the points of a clean outline are, in drawing units. */
const STEP = 6;
/** A shape's outline must fit its kind at least this well to snap (0 is perfect; the reader doubts above 0.1). */
const FIT = 0.12;
/** Every shape Mermaid draws is convex, so an outline must fill most of its convex hull to snap: a star does not. */
const SOLID = 0.82;

/** A clean outline of a kind in a box: corners kept sharp, and circles and near-squares made even. */
export function cleanOutline(kind: OutlineKind, b: Box): Point[] {
  let w = b.w, h = b.h;
  const even = kind === "circle" || ((kind === "rect" || kind === "diamond") && w / h > 0.88 && w / h < 1.14);
  if (even) w = h = (w + h) / 2;
  const x0 = b.cx - w / 2, y0 = b.cy - h / 2, t = OUTLINE[kind];
  if (t === "ellipse") {
    // A multiple of four points, so the outline reaches its box on every side.
    const n = 4 * Math.max(8, Math.min(24, Math.round((Math.PI * (w + h)) / 8 / STEP)));
    const ring = Array.from({ length: n }, (_, i): Point => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [b.cx + (w / 2) * Math.cos(a), b.cy + (h / 2) * Math.sin(a)];
    });
    return [...ring, [ring[0][0], ring[0][1]]];
  }
  const corners = TEMPLATES[t].map(([u, v]): Point => [x0 + u * w, y0 + v * h]);
  const ring = densify([...corners, corners[0]], STEP);
  // Each corner twice, so a smoothed line through the points still turns sharply there.
  const out: Point[] = [];
  for (const p of ring) {
    out.push(p);
    if (corners.some((c) => dist(c, p) < 1e-6)) out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * The clean shape for the end of a stroke, or null when the end is neither a closed outline nor a straight line.
 * `anchor` is where a line may be straightened from: the end of the last straightened part, so a line bent by holding
 * at each corner keeps its corners.
 */
export function snap(pts: readonly Point[], anchor = 0, zoom = 1): Snap | null {
  const n = pts.length;
  if (n < 3) return null;
  // Read at the size it is drawn on screen, as the reader reads it.
  const k = zoom >= 0.01 && zoom <= 100 ? zoom : 1, at = (p: readonly Point[], f: number) => p.map(([x, y]): Point => [x * f, y * f]);
  const r = loop(at(pts, k)) ?? line(at(pts, k), Math.max(0, Math.min(anchor, n - 2)));
  return r && k !== 1 ? { ...r, pts: at(r.pts, 1 / k), box: bbox(at(r.pts, 1 / k)) } : r;
}

/** A closed outline at the end of the stroke, found by the earliest place the stroke comes back to its end. */
function loop(pts: readonly Point[]): Snap | null {
  const n = pts.length, end = pts[n - 1];
  // The length walked and the box covered from each point to the end.
  const after = new Float64Array(n), boxes: Box[] = new Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (i < n - 1) after[i] = after[i + 1] + dist(pts[i], pts[i + 1]);
    const [x, y] = pts[i];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    boxes[i] = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  // The same tests as the reader's for a closed shape: big enough, long enough for its box, and back near its start.
  const closes = (i: number) => {
    const b = boxes[i];
    return (
      Math.max(b.w, b.h) >= 28 &&
      Math.min(b.w, b.h) >= 18 &&
      after[i] > 1.3 * (b.w + b.h) &&
      dist(pts[i], end) < Math.max(14, 0.18 * Math.hypot(b.w, b.h))
    );
  };
  let i = 0;
  while (i < n && !closes(i)) i++;
  if (i >= n) return null;
  // Of the points near the end, the outline starts at the nearest: a line that led to the shape is left out of it, and
  // an overshoot past the start is not counted twice.
  let best = i;
  for (let k = i + 1; k < n && closes(k); k++) if (dist(pts[k], end) < dist(pts[best], end)) best = k;
  const ring = pts.slice(best);
  const fit = classify(ring);
  if (!fit || fit.score > FIT || polyArea(fit.poly) < SOLID * polyArea(convexHull(fit.poly))) return null;
  // The clean outline starts and ends where the drawn one did: the reader looks at a closed stroke's ends to tell a
  // loop on another shape from a shape of its own.
  // A box drawn askew snaps to a level box of its own size, not the size of the box around it.
  const b = fit.upright ? { ...fit.bb, x0: fit.bb.cx - fit.upright.w / 2, x1: fit.bb.cx + fit.upright.w / 2, y0: fit.bb.cy - fit.upright.h / 2, y1: fit.bb.cy + fit.upright.h / 2, w: fit.upright.w, h: fit.upright.h } : fit.bb;
  const clean = startNear(cleanOutline(fit.kind, b), pts[best]);
  return { kind: fit.kind, pts: clean, from: best, box: bbox(clean) };
}

/** A closed outline (its last point is its first) turned to start at its point nearest p. */
function startNear(closed: Point[], p: Point): Point[] {
  const ring = closed.slice(0, -1);
  let k = 0;
  for (let i = 1; i < ring.length; i++) if (dist(ring[i], p) < dist(ring[k], p)) k = i;
  const turned = [...ring.slice(k), ...ring.slice(0, k)];
  return [...turned, [turned[0][0], turned[0][1]]];
}

/** A nearly straight line from the anchor to the end: no hook, no bend, and no wander off the line between them. */
function line(pts: readonly Point[], anchor: number): Snap | null {
  const a = pts[anchor], b = pts[pts.length - 1], chord = dist(a, b);
  if (chord < 24) return null;
  const part = pts.slice(anchor);
  if (pathLength(part) > 1.12 * chord) return null;
  for (const p of part) if (segDist(p, a, b) > 0.07 * chord + 3) return null;
  const ends: Point[] = [[a[0], a[1]], [b[0], b[1]]];
  return { kind: "line", pts: ends, from: anchor, box: bbox(ends) };
}

/**
 * A clean arrow in one stroke, in drawing units: a straight line from the tail to the tip, then its head, one barb out
 * and back through the tip and then the other, as people draw it and the reader reads it. A two-way arrow begins with
 * the same head at its tail, drawn the other way round. The barbs are a fixed size on screen, and never more than a
 * third of the line, or a quarter of a two-way one.
 */
export function cleanArrow(tail: Point, tip: Point, scale: number, both = false): Point[] {
  const len = dist(tail, tip), a = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]), b = Math.min(14 / scale, len / (both ? 4 : 3));
  const step = 3 / scale, out: Point[] = [];
  const to = (p: Point, q: Point) => {
    const m = Math.max(1, Math.ceil(dist(p, q) / step));
    for (let i = 1; i <= m; i++) out.push([p[0] + ((q[0] - p[0]) * i) / m, p[1] + ((q[1] - p[1]) * i) / m]);
  };
  // A barb from an end, back along the line: from the tip toward the tail, or from the tail toward the tip.
  const barb = (end: Point, back: 1 | -1, s: number): Point => [end[0] - back * b * Math.cos(a + s), end[1] - back * b * Math.sin(a + s)];
  if (both) {
    const one = barb(tail, -1, -0.5), two = barb(tail, -1, 0.5);
    out.push(one);
    to(one, tail);
    to(tail, two);
    to(two, tail);
  } else out.push([tail[0], tail[1]]);
  to(tail, tip);
  to(tip, barb(tip, 1, 0.5));
  to(barb(tip, 1, 0.5), tip);
  to(tip, barb(tip, 1, -0.5));
  return out;
}
