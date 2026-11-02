/**
 * Generated wobbly flowcharts with known answers, for scoring the reader. Each case is a column of 3 to 5 shapes
 * joined top to bottom, sometimes with an arrow that loops back up the right side. Arrows end in a hook, a separate
 * "V", or no head, and about a quarter are drawn as dashes and a quarter gone over twice. The same seed gives the same
 * cases, and the styles come from a second sequence, so turning them off leaves every drawing otherwise the same.
 */
import type { Point } from "../src/reader/geometry.ts";
import type { LineStyle, Reading, Stroke } from "../src/reader/recognize.ts";
import type { ShapeKind } from "../src/reader/shapes.ts";

export interface TruthShape {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type HeadStyle = "hook" | "v" | "none";
export interface Case {
  strokes: Stroke[];
  shapes: TruthShape[];
  /** [from, to] by index into shapes. */
  edges: [number, number][];
  heads: HeadStyle[];
  styles: LineStyle[];
}

export interface GenOptions {
  /** The largest wobble, in drawing units. */
  ampMax?: number;
  /** Draw some lines as dashes and some twice (the default), or every line plain. */
  styles?: boolean;
}

export function generate(seedStart: number, count: number, opts: GenOptions = {}): Case[] {
  let seed = seedStart;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let seed2 = (seedStart ^ 0x9e3779b9) >>> 0;
  const rnd2 = () => (seed2 = (seed2 * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const dens = (poly: Point[], step = 3): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    out.push(poly[poly.length - 1]);
    return out;
  };
  const wob = (pts: Point[], amp: number): Point[] => {
    const p1 = rnd() * 6, p2 = rnd() * 6, f1 = 0.06 + rnd() * 0.1, f2 = 0.05 + rnd() * 0.1;
    return pts.map(([x, y], i): Point => [x + Math.sin(i * f1 + p1) * amp + (rnd() - 0.5) * 1.4, y + Math.cos(i * f2 + p2) * amp + (rnd() - 0.5) * 1.4]);
  };
  const ell = (x: number, y: number, rx: number, ry: number): Point[] => {
    const a0 = rnd() * 6.28, over = rnd() * 0.12 - 0.03, p: Point[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = a0 + (i / 72) * Math.PI * 2 * (1 + over);
      p.push([x + rx * Math.cos(a), y + ry * Math.sin(a)]);
    }
    return p;
  };
  const closePoly = (pts: Point[]): Point[] => {
    const k = Math.floor(rnd() * pts.length), r = pts.slice(k).concat(pts.slice(0, k)), g = (rnd() - 0.3) * 6;
    return dens([...r, [r[0][0] + g, r[0][1] + g]]);
  };
  const shapeFor = (kind: ShapeKind, cx: number, cy: number, w: number, h: number): Point[][] => {
    const x0 = cx - w / 2, y0 = cy - h / 2;
    if (kind === "rect") return [closePoly([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]])];
    if (kind === "diamond") return [closePoly([[cx, y0], [x0 + w, cy], [cx, y0 + h], [x0, cy]])];
    if (kind === "hexagon") return [closePoly([[x0 + 0.2 * w, y0], [x0 + 0.8 * w, y0], [x0 + w, cy], [x0 + 0.8 * w, y0 + h], [x0 + 0.2 * w, y0 + h], [x0, cy]])];
    if (kind === "trapezoid") return [closePoly([[x0 + 0.2 * w, y0], [x0 + 0.8 * w, y0], [x0 + w, y0 + h], [x0, y0 + h]])];
    if (kind === "circle") {
      const r = Math.min(w, h) / 2;
      return [ell(cx, cy, r, r)];
    }
    if (kind === "stadium") return [ell(cx, cy, w / 2, h / 2)];
    if (kind === "double") {
      const r = Math.min(w, h) / 2;
      return [ell(cx, cy, r, r), ell(cx, cy, r * 0.62, r * 0.62)];
    }
    throw new Error("no generator for " + kind);
  };
  const KINDS: ShapeKind[] = ["rect", "rect", "diamond", "hexagon", "trapezoid", "circle", "stadium", "double"];
  const ampMax = opts.ampMax ?? 3;
  const cases: Case[] = [];
  for (let t = 0; t < count; t++) {
    const n = 3 + Math.floor(rnd() * 3), amp = 0.8 + rnd() * (ampMax - 0.8), strokes: Stroke[] = [], shapes: TruthShape[] = [];
    const cx = 180, gapY = 95 + rnd() * 30;
    for (let i = 0; i < n; i++) {
      const kind = pick(KINDS);
      const round = kind === "circle" || kind === "double";
      const w = round ? 56 + rnd() * 14 : 100 + rnd() * 50, h = round ? w : kind === "diamond" ? 66 + rnd() * 20 : 44 + rnd() * 16;
      const x = cx + (rnd() - 0.5) * 40, y = 50 + i * gapY;
      shapes.push({ kind, x, y, w, h });
      for (const p of shapeFor(kind, x, y, w, h)) strokes.push({ color: "ink", pts: wob(p, amp) });
    }
    const edges: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
    const back: [number, number] | null = n >= 3 && rnd() < 0.6 ? [Math.min(n - 1, 1 + Math.floor(rnd() * (n - 1))), 0] : null;
    if (back && back[0] > 0) edges.push(back);
    const heads: HeadStyle[] = [], styles: LineStyle[] = [];
    for (const [i, j] of edges) {
      const A = shapes[i], B = shapes[j];
      let path: Point[];
      if (j > i) path = [[A.x, A.y + A.h / 2 + 3 + rnd() * 5], [B.x + (rnd() - 0.5) * 6, B.y - B.h / 2 - 2 - rnd() * 5]];
      else {
        const side = Math.max(...shapes.map((T) => T.x + T.w / 2)) + 30 + rnd() * 20;
        path = [[A.x + A.w / 2 + 3, A.y], [side, A.y], [side, B.y], [B.x + B.w / 2 + 4, B.y]];
      }
      const style = pick<HeadStyle>(["hook", "v", "none", "hook", "v"]);
      heads.push(style);
      let line = dens(path, 3);
      const body = line.length;
      const [tx, ty] = path[path.length - 1], [px, py] = path[path.length - 2], a = Math.atan2(ty - py, tx - px), bl = 9 + rnd() * 6;
      const barb = (s: number): Point => [tx - bl * Math.cos(a + s), ty - bl * Math.sin(a + s)];
      if (style === "hook") line = line.concat(dens([[tx, ty], barb(0.5), [tx, ty], barb(-0.5)], 2));
      const drawn = wob(line, amp * 0.4), look = opts.styles === false ? "plain" : (["plain", "plain", "dotted", "thick"] as const)[Math.floor(rnd2() * 4)];
      styles.push(look);
      if (look === "dotted") strokes.push(...dashes(drawn, body));
      else strokes.push({ color: "ink", pts: drawn });
      if (look === "thick") {
        // Gone over again, a little to one side, as often from the far end as from the near one.
        const off = (rnd2() - 0.5) * 6, p1 = rnd2() * 6, again = drawn.slice(0, body).map(([x, y], k): Point => [x + off + Math.sin(k * 0.09 + p1) * 1.2, y + off * 0.5 + Math.cos(k * 0.08 + p1) * 1.2]);
        strokes.push({ color: "ink", pts: rnd2() < 0.5 ? again : again.reverse() });
      }
      if (style === "v") strokes.push({ color: "ink", pts: wob(dens([barb(0.5), [tx, ty], barb(-0.5)], 2), 0.4) });
    }
    cases.push({ strokes, shapes, edges, heads, styles });
  }
  return cases;

  /**
   * The line cut into dashes, the last of which, with any hook after `body`, ends on the tip. The dashes and gaps are
   * stretched or shrunk to fit a whole number of dashes, at least two, so none is a sliver.
   */
  function dashes(drawn: Point[], body: number): Stroke[] {
    const at = [0];
    for (let k = 1; k < body; k++) at.push(at[k - 1] + Math.hypot(drawn[k][0] - drawn[k - 1][0], drawn[k][1] - drawn[k - 1][1]));
    const length = at[body - 1];
    let dash = 10 + rnd2() * 10, gap = 6 + rnd2() * 6;
    const n = Math.max(2, Math.round((length + gap) / (dash + gap))), fit = length / (n * dash + (n - 1) * gap);
    dash *= fit;
    gap *= fit;
    // The point at a distance along the line.
    const point = (d: number): Point => {
      let k = 1;
      while (k < body - 1 && at[k] < d) k++;
      const t = (d - at[k - 1]) / (at[k] - at[k - 1] || 1);
      return [drawn[k - 1][0] + t * (drawn[k][0] - drawn[k - 1][0]), drawn[k - 1][1] + t * (drawn[k][1] - drawn[k - 1][1])];
    };
    const out: Point[][] = [];
    for (let i = 0; i < n; i++) {
      const s0 = i * (dash + gap), s1 = i === n - 1 ? length : s0 + dash;
      const pts = [point(s0), ...drawn.slice(0, body).filter((_, k) => at[k] > s0 && at[k] < s1), point(s1)];
      out.push(i === n - 1 ? pts.concat(drawn.slice(body)) : pts);
    }
    return out.map((pts) => ({ color: "ink", pts }));
  }
}

export interface Score {
  cases: number;
  shapesRight: number;
  shapes: number;
  arrowsRight: number;
  arrows: number;
  /** Arrows read right whose style, plain, dotted, or thick, is right too. */
  stylesRight: number;
  /** The lines drawn as dashes or gone over twice, and those read right with their style. */
  styled: number;
  styledRight: number;
  /** The plain lines, and those read right as plain. */
  plain: number;
  plainRight: number;
  /** Arrows the reader found that are not in the answer. */
  arrowsExtra: number;
  /** Cases read entirely right: every shape, every arrow and its style, and nothing extra. */
  perfect: number;
  /** What each wrong shape was read as, "truth→read". */
  wrong: Record<string, number>;
  /** Missed arrows by head style. */
  missed: Record<string, number>;
  msMedian: number;
  msMax: number;
}

/** Scores a reader on cases: a shape is right when one of its kind sits on it, an arrow when it joins the right two. */
export function score(cases: readonly Case[], read: (strokes: Stroke[]) => Reading): Score {
  const s: Score = { cases: cases.length, shapesRight: 0, shapes: 0, arrowsRight: 0, arrows: 0, stylesRight: 0, styled: 0, styledRight: 0, plain: 0, plainRight: 0, arrowsExtra: 0, perfect: 0, wrong: {}, missed: {}, msMedian: 0, msMax: 0 };
  const ms: number[] = [];
  for (const c of cases) {
    const m = read(c.strokes);
    ms.push(m.ms);
    const match = c.shapes.map((T) => m.nodes.find((nd) => Math.abs(nd.bb.cx - T.x) < T.w / 2 && Math.abs(nd.bb.cy - T.y) < T.h / 2));
    let ok = true;
    c.shapes.forEach((T, i) => {
      s.shapes++;
      const got = match[i];
      if (got && got.kind === T.kind) s.shapesRight++;
      else {
        ok = false;
        const k = T.kind + "→" + (got ? got.kind : "none");
        s.wrong[k] = (s.wrong[k] || 0) + 1;
      }
    });
    let right = 0;
    c.edges.forEach(([i, j], k) => {
      s.arrows++;
      const a = match[i], b = match[j], got = a && b ? m.edges.find((e) => e.from === a.id && e.to === b.id) : undefined;
      if (c.styles[k] === "plain") {
        s.plain++;
        if (got?.style === "plain") s.plainRight++;
      } else {
        s.styled++;
        if (got?.style === c.styles[k]) s.styledRight++;
      }
      if (got) {
        s.arrowsRight++;
        right++;
        if (got.style === c.styles[k]) s.stylesRight++;
        else {
          ok = false;
          const key = c.styles[k] + "→" + got.style;
          s.wrong[key] = (s.wrong[key] || 0) + 1;
        }
      } else {
        ok = false;
        const key = c.heads[k] + (j < i ? "-back" : "") + (c.styles[k] === "plain" ? "" : "-" + c.styles[k]);
        s.missed[key] = (s.missed[key] || 0) + 1;
      }
    });
    const extra = Math.max(0, m.edges.length - right);
    s.arrowsExtra += extra;
    if (ok && extra === 0 && m.nodes.length === c.shapes.length) s.perfect++;
  }
  ms.sort((a, b) => a - b);
  s.msMedian = ms[ms.length >> 1] ?? 0;
  s.msMax = ms[ms.length - 1] ?? 0;
  return s;
}
