/** Hand-made strokes for tests: each helper draws one stroke the way a person would, with a small, fixed wobble. */
import { densify, type Point } from "../src/reader/geometry.ts";
import type { Stroke } from "../src/reader/recognize.ts";

let seed = 11;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
/** Starts the wobble over, so each test draws the same strokes whatever ran before it. */
export const reset = (s = 11) => void (seed = s);

const hand = (pts: Point[], amp: number): Point[] => {
  const p1 = rnd() * 6, p2 = rnd() * 6;
  return pts.map(([x, y], i): Point => [x + Math.sin(i * 0.13 + p1) * amp, y + Math.cos(i * 0.11 + p2) * amp]);
};
const stroke = (pts: Point[], color = "ink", amp = 1.2): Stroke => ({ color, pts: hand(pts, amp) });

/** A closed outline through the corners, with a little overshoot past the start. */
const closed = (corners: Point[], color?: string) => stroke(densify([...corners, corners[0], [corners[0][0] + 3, corners[0][1] + 2]], 3), color);

export const box = (x: number, y: number, w: number, h: number, color?: string) => closed([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color);
export const diamond = (cx: number, cy: number, w: number, h: number, color?: string) =>
  closed([[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]], color);
export const hexagon = (x: number, y: number, w: number, h: number, color?: string) =>
  closed([[x + 0.2 * w, y], [x + 0.8 * w, y], [x + w, y + h / 2], [x + 0.8 * w, y + h], [x + 0.2 * w, y + h], [x, y + h / 2]], color);
/** Wide at the bottom, as Mermaid's [/ \] is. */
export const trapezoid = (x: number, y: number, w: number, h: number, color?: string) =>
  closed([[x + 0.2 * w, y], [x + 0.8 * w, y], [x + w, y + h], [x, y + h]], color);
/** Mermaid's parallelogram leans right, its top set to the right of its bottom. */
export const parallelogram = (x: number, y: number, w: number, h: number, left = false, color?: string) =>
  closed(left ? [[x, y], [x + 0.78 * w, y], [x + w, y + h], [x + 0.22 * w, y + h]] : [[x + 0.22 * w, y], [x + w, y], [x + 0.78 * w, y + h], [x, y + h]], color);
/** Wide at the top, as Mermaid's [\ /] is. */
export const invTrapezoid = (x: number, y: number, w: number, h: number, color?: string) =>
  closed([[x, y], [x + w, y], [x + 0.8 * w, y + h], [x + 0.2 * w, y + h]], color);
/** Pointing up, or down. */
export const triangle = (x: number, y: number, w: number, h: number, down = false, color?: string) =>
  closed(down ? [[x, y], [x + w, y], [x + w / 2, y + h]] : [[x + w / 2, y], [x + w, y + h], [x, y + h]], color);
export function ellipse(cx: number, cy: number, rx: number, ry: number, color?: string): Stroke {
  const a0 = rnd() * 6.28, p: Point[] = [];
  for (let i = 0; i <= 70; i++) {
    const a = a0 + (i / 64) * Math.PI * 2;
    p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return stroke(p, color);
}

export type Head = "hook" | "v" | "none";
/**
 * A line along the path. A "hook" head is drawn in the same stroke, one barb out and back and then the other; a "v" is
 * a second stroke. Barbs are `barbs` long.
 */
export function arrow(path: Point[], head: Head = "hook", color?: string, barbs = 12): Stroke[] {
  const [tx, ty] = path[path.length - 1], [px, py] = path[path.length - 2], a = Math.atan2(ty - py, tx - px);
  const barb = (s: number): Point => [tx - barbs * Math.cos(a + s), ty - barbs * Math.sin(a + s)];
  const line = densify(path, 3);
  if (head === "hook") return [stroke(line.concat(densify([[tx, ty], barb(0.5), [tx, ty], barb(-0.5)], 2)), color, 0.6)];
  if (head === "v") return [stroke(line, color, 0.6), stroke(densify([barb(0.5), [tx, ty], barb(-0.5)], 2), color, 0.3)];
  return [stroke(line, color, 0.6)];
}
/** A plain open stroke along the path. */
export const line = (path: Point[], color?: string) => stroke(densify(path, 3), color, 0.6);

/**
 * A line drawn as dashes along the path, each `dash` long with a `gap` between, the last ending at the tip. A "hook"
 * head is drawn with the last dash; a "v" is one more stroke.
 */
export function dashed(path: Point[], head: Head = "hook", dash = 14, gap = 9, color?: string): Stroke[] {
  const p = densify(path, 1), out: Stroke[] = [], [tx, ty] = path[path.length - 1], [px, py] = path[path.length - 2];
  const a = Math.atan2(ty - py, tx - px), barb = (s: number): Point => [tx - 12 * Math.cos(a + s), ty - 12 * Math.sin(a + s)];
  // Cut from the tip back, so the last dash ends on it.
  let k = p.length - 1;
  const pieces: Point[][] = [];
  while (k > 0) {
    const piece: Point[] = [p[k]];
    let walked = 0;
    while (k > 0 && walked < dash) walked += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]), piece.unshift(p[--k]);
    pieces.unshift(piece);
    walked = 0;
    while (k > 0 && walked < gap) walked += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]), k--;
  }
  pieces.forEach((piece, i) => {
    const last = i === pieces.length - 1;
    out.push(stroke(last && head === "hook" ? piece.concat(densify([[tx, ty], barb(0.5), [tx, ty], barb(-0.5)], 2)) : piece, color, 0.4));
  });
  if (head === "v") out.push(stroke(densify([barb(0.5), [tx, ty], barb(-0.5)], 2), color, 0.3));
  return out;
}

/** A dot filled in with the pen: a tight scribble around a center. */
export function scribble(cx: number, cy: number, r: number, color?: string): Stroke {
  const p: Point[] = [];
  for (let i = 0; i <= 60; i++) {
    const a = i * 1.07, rr = r * (0.25 + 0.75 * Math.abs(Math.sin(i * 0.53)));
    p.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return stroke(p, color, 0.3);
}

/**
 * A dot filled in with hatching, back and forth across it, after going once around it if `outlined`, its rows `gap`
 * apart.
 */
export function hatch(cx: number, cy: number, r: number, outlined = false, gap = 2.5, color?: string): Stroke {
  const p: Point[] = [];
  if (outlined) for (let i = 0; i <= 24; i++) p.push([cx + r * Math.cos((i / 24) * 2 * Math.PI), cy + r * Math.sin((i / 24) * 2 * Math.PI)]);
  const rows = Math.max(3, Math.round(r / gap));
  for (let k = 0; k <= rows; k++) {
    const y = cy - 0.8 * r + (1.6 * r * k) / rows, w = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
    p.push(...((k % 2 ? [[cx + w, y], [cx - w, y]] : [[cx - w, y], [cx + w, y]]) as Point[]));
  }
  return stroke(densify(p, 1.5), color, 0.3);
}
