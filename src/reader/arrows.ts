/** Arrowheads drawn in the same stroke as their line: a hook at the tip. */
import { bbox, convexHull, dist, pathLength, polyArea, walk, type Point } from "./geometry.ts";

/** How sharply a stroke turns at a point: the cosine between the way it came and the way it goes, or NONE too near an end. */
function turnAt(p: readonly Point[], i: number): number {
  const back = walk(p, i, 7, -1), fwd = walk(p, i, 6, 1);
  const v1 = [p[i][0] - back[0], p[i][1] - back[1]], v2 = [fwd[0] - p[i][0], fwd[1] - p[i][1]];
  const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
  return n1 < 3 || n2 < 3 ? NONE : (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
}
const NONE = 2;

/**
 * The first sharp turn back in the last `tail` of a stroke, where it is sharpest, or -1. `turns`, when given, keeps
 * each point's turn once measured, for the searches that look over the same stroke.
 */
function firstTurn(p: readonly Point[], tail: number, from = 0, turns?: Float64Array): number {
  let walked = 0, k = p.length - 1;
  while (k > from && walked < tail) {
    walked += dist(p[k], p[k - 1]);
    k--;
  }
  let best = -1, bestCos = -0.3;
  for (let i = Math.max(1, k); i < p.length - 1; i++) {
    let cos = turns ? turns[i] : NaN;
    if (Number.isNaN(cos)) {
      cos = turnAt(p, i);
      if (turns) turns[i] = cos;
    }
    if (cos === NONE) continue;
    if (cos < bestCos) {
      best = i;
      bestCos = cos;
    } else if (best >= 0) break;
  }
  return best;
}

/**
 * Where a hook at the far end of a line begins (its tip), or -1. A hook is the first sharp turn back near the end,
 * after which the stroke doubles back and stays close to the tip; a plain stretch of line does neither. Some draw the
 * head with long barbs, one out and back through the tip and then the other: half the stroke or more, so the tip is
 * looked for farther back, and such a head must be just that, two barbs and no more turns, each no longer than half
 * the line.
 */
export function hookAt(p: readonly Point[]): number {
  const length = pathLength(p), turns = new Float64Array(p.length).fill(NaN);
  let near = firstTurn(p, Math.min(0.7 * length, Math.max(60, 0.4 * length)), 0, turns);
  if (near >= 0) {
    const h = p.slice(near), rest = pathLength(h), out = Math.max(...h.map((q) => dist(q, p[near])));
    if (!(rest >= 6 && rest <= 90 && rest >= 1.5 * out && out <= Math.max(28, 0.5 * (length - rest)))) near = -1;
  }
  // A long or big head's tip comes before its first barb's turn, which can pass for a short hook of its own.
  let at = near;
  for (const t of [longHead(p, length, turns), bigHead(p, length, turns)]) if (t >= 0 && (at < 0 || t < at)) at = t;
  return at;
}

/**
 * Where a head as big as its line begins (its tip), or -1: a short line drawn with both barbs, one out and back
 * through the tip and then the other, each up to as long as the line. So big a head must be just that: a straight line
 * to the tip, two barbs that open back along it, and no more turns.
 */
function bigHead(p: readonly Point[], length: number, turns?: Float64Array): number {
  // Only a short line's head can be as big as the line.
  if (length > BIG_HEAD_LINE) return -1;
  const at = firstTurn(p, 0.85 * length, 0, turns);
  if (at < 0) return -1;
  const h = p.slice(at), tip = p[at], rest = pathLength(h), shaft = length - rest;
  const far = h.reduce((a, q) => (dist(q, tip) > dist(a, tip) ? q : a)), out = dist(far, tip);
  if (shaft < 10 || out > 1.25 * shaft || rest < 2.2 * out || rest > 3.6 * out || dist(p[0], tip) < 0.9 * shaft) return -1;
  if (!twoBarbs(h, tip, out)) return -1;
  // Both barbs open back along the line: their ends lie behind the tip.
  const ux = (tip[0] - p[0][0]) / dist(p[0], tip), uy = (tip[1] - p[0][1]) / dist(p[0], tip);
  const back = (q: Point) => (q[0] - tip[0]) * ux + (q[1] - tip[1]) * uy < -0.2 * out;
  return back(far) && back(h[h.length - 1]) ? at : -1;
}

/** Whether a head goes out along one barb, back through the tip, and out along the other, with few turns. */
function twoBarbs(h: readonly Point[], tip: Point, out: number): boolean {
  let i = 0;
  while (i < h.length && dist(h[i], tip) < 0.6 * out) i++;
  while (i < h.length && dist(h[i], tip) > Math.max(10, 0.25 * out)) i++;
  const back = i;
  while (i < h.length && dist(h[i], tip) < 0.5 * out) i++;
  if (back >= h.length || i >= h.length) return false;
  // Two turns back, at the first barb's end and at the tip: a scribble turns many more times.
  let turns = 0;
  for (let j = 0, from = 0; j < 4; j++) {
    const t = firstTurn(h, pathLength(h.slice(from)), from);
    if (t < 0 || t <= from) break;
    turns++;
    from = t + 1;
  }
  return turns <= 3;
}

/** The longest stroke, line and head together, that a head as big as its line is looked for in. */
const BIG_HEAD_LINE = 480;

/** Where a head with long barbs, one out and back through the tip and then the other, begins (its tip), or -1. */
function longHead(p: readonly Point[], length: number, turns?: Float64Array): number {
  const at = firstTurn(p, Math.min(0.7 * length, Math.max(60, 0.6 * length)), 0, turns);
  if (at < 0) return -1;
  const h = p.slice(at), tip = p[at], rest = pathLength(h), out = Math.max(...h.map((q) => dist(q, tip)));
  if (rest <= 90 || rest > 3.5 * out || out > 0.5 * (length - rest)) return -1;
  return twoBarbs(h, tip, out) ? at : -1;
}

/** The widest a knot may be, the least ink it holds, and the least line that goes on from it. */
const KNOT = 40, KNOT_INK = 120, KNOT_LINE = 20;

/**
 * A head filled in at the start of a line, in the same stroke: a knot of ink in a small place, with the line going on
 * from it. Gives where the line leaves the knot, and the knot's tip (its point farthest from the line's other end), or
 * null. A state diagram's start dot is a smaller knot: `size` and `ink` set how wide it may be and how much ink it holds.
 */
export function knotAt(p: readonly Point[], size = KNOT, least = KNOT_INK): { at: number; tip: Point } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, end = -1;
  for (let i = 0; i < p.length; i++) {
    x0 = Math.min(x0, p[i][0]);
    y0 = Math.min(y0, p[i][1]);
    x1 = Math.max(x1, p[i][0]);
    y1 = Math.max(y1, p[i][1]);
    if (Math.max(x1 - x0, y1 - y0) > size) break;
    end = i;
  }
  if (end < 2 || end === p.length - 1) return null;
  const knot = p.slice(0, end + 1), ink = pathLength(knot), rest = pathLength(p) - ink;
  if (ink < least || rest < KNOT_LINE) return null;
  const far = p[p.length - 1];
  return { at: end, tip: knot.reduce((a, q) => (dist(q, far) > dist(a, far) ? q : a)) };
}

/** The line without the hooks and knots at its ends, and which ends had one. */
export function trimHooks(pts: readonly Point[]): { pts: Point[]; headEnd: boolean; headStart: boolean } {
  let p = pts.slice(), headEnd = false, headStart = false;
  // Knots first: a knot is no hook, and a short line's hook search would reach into a knot at its other end.
  const ks = knotAt(p);
  if (ks) {
    p = [ks.tip, ...p.slice(ks.at)];
    headStart = true;
  }
  const ke = knotAt(p.slice().reverse());
  if (ke) {
    p = [...p.slice(0, p.length - ke.at), ke.tip];
    headEnd = true;
  }
  const i = headEnd ? -1 : hookAt(p);
  if (i >= 0) {
    p = p.slice(0, i + 1);
    headEnd = true;
  }
  const r = p.slice().reverse(), j = headStart ? -1 : hookAt(r);
  if (j >= 0) {
    p = r.slice(0, j + 1).reverse();
    headStart = true;
  }
  return { pts: p, headEnd, headStart };
}

/**
 * A closed head at the far end of a line, drawn in the same stroke: after the line, the stroke goes round a small
 * triangle and back to where it left the line, either the triangle's tip or the middle of its back. Gives where the
 * line ends and the triangle's tip, or null.
 */
export function closedHeadAt(p: readonly Point[]): { at: number; tip: Point } | null {
  const n = p.length, end = p[n - 1];
  // Back from the end, past at least a small loop, the place the stroke comes nearest its end again.
  let walked = 0, at = -1;
  for (let i = n - 2; i > 0; i--) {
    walked += dist(p[i], p[i + 1]);
    if (walked < 24) continue;
    const d = dist(p[i], end);
    if (d <= Math.max(8, 0.12 * walked)) {
      if (at < 0 || d < dist(p[at], end)) at = i;
    } else if (at >= 0) break;
  }
  if (at < 0) return null;
  const head = p.slice(at), b = bbox(head), size = Math.max(b.w, b.h), around = pathLength(head), line = pathLength(p.slice(0, at + 1));
  // A triangle much over half as big as the line is more likely a shape the line leads to than its head.
  if (size < 8 || line < Math.max(20, size / 0.55) || around < 2.4 * size || around > 4.2 * size) return null;
  // A triangle: three of its corners take in most of what it covers, as a box's or a ring's do not.
  const hull = convexHull(head), whole = polyArea(hull);
  if (!(whole > 0) || polyArea(head) < 0.75 * whole || largestTriangle(hull) < 0.75 * whole) return null;
  // The tip is the head's point farthest along the way the line goes into it, near the line carried on. A head spreads
  // to both sides of the line, as a triangle shape the line runs into along one of its sides does not.
  const from = walk(p, at, Math.min(40, 0.5 * line), -1), d = dist(from, p[at]);
  if (d < 1) return null;
  const ux = (p[at][0] - from[0]) / d, uy = (p[at][1] - from[1]) / d;
  let tip = head[0], far = -Infinity, left = 0, right = 0;
  for (const q of head) {
    const f = (q[0] - p[at][0]) * ux + (q[1] - p[at][1]) * uy, side = (q[0] - p[at][0]) * uy - (q[1] - p[at][1]) * ux;
    if (f > far) {
      far = f;
      tip = q;
    }
    left = Math.max(left, side);
    right = Math.max(right, -side);
  }
  if (Math.min(left, right) < 0.25 * size) return null;
  return Math.abs((tip[0] - p[at][0]) * uy - (tip[1] - p[at][1]) * ux) <= 0.6 * size ? { at, tip } : null;
}

/** The area of the largest triangle with its corners on a convex outline. */
function largestTriangle(hull: readonly Point[]): number {
  const h = hull.length > 48 ? hull.filter((_, i) => i % Math.ceil(hull.length / 48) === 0) : hull;
  let best = 0;
  for (let i = 0; i < h.length; i++)
    for (let j = i + 1; j < h.length; j++)
      for (let k = j + 1; k < h.length; k++) {
        const a = Math.abs((h[j][0] - h[i][0]) * (h[k][1] - h[i][1]) - (h[k][0] - h[i][0]) * (h[j][1] - h[i][1])) / 2;
        if (a > best) best = a;
      }
  return best;
}

/**
 * A straight arrow drawn in one stroke, its head last: its tail and its tip, or null. The head may be open, a hook or
 * two barbs, or closed, a small triangle. The line must be nearly straight: the sides of a triangle or a trapezoid left
 * once its last side is taken for a head are not, so a shape is never taken for an arrow.
 */
export function oneStrokeArrow(pts: readonly Point[]): { tail: Point; tip: Point } | null {
  const straight = (line: readonly Point[]) => {
    const len = pathLength(line), tail = line[0], tip = line[line.length - 1];
    return len >= 30 && dist(tail, tip) >= 0.85 * len ? { tail, tip } : null;
  };
  const c = closedHeadAt(pts), closed = c && straight([...pts.slice(0, c.at + 1), c.tip]);
  if (closed) return closed;
  const t = trimHooks(pts);
  return t.headEnd && !t.headStart ? straight(t.pts) : null;
}
