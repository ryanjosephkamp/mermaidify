/**
 * Takes a slice of Google's Didi dataset (digital ink drawings of diagrams, CC BY 4.0, Google LLC) for the measured
 * reading: drawings people made over Graphviz charts with no text, each with the chart it was drawn over.
 *
 *   node scripts/didi.ts --split test --count 300 --out test/didi/test.json.gz [--cache folder]
 *
 * It reads 2 MB windows spread evenly through the dataset's 1 GB file by HTTP range requests, keeps whole drawings of
 * the asked split, and fetches each chart's layout (xdot). The chart is placed over the ink as the collection app
 * showed it: its picture fit inside the writing area and centered. Everything is then scaled so a chart's standard
 * node is 120 units wide, about the size a person draws a box on the canvas, and points closer than 2 units to the
 * last one kept are left out. Nothing else about the ink changes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

import type { DidiCase, DidiNode } from "./measure.ts";

const BUCKET = "https://storage.googleapis.com/digital_ink_diagram_data/";
const FILE = "diagrams_wo_text_20200131.ndjson";
const SIZE = 1_040_887_970;
const WINDOWS = 48, WINDOW = 2_000_000;
/** A Graphviz node is 0.75 inch (54 points) wide; it becomes this many drawing units. */
const NODE = 120;

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const split = arg("split", "test"), count = Number(arg("count", "300")), out = arg("out", `test/didi/${split}.json.gz`);
/** A folder that keeps what was downloaded, so making the slice again downloads nothing. */
const cache = arg("cache", "");

/** A line of the dataset: one drawing, as strokes of [xs, ys, times]. */
interface Raw {
  key: string;
  label_id: string;
  split: string;
  writing_guide: { width: number; height: number };
  drawing: number[][][];
}

async function get(url: string, range?: [number, number]): Promise<string> {
  const file = cache && join(cache, (url.slice(BUCKET.length) + (range ? "." + range[0] : "")).replace(/\//g, "_"));
  if (file && existsSync(file)) return readFileSync(file, "utf8");
  const text = await fetchText(url, range);
  if (file) mkdirSync(cache, { recursive: true }), writeFileSync(file, text);
  return text;
}
async function fetchText(url: string, range?: [number, number]): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, range ? { headers: { range: `bytes=${range[0]}-${range[1]}` } } : {});
    if (res.ok) return res.text();
    if (attempt >= 2) throw new Error(`${res.status} for ${url}`);
  }
}

/** Whole lines from a window: the first and last are cut by the range, so they are dropped. */
async function window(start: number): Promise<Raw[]> {
  const text = await get(BUCKET + FILE, [start, Math.min(SIZE, start + WINDOW) - 1]);
  const lines = text.split("\n").slice(1, -1);
  return lines.map((l) => JSON.parse(l) as Raw);
}

interface Chart { bb: number[]; rankdir: string; nodes: Map<string, DidiNode>; edges: [string, string][] }

function parseXdot(x: string): Chart {
  const bb = /bb="([^"]+)"/.exec(x)![1].split(",").map(Number);
  const rankdir = /rankdir=("?)(\w+)\1/.exec(x)?.[2] ?? "TB";
  const nodes = new Map<string, DidiNode>();
  const edges: [string, string][] = [];
  // Statements are "name [attrs];" for nodes and "a -> b [attrs];" for edges, attributes possibly over several lines.
  for (const m of x.matchAll(/^\s*("?[\w.]+"?)\s*(->\s*("?[\w.]+"?))?\s*\[([^\]]*)\]/gm)) {
    const a = m[1].replace(/"/g, ""), b = m[3]?.replace(/"/g, ""), attrs = m[4];
    if (a === "graph" || a === "node" || a === "edge") continue;
    if (b !== undefined) { edges.push([a, b]); continue; }
    const at = (k: string) => {
      const m = new RegExp(`\\b${k}=(?:"([^"]*)"|([^,\\s\\]]+))`).exec(attrs);
      return m ? (m[1] ?? m[2]) : undefined;
    };
    const pos = at("pos")?.split(",").map(Number);
    if (!pos) continue;
    nodes.set(a, { shape: at("shape") ?? "ellipse", x: pos[0], y: pos[1], w: Number(at("width")) * 72, h: Number(at("height")) * 72 });
  }
  return { bb, rankdir, nodes, edges };
}

function toCase(r: Raw, chart: Chart): DidiCase | null {
  const { width: W, height: H } = r.writing_guide, [, , bw, bh] = chart.bb;
  // The chart's picture is its bounding box plus 4 points a side, at 96 pixels an inch, fit inside the writing area.
  const pw = ((bw + 8) * 4) / 3, ph = ((bh + 8) * 4) / 3;
  const fit = Math.min(W / pw, H / ph), k = (fit * 4) / 3;
  const ox = (W - pw * fit) / 2, oy = (H - ph * fit) / 2;
  const unit = NODE / (54 * k);
  const ids = [...chart.nodes.keys()];
  const nodes = ids.map((id) => {
    const n = chart.nodes.get(id)!;
    return { shape: n.shape, x: round((ox + (n.x + 4) * k) * unit), y: round((oy + (bh - n.y + 4) * k) * unit), w: round(n.w * k * unit), h: round(n.h * k * unit) };
  });
  const edges = chart.edges.map(([a, b]) => [ids.indexOf(a), ids.indexOf(b)] as [number, number]);
  if (edges.some(([a, b]) => a < 0 || b < 0) || nodes.length === 0) return null;
  const strokes = r.drawing.map((s) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < s[0].length; i++) {
      const p: [number, number] = [round(s[0][i] * unit), round(s[1][i] * unit)];
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2 || i === s[0].length - 1) pts.push(p);
    }
    return pts;
  });
  return { key: r.key, label: r.label_id, rankdir: chart.rankdir, strokes, nodes, edges };
}

const round = (v: number) => Math.round(v * 10) / 10;

// Windows in an order that spreads the slice through the file even when it fills before the last window.
const order = Array.from({ length: WINDOWS }, (_, i) => i).sort((a, b) => bitrev(a) - bitrev(b));
function bitrev(i: number) {
  let r = 0;
  for (let b = 0; b < 6; b++) r = (r << 1) | ((i >> b) & 1);
  return r;
}

const cases: DidiCase[] = [];
const charts = new Map<string, Chart>();
for (const w of order) {
  if (cases.length >= count) break;
  const start = Math.floor((w * (SIZE - WINDOW)) / (WINDOWS - 1));
  const raws = (await window(start)).filter((r) => r.split === split);
  for (const r of raws.slice(0, Math.ceil(count / WINDOWS) + 2)) {
    if (cases.length >= count) break;
    let chart = charts.get(r.label_id);
    if (!chart) charts.set(r.label_id, (chart = parseXdot(await get(`${BUCKET}xdot/${r.label_id}.xdot`))));
    const c = toCase(r, chart);
    if (c) cases.push(c);
  }
  process.stdout.write(`\r${cases.length} drawings`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gzipSync(JSON.stringify(cases), { level: 9 }));
console.log(`\nwrote ${out}: ${cases.length} ${split} drawings of ${charts.size} charts`);
