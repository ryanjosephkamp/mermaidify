/**
 * Generated wobbly state diagrams with known answers, for scoring the reader on state diagrams. Each case is a column:
 * a start dot, 2 to 4 states, and an end dot, joined top to bottom. Sometimes a choice diamond sends one branch to a
 * state beside it, sometimes a group around two states makes a composite state, and sometimes an arrow loops back up
 * the right side. The start is a filled dot, a small circle, a small oval, or a dot drawn in the same stroke as its
 * line; the end is a circle with a dot in it or a circle in a circle. A composite sometimes has a start of its own, a
 * filled dot inside it. The same seed gives the same cases.
 */
import type { Point } from "../src/reader/geometry.ts";
import type { Reading, StateRole, Stroke } from "../src/reader/recognize.ts";

export interface TruthNode {
  role: StateRole;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface StateCase {
  strokes: Stroke[];
  nodes: TruthNode[];
  /** Groups around states, by their box and the nodes they hold. */
  groups: { x: number; y: number; w: number; h: number; holds: number[] }[];
  /** Transitions, each end "n" and a node's index, or "g" and a group's index. */
  edges: [string, string][];
}

export function generateStates(seedStart: number, count: number, opts: { ampMax?: number } = {}): StateCase[] {
  let seed = (seedStart * 7919) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
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
  /** A dot filled in with the pen: a tight scribble. */
  const scribble = (x: number, y: number, r: number): Point[] => {
    const p: Point[] = [], turns = 9 + Math.floor(rnd() * 5), a0 = rnd() * 6.28;
    for (let i = 0; i <= turns * 6; i++) {
      const a = a0 + i * 1.07, rr = r * (0.25 + 0.75 * Math.abs(Math.sin(i * 0.53)));
      p.push([x + rr * Math.cos(a), y + rr * Math.sin(a)]);
    }
    return p;
  };
  const ampMax = opts.ampMax ?? 3;
  const cases: StateCase[] = [];
  for (let t = 0; t < count; t++) {
    const amp = 0.8 + rnd() * (ampMax - 0.8), strokes: Stroke[] = [], nodes: TruthNode[] = [], edges: [string, string][] = [];
    const groups: StateCase["groups"] = [];
    const ink = (pts: Point[], a = amp) => strokes.push({ color: "ink", pts: wob(pts, a) });
    const cx = 200, gapY = 105 + rnd() * 25, k = 2 + Math.floor(rnd() * 3);
    // The column: states, with a choice after one of them and a group around two of them, sometimes.
    const column: number[] = [];
    let y = 40;
    const start = nodes.push({ role: "dot", x: cx, y, w: 0, h: 0 }) - 1;
    column.push(start);
    const choiceAt = rnd() < 0.3 ? Math.floor(rnd() * (k - 1)) : -1;
    const groupAt = choiceAt < 0 && k >= 2 && rnd() < 0.35 ? Math.floor(rnd() * (k - 1)) : -1;
    // A composite's own start sits inside it, above its first state, which takes room.
    const innerStart = groupAt >= 0 && rnd() < 0.5;
    for (let i = 0; i < k; i++) {
      y += gapY + (groupAt >= 0 && (i === groupAt || i === groupAt + 2) ? 30 : 0) + (innerStart && i === groupAt ? 44 : 0);
      const w = 110 + rnd() * 40, h = 48 + rnd() * 14, x = cx + (rnd() - 0.5) * 30;
      column.push(nodes.push({ role: "state", x, y, w, h }) - 1);
      if (rnd() < 0.5) ink(closePoly([[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]]));
      else ink(ell(x, y, w / 2, h / 2));
      if (i === choiceAt) {
        y += gapY;
        const dw = 80 + rnd() * 20, dh = 60 + rnd() * 16;
        const c = nodes.push({ role: "choice", x: cx, y, w: dw, h: dh }) - 1;
        column.push(c);
        ink(closePoly([[cx, y - dh / 2], [cx + dw / 2, y], [cx, y + dh / 2], [cx - dw / 2, y]]));
        const sx = cx + 210, sw = 110 + rnd() * 30, sh = 50 + rnd() * 10;
        const side = nodes.push({ role: "state", x: sx, y, w: sw, h: sh }) - 1;
        ink(closePoly([[sx - sw / 2, y - sh / 2], [sx + sw / 2, y - sh / 2], [sx + sw / 2, y + sh / 2], [sx - sw / 2, y + sh / 2]]));
        arrow([[cx + dw / 2 + 4, y], [sx - sw / 2 - 4, y]]);
        edges.push(["n" + c, "n" + side]);
      }
    }
    // Room below a group that ends the column, as below any group.
    y += gapY + (groupAt === k - 2 ? 30 : 0);
    const end = nodes.push({ role: "dot", x: cx, y, w: 0, h: 0 }) - 1;
    column.push(end);
    // The start: filled in, a small circle, a small oval big enough to be a shape, or drawn in the same stroke as its
    // line.
    const startStyle = pick(["fill", "ring", "oval", "inline"] as const), sr = 6 + rnd() * 4;
    Object.assign(nodes[start], { w: 2 * sr, h: 2 * sr });
    if (startStyle === "fill") ink(scribble(cx, 40, sr), amp * 0.3);
    if (startStyle === "ring") ink(ell(cx, 40, sr + 2, sr + 2), amp * 0.3);
    if (startStyle === "oval") {
      const rx = 14 + rnd() * 8, ry = rx * (0.75 + rnd() * 0.25);
      Object.assign(nodes[start], { w: 2 * rx, h: 2 * ry });
      ink(ell(cx, 40, rx, ry), amp * 0.3);
    }
    // The end: a circle with a dot in it, or a circle in a circle.
    const er = 14 + rnd() * 6;
    Object.assign(nodes[end], { w: 2 * er, h: 2 * er });
    ink(ell(cx, y, er, er), amp * 0.4);
    if (rnd() < 0.5) ink(scribble(cx, y, er * 0.45), amp * 0.2);
    else ink(ell(cx, y, er * 0.55, er * 0.55), amp * 0.3);
    // A group around two states makes a composite state: arrows run to and from its edge.
    let g = -1;
    if (groupAt >= 0) {
      const a = nodes[column[groupAt + 1]], b = nodes[column[groupAt + 2]];
      const x0 = Math.min(a.x - a.w / 2, b.x - b.w / 2) - 28, x1 = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 28;
      const y0 = a.y - a.h / 2 - (innerStart ? 70 : 26), y1 = b.y + b.h / 2 + 26;
      g = groups.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, holds: [column[groupAt + 1], column[groupAt + 2]] }) - 1;
      ink(closePoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]));
      if (innerStart) {
        const dy = a.y - a.h / 2 - 46, r = 6 + rnd() * 3;
        const d = nodes.push({ role: "dot", x: a.x, y: dy, w: 2 * r, h: 2 * r }) - 1;
        groups[g].holds.push(d);
        ink(scribble(a.x, dy, r), amp * 0.3);
        arrow([[a.x, dy + r + 5], [a.x + (rnd() - 0.5) * 4, a.y - a.h / 2 - 3 - rnd() * 4]]);
        edges.push(["n" + d, "n" + column[groupAt + 1]]);
      }
    }
    // Arrows down the column, to and from the group's edge where there is one.
    const endOf = (i: number) => (g >= 0 && (i === column[groupAt + 1] || i === column[groupAt + 2]) ? "g" + g : "n" + i);
    for (let i = 0; i < column.length - 1; i++) {
      const A = nodes[column[i]], B = nodes[column[i + 1]];
      const inside = g >= 0 && i === groupAt + 1;
      const fromGroup = g >= 0 && !inside && endOf(column[i]) === "g" + g, toGroup = g >= 0 && !inside && endOf(column[i + 1]) === "g" + g;
      const y0 = fromGroup ? groups[g].y + groups[g].h / 2 : A.y + A.h / 2, y1 = toGroup ? groups[g].y - groups[g].h / 2 : B.y - B.h / 2;
      const path: Point[] = [[A.x + (rnd() - 0.5) * 6, y0 + 4 + rnd() * 5], [B.x + (rnd() - 0.5) * 6, y1 - 3 - rnd() * 5]];
      if (i === 0 && startStyle === "inline") {
        const tail = arrowLine(path);
        strokes.push({ color: "ink", pts: [...wob(scribble(cx, 40, sr), amp * 0.3), ...wob(tail.line, amp * 0.4)] });
        if (tail.v) ink(tail.v, 0.4);
      } else arrow(path);
      edges.push(inside ? ["n" + column[i], "n" + column[i + 1]] : [endOf(column[i]), endOf(column[i + 1])]);
    }
    // Sometimes an arrow loops back up the right side, from a state to an earlier one.
    const states = column.filter((i) => nodes[i].role === "state" && (g < 0 || !groups[g].holds.includes(i)));
    if (states.length >= 2 && rnd() < 0.3) {
      const from = states[states.length - 1], to = states[0], A = nodes[from], B = nodes[to];
      const side = Math.max(...nodes.map((T) => T.x + T.w / 2), ...groups.map((G) => G.x + G.w / 2)) + 30 + rnd() * 20;
      arrow([[A.x + A.w / 2 + 3, A.y], [side, A.y], [side, B.y], [B.x + B.w / 2 + 4, B.y]]);
      edges.push(["n" + from, "n" + to]);
    }
    cases.push({ strokes, nodes, groups, edges });

    function arrowLine(path: Point[]): { line: Point[]; v?: Point[] } {
      const [tx, ty] = path[path.length - 1], [px, py] = path[path.length - 2], a = Math.atan2(ty - py, tx - px), bl = 9 + rnd() * 6;
      const barb = (s: number): Point => [tx - bl * Math.cos(a + s), ty - bl * Math.sin(a + s)];
      const line = dens(path, 3);
      return rnd() < 0.5 ? { line: line.concat(dens([[tx, ty], barb(0.5), [tx, ty], barb(-0.5)], 2)) } : { line, v: dens([barb(0.5), [tx, ty], barb(-0.5)], 2) };
    }
    function arrow(path: Point[]) {
      const { line, v } = arrowLine(path);
      ink(line, amp * 0.4);
      if (v) ink(v, 0.4);
    }
  }
  return cases;
}

export interface StateScore {
  cases: number;
  /** Starts and ends, states, and choices: found where they were drawn, as what they are. */
  dots: number;
  dotsRight: number;
  states: number;
  statesRight: number;
  choices: number;
  choicesRight: number;
  composites: number;
  compositesRight: number;
  transitions: number;
  transitionsRight: number;
  /** Transitions read that are not in the answer. */
  extra: number;
  /** Cases read entirely right: every dot, state, choice, composite, and transition, and nothing extra. */
  perfect: number;
  msMedian: number;
}

/** Scores a reader on state cases. A node is right when one read with its role sits on it, a transition when it joins
 * the right two the right way. */
export function scoreStates(cases: readonly StateCase[], read: (strokes: Stroke[]) => Reading): StateScore {
  const s: StateScore = { cases: cases.length, dots: 0, dotsRight: 0, states: 0, statesRight: 0, choices: 0, choicesRight: 0, composites: 0, compositesRight: 0, transitions: 0, transitionsRight: 0, extra: 0, perfect: 0, msMedian: 0 };
  const ms: number[] = [];
  for (const c of cases) {
    const m = read(c.strokes);
    ms.push(m.ms);
    let ok = m.nodes.length === c.nodes.length && m.groups.length === c.groups.length;
    const ids = c.nodes.map((T) => {
      const r = T.role === "dot" ? T.w / 2 + 8 : 0;
      const got = m.nodes.find((n) => (T.role === "dot" ? Math.hypot(n.bb.cx - T.x, n.bb.cy - T.y) < r : Math.abs(n.bb.cx - T.x) < T.w / 2 && Math.abs(n.bb.cy - T.y) < T.h / 2));
      const right = !!got && got.role === T.role;
      const key = T.role === "dot" ? "dots" : T.role === "choice" ? "choices" : "states";
      s[key]++;
      if (right) s[(key + "Right") as "dotsRight" | "choicesRight" | "statesRight"]++;
      else ok = false;
      return right ? got!.id : undefined;
    });
    const gids = c.groups.map((G) => {
      s.composites++;
      const got = m.groups.find((x) => Math.abs(x.bb.cx - G.x) < G.w / 4 && Math.abs(x.bb.cy - G.y) < G.h / 4);
      if (got) s.compositesRight++;
      else ok = false;
      return got?.id;
    });
    const id = (e: string) => (e[0] === "g" ? gids[Number(e.slice(1))] : ids[Number(e.slice(1))]);
    let right = 0;
    for (const [a, b] of c.edges) {
      s.transitions++;
      const from = id(a), to = id(b);
      if (from && to && m.edges.some((e) => e.from === from && e.to === to && !e.both)) {
        s.transitionsRight++;
        right++;
      } else ok = false;
    }
    const extra = Math.max(0, m.edges.length - right);
    s.extra += extra;
    if (ok && extra === 0) s.perfect++;
  }
  ms.sort((a, b) => a - b);
  s.msMedian = ms[ms.length >> 1] ?? 0;
  return s;
}
