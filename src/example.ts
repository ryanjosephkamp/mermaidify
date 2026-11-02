/** The example sketch the Draw page offers: a start, a step, a decision that loops back, and a stop. */
import { densify, type Point } from "./reader/geometry.ts";
import type { Stroke } from "./reader/recognize.ts";

/** Strokes for the example, centered on a drawing `width` units wide. The same width gives the same strokes. */
export function exampleStrokes(width: number): Stroke[] {
  let seed = 7;
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const cx = Math.round(width / 2), out: Stroke[] = [];
  const hand = (pts: Point[], color: string, amp = 1.6) => {
    const p1 = r() * 6, p2 = r() * 6;
    out.push({
      color,
      pts: pts.map(([x, y], i): Point => [x + Math.sin(i * 0.13 + p1) * amp + (r() - 0.5) * 0.8, y + Math.cos(i * 0.11 + p2) * amp + (r() - 0.5) * 0.8]),
    });
  };
  const ellipse = (x: number, y: number, rx: number, ry: number): Point[] => {
    const a0 = r() * 6.28, p: Point[] = [];
    for (let i = 0; i <= 68; i++) {
      const a = a0 + (i / 64) * Math.PI * 2;
      p.push([x + rx * Math.cos(a), y + ry * Math.sin(a)]);
    }
    return p;
  };
  const rect = (x: number, y: number, w: number, h: number) => densify([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + 3]], 4);
  const diamond = (x: number, y: number, w: number, h: number) =>
    densify([[x, y - h / 2], [x + w / 2, y], [x, y + h / 2], [x - w / 2, y], [x + 2, y - h / 2 + 2]], 4);
  const arrow = (path: Point[]) => {
    const [tx, ty] = path[path.length - 1], [px, py] = path[path.length - 2], a = Math.atan2(ty - py, tx - px);
    const barb = (s: number): Point => [tx - 11 * Math.cos(a + s), ty - 11 * Math.sin(a + s)];
    return densify(path, 4).concat(densify([[tx, ty], barb(0.5), [tx, ty], barb(-0.5)], 2));
  };
  hand(ellipse(cx, 46, 58, 22), "ink");
  hand(rect(cx - 65, 104, 130, 50), "ink");
  hand(diamond(cx, 234, 136, 86), "amber");
  hand(ellipse(cx, 352, 25, 25), "red", 1);
  hand(ellipse(cx, 352, 16, 16), "red", 0.6);
  hand(arrow([[cx, 72], [cx, 101]]), "ink", 0.8);
  hand(arrow([[cx, 158], [cx, 188]]), "ink", 0.8);
  hand(arrow([[cx, 280], [cx, 324]]), "ink", 0.8);
  hand(arrow([[cx + 70, 234], [cx + 112, 234], [cx + 112, 129], [cx + 69, 129]]), "green", 1);
  return out;
}
