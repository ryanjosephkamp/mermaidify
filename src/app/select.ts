/**
 * Choosing strokes and moving them: which strokes a box, a lasso, or a press takes, the box around them, and the strokes
 * moved, turned, grown, or copied. Every point is in drawing units.
 */
import { bbox, densify, dist, inside, segDist, type Box, type Point } from "../reader/geometry.ts";
import type { DrawnStroke } from "./pad.ts";

/** A move of the chosen strokes: turned by `angle` and grown by `scale` about (cx, cy), then shifted by (dx, dy). */
export interface Move {
  dx: number;
  dy: number;
  angle: number;
  scale: number;
  cx: number;
  cy: number;
}
export const still = (cx = 0, cy = 0): Move => ({ dx: 0, dy: 0, angle: 0, scale: 1, cx, cy });

export function moved(p: Point, m: Move): Point {
  const x = (p[0] - m.cx) * m.scale, y = (p[1] - m.cy) * m.scale, c = Math.cos(m.angle), s = Math.sin(m.angle);
  return [m.cx + x * c - y * s + m.dx, m.cy + x * s + y * c + m.dy];
}

/** Whether a stroke comes back near its start, so that what lies inside it goes with it. */
function closed(s: DrawnStroke): boolean {
  if (s.pts.length < 8) return false;
  const b = bbox(s.pts);
  return Math.min(b.w, b.h) > 8 && dist(s.pts[0], s.pts[s.pts.length - 1]) < Math.max(14, 0.25 * Math.hypot(b.w, b.h));
}

/**
 * The strokes chosen with `ids`, and with them every stroke drawn inside one of them (a box's contents, a ring's dot,
 * the states inside a composite state) and every stroke grouped with one of them.
 */
export function withKin(strokes: readonly DrawnStroke[], ids: Iterable<number>): Set<number> {
  const out = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    const groups = new Set(strokes.filter((s) => out.has(s.id) && s.group !== undefined).map((s) => s.group));
    const rings = strokes.filter((s) => out.has(s.id) && closed(s));
    for (const s of strokes) {
      if (out.has(s.id)) continue;
      const b = bbox(s.pts);
      const within = rings.some((r) => {
        const rb = bbox(r.pts);
        return b.x0 >= rb.x0 && b.x1 <= rb.x1 && b.y0 >= rb.y0 && b.y1 <= rb.y1 && s.pts.every((p, i) => i % 4 !== 0 || inside(p, r.pts));
      });
      if ((s.group !== undefined && groups.has(s.group)) || within) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * The strokes a lasso takes: each one with any part inside it, with their kin. A stroke is looked at every few units
 * along it, so a straightened line, which is only its two ends, is taken by its middle too.
 */
export function lassoed(strokes: readonly DrawnStroke[], lasso: readonly Point[]): Set<number> {
  if (lasso.length < 3) return new Set();
  const lb = bbox(lasso), hit: number[] = [], step = Math.max(2, Math.min(lb.w, lb.h) / 4);
  for (const s of strokes) {
    const b = bbox(s.pts);
    if (b.x1 < lb.x0 || b.x0 > lb.x1 || b.y1 < lb.y0 || b.y0 > lb.y1) continue;
    if ((s.pts.length > 1 ? densify(s.pts, step) : s.pts).some((p) => inside(p, lasso))) hit.push(s.id);
  }
  return withKin(strokes, hit);
}

/** The stroke nearest a tap within `r`, with its kin, or nothing. */
export function tapped(strokes: readonly DrawnStroke[], p: Point, r: number): Set<number> {
  const id = nearest(strokes, p, r);
  return id === null ? new Set() : withKin(strokes, [id]);
}

/** The stroke nearest a point, within `r` of it, or null. */
export function nearest(strokes: readonly DrawnStroke[], p: Point, r: number): number | null {
  let best: { id: number; d: number } | null = null;
  for (const s of strokes) {
    const q = s.pts;
    for (let i = 0; i < q.length; i++) {
      const d = q.length === 1 ? dist(p, q[0]) : segDist(p, q[i], q[Math.min(i + 1, q.length - 1)]);
      if (d <= r && (!best || d < best.d)) best = { id: s.id, d };
    }
  }
  return best?.id ?? null;
}

/**
 * The smallest closed stroke a point is inside, so a box can be taken by its middle as well as by its outline, or null.
 * A shape that holds other shapes, a group's frame or a composite state, is taken only by its outline, so a box can be
 * dragged out inside it.
 */
export function around(strokes: readonly DrawnStroke[], p: Point): number | null {
  let best: { s: DrawnStroke; b: Box } | null = null;
  const rings = strokes.filter(closed);
  for (const s of rings) {
    const b = bbox(s.pts);
    if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1 || !inside(p, s.pts)) continue;
    if (!best || b.w * b.h < best.b.w * best.b.h) best = { s, b };
  }
  if (!best) return null;
  const { s, b } = best;
  const holds = rings.some((r) => {
    if (r === s) return false;
    const rb = bbox(r.pts);
    return rb.x0 >= b.x0 && rb.x1 <= b.x1 && rb.y0 >= b.y0 && rb.y1 <= b.y1;
  });
  return holds ? null : s.id;
}

/** The corners of the box between two points, as a closed outline for `lassoed`. */
export const boxPath = (a: Point, b: Point): Point[] => [a, [b[0], a[1]], b, [a[0], b[1]], a];

/** The box around the chosen strokes, or null when none is chosen. */
export function boxOf(strokes: readonly DrawnStroke[], ids: ReadonlySet<number>): Box | null {
  const pts = strokes.filter((s) => ids.has(s.id)).flatMap((s) => s.pts);
  return pts.length ? bbox(pts) : null;
}

/** The drawing with the chosen strokes moved; each keeps its id, so its names and choices go with it. */
export function moveStrokes(strokes: readonly DrawnStroke[], ids: ReadonlySet<number>, m: Move): DrawnStroke[] {
  return strokes.map((s) => (ids.has(s.id) ? { ...s, pts: s.pts.map((p) => moved(p, m)), open: s.open } : s));
}

/**
 * Copies of the chosen strokes, shifted by (dx, dy), with new ids from `next`. Strokes grouped together stay grouped
 * together in the copy, in a group numbered above every group in `all`, apart from the strokes they were copied from.
 * Gives the copies and each copy's original's id.
 */
export function copyStrokes(
  strokes: readonly DrawnStroke[],
  ids: ReadonlySet<number>,
  dx: number,
  dy: number,
  next: () => number,
  all: readonly DrawnStroke[] = strokes,
): { copies: DrawnStroke[]; from: Map<number, number> } {
  const regroup = new Map<number, number>(), from = new Map<number, number>(), copies: DrawnStroke[] = [];
  let top = Math.max(0, ...all.map((s) => s.group ?? 0));
  for (const s of strokes) {
    if (!ids.has(s.id)) continue;
    const id = next();
    let group = s.group;
    if (group !== undefined) {
      if (!regroup.has(group)) regroup.set(group, ++top);
      group = regroup.get(group);
    }
    copies.push({ ...s, id, pts: s.pts.map(([x, y]): Point => [x + dx, y + dy]), ...(group !== undefined ? { group } : {}) });
    from.set(id, s.id);
  }
  return { copies, from };
}

/** A turn snapped to the nearest 15 degrees, which keeps boxes square and lines straight. */
export const snapAngle = (a: number) => Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
