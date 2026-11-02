/** Plane geometry for strokes: a point is [x, y] in the drawing's units (CSS pixels at the default zoom). */

export type Point = [number, number];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pathLength(p: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < p.length; i++) length += dist(p[i - 1], p[i]);
  return length;
}

export function bbox(p: readonly Point[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** n points spaced evenly along the path. */
export function resample(points: readonly Point[], n: number): Point[] {
  const p: Point[] = points.map((q) => [q[0], q[1]]);
  const step = pathLength(p) / (n - 1);
  if (!(step > 0)) return Array.from({ length: n }, (): Point => [p[0][0], p[0][1]]);
  const out: Point[] = [[p[0][0], p[0][1]]];
  let walked = 0;
  for (let i = 1; i < p.length; i++) {
    const d = dist(p[i - 1], p[i]);
    if (walked + d >= step && d > 0) {
      const t = (step - walked) / d;
      const q: Point = [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])];
      out.push(q);
      p.splice(i, 0, q);
      walked = 0;
    } else walked += d;
  }
  const last = p[p.length - 1];
  while (out.length < n) out.push([last[0], last[1]]);
  return out.slice(0, n);
}

/** The point halfway along a path. */
export function halfway(p: readonly Point[]): Point {
  let left = pathLength(p) / 2;
  for (let i = 1; i < p.length; i++) {
    const d = dist(p[i - 1], p[i]);
    if (d >= left && d > 0) return [p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * left) / d, p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * left) / d];
    left -= d;
  }
  return [p[p.length - 1][0], p[p.length - 1][1]];
}

/** Distance from p to the segment ab. */
export function segDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Distance from p to the outline of a closed polygon. */
export function polyDist(p: Point, poly: readonly Point[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return m;
}

/** Distance from p to an open polyline. */
export function lineDist(p: Point, line: readonly Point[]): number {
  let m = line.length ? dist(p, line[0]) : Infinity;
  for (let i = 1; i < line.length; i++) m = Math.min(m, segDist(p, line[i - 1], line[i]));
  return m;
}

/** Whether p is inside a closed polygon (even-odd). */
export function inside(p: Point, poly: readonly Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The polyline with extra points so that no two neighbors are more than `step` apart. */
export function densify(poly: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1], n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const last = poly[poly.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** The point reached by walking at least d along the path from index i, forward (dir 1) or back (dir -1). */
export function walk(p: readonly Point[], i: number, d: number, dir: 1 | -1): Point {
  let walked = 0, j = i;
  while (j + dir >= 0 && j + dir < p.length && walked < d) {
    walked += dist(p[j], p[j + dir]);
    j += dir;
  }
  return p[j];
}

/** The area inside a closed outline (the shoelace formula). */
export function polyArea(p: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a) / 2;
}
/** The convex hull of some points (Andrew's monotone chain). */
export function convexHull(points: readonly Point[]): Point[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half(p.slice().reverse())];
}
