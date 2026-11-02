/**
 * Erasing part of a stroke: the ink a swept path passes over is cut away, and what is left of each stroke it touches
 * stays, in pieces, where the stroke was.
 */
import { bbox, dist, pathLength, segDist, type Point } from "../reader/geometry.ts";
import { closure } from "../reader/shapes.ts";

export interface Cut<T> {
  /** The strokes, with each one the path touched replaced by its pieces, in its place. */
  strokes: T[];
  /** Each cut stroke's pieces, by the stroke's id: none when it was cut away whole. */
  pieces: Map<number, number[]>;
}

/**
 * Whether a stroke is an outline drawn back to its start, as the reader tells one: big, long enough, and closed, at the
 * size it was drawn on screen.
 */
function outline(drawn: readonly Point[], zoom = 1): boolean {
  if (drawn.length < 3) return false;
  const z = zoom >= 0.01 && zoom <= 100 ? zoom : 1, pts = drawn.map(([x, y]): Point => [x * z, y * z]);
  const len = pathLength(pts), bb = bbox(pts as Point[]);
  const big = Math.max(bb.w, bb.h) >= 28 && Math.min(bb.w, bb.h) >= 18;
  return big && len > 1.3 * (bb.w + bb.h) && closure(pts, len) < Math.max(14, 0.22 * Math.hypot(bb.w, bb.h));
}

/**
 * Cuts away the parts of strokes within `r` of the path. A stroke keeps its own points; where the path crosses it, the
 * points the cut begins and ends at are added, found along the stroke a quarter of `r` apart, so a cut across the
 * middle of a snapped shape's long straight side cuts there. An outline drawn back to its start and cut once is one
 * open piece, and a piece is open for good: a later cut never joins its ends. A piece shorter than `least` is dropped,
 * as a sliver is no use to the reader. `id` gives each piece its own id.
 */
export function cut<T extends { id: number; pts: Point[]; open?: boolean; zoom?: number }>(
  strokes: readonly T[],
  path: readonly Point[],
  r: number,
  id: () => number,
  least = 3,
): Cut<T> {
  const pieces = new Map<number, number[]>(), out: T[] = [];
  if (!path.length || !(r > 0)) return { strokes: strokes.slice(), pieces };
  const pb = bbox(path as Point[]);
  const near = (q: Point) => {
    if (q[0] < pb.x0 - r || q[0] > pb.x1 + r || q[1] < pb.y0 - r || q[1] > pb.y1 + r) return false;
    if (path.length === 1) return dist(q, path[0]) <= r;
    for (let i = 0; i < path.length - 1; i++) if (segDist(q, path[i], path[i + 1]) <= r) return true;
    return false;
  };
  for (const s of strokes) {
    const b = bbox(s.pts);
    if (!s.pts.length || b.x1 < pb.x0 - r || b.x0 > pb.x1 + r || b.y1 < pb.y0 - r || b.y0 > pb.y1 + r) {
      out.push(s);
      continue;
    }
    // The stroke's points, and between them points a quarter of r apart, each marked as the stroke's own or not.
    const pts: Point[] = [], own: boolean[] = [];
    for (let i = 0; i < s.pts.length; i++) {
      const a = s.pts[i], b = s.pts[i + 1];
      pts.push(a);
      own.push(true);
      if (!b) break;
      const n = Math.ceil(dist(a, b) / (r / 4));
      for (let k = 1; k < n; k++) {
        pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        own.push(false);
      }
    }
    const gone = pts.map(near);
    if (!gone.some(Boolean)) {
      out.push(s);
      continue;
    }
    // What is left: the stroke's own points, and the points next to the cut, where each piece now begins or ends.
    const runs: Point[][] = [];
    let run: Point[] = [];
    pts.forEach((q, i) => {
      if (gone[i]) {
        if (run.length) runs.push(run);
        run = [];
      } else if (own[i] || gone[i - 1] || gone[i + 1]) run.push(q);
    });
    if (run.length) runs.push(run);
    if (runs.length >= 2 && !s.open && !gone[0] && !gone[pts.length - 1] && outline(s.pts, s.zoom)) runs.unshift([...runs.pop()!, ...runs.shift()!]);
    const kept: number[] = [];
    for (const left of runs)
      if (left.length >= 2 && pathLength(left) >= least) {
        const piece = { ...s, id: id(), pts: left, open: true };
        kept.push(piece.id);
        out.push(piece);
      }
    pieces.set(s.id, kept);
  }
  return { strokes: out, pieces };
}
