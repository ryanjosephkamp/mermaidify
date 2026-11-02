/** Which shape a closed outline is: it is stretched to the unit square and compared with each template. */
import { bbox, dist, pathLength, polyDist, resample, type Box, type Point } from "./geometry.ts";

/**
 * What a closed outline can be on its own. Pairs and nesting add "double" and "subroutine" later, and ink filled in
 * adds "dot" (a filled dot) and "bullseye" (a ring with a filled dot inside).
 */
export type OutlineKind =
  | "rect"
  | "diamond"
  | "hexagon"
  | "trapezoid"
  | "inv-trapezoid"
  | "lean-right"
  | "lean-left"
  | "triangle"
  | "flip-triangle"
  | "circle"
  | "stadium";
export type ShapeKind = OutlineKind | "subroutine" | "double" | "dot" | "bullseye";

const N = 64;

/** Each template outline in the unit square. The ellipse stands for the circle and the oval. */
export const TEMPLATES: Record<Exclude<OutlineKind, "circle" | "stadium"> | "ellipse", Point[]> = {
  rect: [[0, 0], [1, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  hexagon: [[0.22, 0], [0.78, 0], [1, 0.5], [0.78, 1], [0.22, 1], [0, 0.5]],
  trapezoid: [[0.22, 0], [0.78, 0], [1, 1], [0, 1]],
  "inv-trapezoid": [[0, 0], [1, 0], [0.78, 1], [0.22, 1]],
  "lean-right": [[0.22, 0], [1, 0], [0.78, 1], [0, 1]],
  "lean-left": [[0, 0], [0.78, 0], [1, 1], [0.22, 1]],
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  "flip-triangle": [[0, 0], [1, 0], [0.5, 1]],
  ellipse: Array.from({ length: 48 }, (_, i): Point => [0.5 + 0.5 * Math.cos((i * Math.PI) / 24), 0.5 + 0.5 * Math.sin((i * Math.PI) / 24)]),
};
type Template = keyof typeof TEMPLATES;
const DENSE = Object.fromEntries(
  Object.entries(TEMPLATES).map(([k, poly]) => [k, resample([...poly, poly[0]], N)]),
) as Record<Template, Point[]>;

/**
 * Shapes only ever drawn large enough to hold a name: smaller than this across, an outline is never one of them, as a
 * closed arrowhead is a small triangle.
 */
const LARGE: ReadonlySet<Template> = new Set(["triangle", "flip-triangle", "lean-right", "lean-left", "inv-trapezoid"]);
const LARGE_MIN = 60;

/** The template a shape kind is drawn with. */
export const OUTLINE: Record<ShapeKind, Template> = {
  rect: "rect",
  subroutine: "rect",
  diamond: "diamond",
  hexagon: "hexagon",
  trapezoid: "trapezoid",
  "inv-trapezoid": "inv-trapezoid",
  "lean-right": "lean-right",
  "lean-left": "lean-left",
  triangle: "triangle",
  "flip-triangle": "flip-triangle",
  circle: "ellipse",
  stadium: "ellipse",
  double: "ellipse",
  dot: "ellipse",
  bullseye: "ellipse",
};
export const ROUND: ReadonlySet<ShapeKind> = new Set(["circle", "stadium", "double"]);

/** Sharp corners on a closed, evenly spaced outline: turns well above the outline's usual turn. */
export function corners(p: readonly Point[]): number {
  const n = p.length, k = 2, turn: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - k + n) % n], b = p[i], c = p[(i + k) % n];
    let d = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]));
    if (d > Math.PI) d = 2 * Math.PI - d;
    turn.push(d);
  }
  const sorted = turn.slice().sort((x, y) => x - y), floor = Math.max(0.6, 2.2 * sorted[n >> 1]);
  const peaks = turn
    .map((t, i): [number, number] => [t, i])
    .filter(([t]) => t > floor)
    .sort((x, y) => y[0] - x[0]);
  const kept: number[] = [];
  for (const [, i] of peaks) if (kept.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) > 3)) kept.push(i);
  return kept.length;
}

export interface Fit {
  kind: OutlineKind;
  /** Mean distance between the outline and the template, in the unit square: 0 is a perfect fit. */
  score: number;
  /** The fit is poor enough that the shape is worth a second look. */
  unsure: boolean;
  bb: Box;
  /** The outline, evenly resampled, in drawing units. */
  poly: Point[];
  /** For a box drawn askew, its own width and height, turned level: the box it stands for. */
  upright?: { w: number; h: number };
}

/**
 * How far an outline is turned, in radians, when that is a little: the turn that most shrinks its box, up to 25
 * degrees either way. A box drawn askew has its smallest box at its own tilt; a diamond's keeps shrinking toward 45
 * degrees, so it has none in that range, and a level outline has none either.
 */
function tilt(ring: readonly Point[]): number {
  const MAX = 25, area = (deg: number) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
      const u = x * c + y * s, v = y * c - x * s;
      x0 = Math.min(x0, u);
      x1 = Math.max(x1, u);
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
    return (x1 - x0) * (y1 - y0);
  };
  let best = 0, least = area(0);
  for (let d = -MAX; d <= MAX; d++) {
    const a = area(d);
    if (a < least) [best, least] = [d, a];
  }
  return Math.abs(best) < 3 || Math.abs(best) >= MAX ? 0 : (best * Math.PI) / 180;
}

/** The closest template to a closed outline, or null when the outline is too small to be a shape. */
export function classify(pts: readonly Point[]): Fit | null {
  const bb = bbox(pts);
  if (bb.w < 12 || bb.h < 12) return null;
  const ring = resample(pts, N);
  // Sharp corners do not change as the outline turns, so they are counted once.
  const n = corners(resample(pts, 40)), small = Math.max(bb.w, bb.h) < LARGE_MIN;
  const level = fitLevel(ring, bb, n, small), a = tilt(ring);
  if (!a) return { ...level, bb, poly: ring };
  // A box drawn askew is still a box: the outline turned level is read again, and when that reading, with all its
  // tests, is a box that fits better, it is one. Any other shape keeps the reading as drawn, as turning a trapezoid, a
  // hexagon, or an oval a little can make it fit a box better than its own outline.
  const c = Math.cos(a), s = Math.sin(a), turned = ring.map(([x, y]): Point => [x * c + y * s, y * c - x * s]);
  const tb = bbox(turned), other = fitLevel(turned, tb, n, small);
  return other.kind === "rect" && other.score < level.score ? { ...other, bb, poly: ring, upright: { w: tb.w, h: tb.h } } : { ...level, bb, poly: ring };
}

/** The closest template to an evenly resampled closed outline as it lies, with its box and its count of sharp corners. */
function fitLevel(ring: readonly Point[], bb: Box, n: number, small: boolean): Omit<Fit, "bb" | "poly"> {
  const unit = ring.map(([x, y]): Point => [(x - bb.x0) / bb.w, (y - bb.y0) / bb.h]);
  // How far the outline lies from each template is quick to find; how far each template lies from the outline is
  // slow, so it is found only for the nearest few, and for the ellipse, which the corner count below compares.
  const near = (Object.keys(TEMPLATES) as Template[])
    .filter((k) => small === false || !LARGE.has(k))
    .map((k) => {
      let a = 0;
      for (const p of unit) a += polyDist(p, TEMPLATES[k]);
      return { kind: k, a };
    })
    .sort((x, y) => x.a - y.a);
  const scores = near
    .filter((x, i) => i < 4 || x.kind === "ellipse")
    .map(({ kind, a }) => {
      let b = 0;
      for (const q of DENSE[kind]) b += polyDist(q, unit);
      return { kind, score: (a + b) / (2 * N) };
    })
    .sort((x, y) => x.score - y.score);
  let pick = scores[0];
  const second = scores[1];
  // Counting sharp corners settles close calls between round and cornered shapes.
  if (pick.kind === "ellipse" && n >= 4 && second.score < pick.score + 0.03) pick = second;
  else if (pick.kind !== "ellipse" && n <= 2) {
    const e = scores.find((x) => x.kind === "ellipse")!;
    if (e.score < pick.score + 0.03) pick = e;
  }
  const aspect = bb.w / bb.h;
  const kind: OutlineKind = pick.kind === "ellipse" ? (aspect > 0.77 && aspect < 1.3 ? "circle" : "stadium") : pick.kind;
  return { kind, score: pick.score, unsure: pick.score > 0.1 };
}

/**
 * The closed part of a stroke drawn back to its start: from and to the two points, one within a fifth of its length of
 * each end, that lie nearest each other. The overshoot past the start, and any lead-in before it, are left out.
 */
export function closedPart(p: readonly Point[]): Point[] {
  const n = p.length, len = pathLength(p);
  // The points within a fifth of the length of each end, at most 80 of them each way, so a long stroke stays quick.
  const ends = (from: number, step: 1 | -1): number[] => {
    const out: number[] = [];
    for (let i = from, w = 0; i >= 0 && i < n && w <= 0.2 * len; w += i + step >= 0 && i + step < n ? dist(p[i], p[i + step]) : 0, i += step) out.push(i);
    const stride = Math.ceil(out.length / 80);
    return out.filter((_, k) => k % stride === 0);
  };
  const head = ends(0, 1), tail = ends(n - 1, -1);
  let bi = 0, bj = n - 1, bd = dist(p[0], p[n - 1]);
  for (const i of head)
    for (const j of tail) {
      if (j <= i + 2) continue;
      const d = dist(p[i], p[j]);
      if (d < bd - 1e-9) [bd, bi, bj] = [d, i, j];
    }
  return p.slice(bi, bj + 1);
}

/** How near a stroke's end comes back to its start (and its start to its end), allowing for overshoot. */
export function closure(p: readonly Point[], length: number): number {
  const n = p.length, first = p[0], last = p[n - 1];
  let m = dist(first, last), walked = 0;
  for (let k = 1; k < n && walked < 0.2 * length; k++) {
    walked += dist(p[k - 1], p[k]);
    m = Math.min(m, dist(p[k], last));
  }
  walked = 0;
  for (let k = n - 2; k >= 0 && walked < 0.2 * length; k--) {
    walked += dist(p[k + 1], p[k]);
    m = Math.min(m, dist(p[k], first));
  }
  return m;
}
