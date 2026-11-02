/**
 * Scores the reader on drawings people made: 300 from Google's Didi set (see test/didi/README.md).
 *
 *   node scripts/measure.ts [file] [--floor] [--json] [--misses]
 *
 * Each drawing was made over a Graphviz chart, so the chart says what is there. A shape counts as found when one
 * shape read from the drawing has its center inside the chart's node, one to one, nearest first. Its look is scored
 * only for the charts' shapes the reader has a look for: a box, an oval, a diamond, and a parallelogram (the charts
 * also use octagons, which count as found when read as any shape). An arrow is right when the reading joins the two
 * found shapes the same way round, one way only. The charts' lines are all plain, so of the arrows read right, those
 * read as dotted or thick are mistakes. A whole drawing is right when every shape is found with nothing extra, and
 * every arrow is right with nothing extra.
 *
 * With --floor it fails when a score falls below the floors below, which CI holds the reader to. The reader was tuned
 * on other drawings from the set (its "valid" split), never on these (its "test" split).
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import type { Reading } from "../src/reader/index.ts";
import { recognize } from "../src/reader/recognize.ts";

export const FLOOR = { found: 0.94, looks: 0.88, arrows: 0.79, plain: 0.99, whole: 0.64 };

/** A chart's node, in drawing units: its center, its size, and Graphviz's name for its shape. */
export interface DidiNode {
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
/** One drawing and the chart it was drawn over. Edges are pairs of indexes into nodes, tail first. */
export interface DidiCase {
  key: string;
  label: string;
  rankdir: string;
  strokes: [number, number][][];
  nodes: DidiNode[];
  edges: [number, number][];
}

/** The charts' shapes the reader has a look for, and the look. */
const LOOK: Record<string, string> = { box: "rect", oval: "stadium", ellipse: "stadium", diamond: "diamond", parallelogram: "lean-right" };

export interface Measure {
  drawings: number;
  shapes: number;
  found: number;
  looks: number;
  looksRight: number;
  arrows: number;
  arrowsRight: number;
  /** Arrows read right that read as plain lines, as the charts draw every line. */
  plainRight: number;
  extraShapes: number;
  extraArrows: number;
  whole: number;
  msMedian: number;
  /** How the charts' shapes were read, where that was not their look, by "chart shape→read kind". */
  read: Record<string, number>;
  misses: { key: string; why: string }[];
}

export function load(file: string): DidiCase[] {
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
}

export function measure(cases: readonly DidiCase[], read: (strokes: DidiCase["strokes"]) => Reading = (strokes) => recognize(strokes.map((pts) => ({ pts })))): Measure {
  const s: Measure = { drawings: 0, shapes: 0, found: 0, looks: 0, looksRight: 0, arrows: 0, arrowsRight: 0, plainRight: 0, extraShapes: 0, extraArrows: 0, whole: 0, msMedian: 0, read: {}, misses: [] };
  const ms: number[] = [];
  for (const c of cases) {
    const m = read(c.strokes);
    s.drawings++;
    ms.push(m.ms);
    // Nearest pairs first, so two shapes drawn close together each find their own.
    const pairs: [number, number, number][] = [];
    c.nodes.forEach((T, i) =>
      m.nodes.forEach((n, j) => {
        if (Math.abs(n.bb.cx - T.x) < T.w / 2 && Math.abs(n.bb.cy - T.y) < T.h / 2) pairs.push([Math.hypot(n.bb.cx - T.x, n.bb.cy - T.y), i, j]);
      }),
    );
    pairs.sort((a, b) => a[0] - b[0]);
    const match: (number | undefined)[] = [], taken = new Set<number>();
    for (const [, i, j] of pairs)
      if (match[i] === undefined && !taken.has(j)) {
        match[i] = j;
        taken.add(j);
      }
    const why: string[] = [];
    c.nodes.forEach((T, i) => {
      s.shapes++;
      const got = match[i] === undefined ? undefined : m.nodes[match[i]];
      if (got) s.found++;
      else why.push(`${T.shape} ${i} not found`);
      const look = LOOK[T.shape];
      if (look) s.looks++;
      if (look && got?.kind === look) s.looksRight++;
      else {
        const k = `${T.shape}→${got ? got.kind : "none"}`;
        s.read[k] = (s.read[k] || 0) + 1;
      }
    });
    const extraShapes = m.nodes.length - taken.size + m.groups.length;
    if (extraShapes) why.push(`${extraShapes} extra shape${extraShapes > 1 ? "s" : ""}`);
    // The charts have no two-way arrows, so a two-way reading is never right.
    const joined = new Map(m.edges.filter((e) => !e.both).map((e) => [e.from + ">" + e.to, e]));
    let right = 0;
    for (const [i, j] of c.edges) {
      s.arrows++;
      const a = match[i], b = match[j], got = a !== undefined && b !== undefined ? joined.get(m.nodes[a].id + ">" + m.nodes[b].id) : undefined;
      if (got) {
        right++;
        if (got.style === "plain") s.plainRight++;
        else why.push(`arrow ${i}→${j} read as ${got.style}`);
      } else why.push(`arrow ${i}→${j} missed`);
    }
    const extraArrows = m.edges.length - right;
    if (extraArrows) why.push(`${extraArrows} extra arrow${extraArrows > 1 ? "s" : ""}`);
    s.arrowsRight += right;
    s.extraShapes += extraShapes;
    s.extraArrows += extraArrows;
    if (why.length) s.misses.push({ key: c.key, why: why.join(", ") });
    else s.whole++;
  }
  ms.sort((a, b) => a - b);
  s.msMedian = ms[ms.length >> 1] ?? 0;
  return s;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--")) ?? "test/didi/test.json.gz";
  const s = measure(load(file));
  const pct = (a: number, b: number) => ((100 * a) / Math.max(1, b)).toFixed(1) + "%";
  if (args.includes("--json")) console.log(JSON.stringify({ ...s, misses: undefined }, null, 2));
  else {
    console.log(`${s.drawings} drawings people made, from ${file}`);
    console.log(`  shapes found    ${pct(s.found, s.shapes)} (${s.found} of ${s.shapes}), ${s.extraShapes} extra`);
    console.log(`  looks right     ${pct(s.looksRight, s.looks)} (${s.looksRight} of ${s.looks} boxes, ovals, diamonds, and parallelograms)`);
    console.log(`  arrows right    ${pct(s.arrowsRight, s.arrows)} (${s.arrowsRight} of ${s.arrows}), ${s.extraArrows} extra`);
    console.log(`  read as plain   ${pct(s.plainRight, s.arrowsRight)} (${s.plainRight} of the ${s.arrowsRight} arrows read right)`);
    console.log(`  whole drawings  ${pct(s.whole, s.drawings)} (${s.whole} of ${s.drawings})`);
    console.log(`  time            median ${s.msMedian.toFixed(2)} ms`);
    console.log("  read as:", Object.entries(s.read).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
    if (args.includes("--misses")) for (const x of s.misses) console.log(`  ${x.key}: ${x.why}`);
  }
  if (args.includes("--floor")) {
    const got = { found: s.found / s.shapes, looks: s.looksRight / s.looks, arrows: s.arrowsRight / s.arrows, plain: s.plainRight / s.arrowsRight, whole: s.whole / s.drawings };
    const low = (Object.keys(FLOOR) as (keyof typeof FLOOR)[]).filter((k) => got[k] < FLOOR[k]).map((k) => `${k} ${pct(got[k], 1)} < ${pct(FLOOR[k], 1)}`);
    if (low.length) {
      console.error("Below the floor: " + low.join(", "));
      process.exit(1);
    }
  }
}
