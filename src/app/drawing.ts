/**
 * A drawing as a file: its strokes, the names typed for its shapes and lines, whether it is read as a flowchart or a
 * state diagram, and the Mermaid code as it stood. The same form is kept in this browser between visits, and "Save the
 * drawing" writes it out, so a drawing can be opened again later or kept as a test case: its code is the answer the
 * person accepted or fixed.
 */
import type { Point } from "../reader/geometry.ts";
import type { DiagramKind, LineStyle, StateRole } from "../reader/recognize.ts";
import type { ShapeKind } from "../reader/shapes.ts";
import type { DrawnStroke, Input } from "./pad.ts";

export const FORMAT = "mermaidify-drawing";
export interface DrawingFile {
  format: typeof FORMAT;
  version: 1;
  saved: string;
  strokes: { color: string; by: Input; pts: Point[]; open?: boolean; zoom?: number; group?: number }[];
  labels: Record<string, string>;
  /** Shapes chosen by a person instead of the shape drawn, by shape id. */
  shapes?: Record<string, ShapeKind>;
  /** Line styles chosen by a person instead of the style drawn, by line id. */
  lines?: Record<string, LineStyle>;
  /** Read as a state diagram rather than a flowchart. */
  diagram?: DiagramKind;
  /** What a person chose a shape to be in a state diagram, by shape id. */
  roles?: Record<string, StateRole>;
  mermaid: string;
  /** The code was edited by hand after the reading. */
  edited?: boolean;
}

const INKS = new Set(["ink", "green", "blue", "red", "amber"]);
const BY = new Set<Input>(["pen", "touch", "mouse"]);
const KINDS = new Set<ShapeKind>(["rect", "subroutine", "stadium", "circle", "double", "diamond", "hexagon", "trapezoid", "inv-trapezoid", "lean-right", "lean-left", "triangle", "flip-triangle", "dot", "bullseye"]);
const STYLES = new Set<LineStyle>(["plain", "dotted", "thick"]);
const ROLES = new Set<StateRole>(["state", "choice", "dot"]);
const round = (n: number) => Math.round(n * 10) / 10;
/** A stroke's group as kept in a file: a whole number from 1, or nothing. */
const groupOf = (g: unknown) => (typeof g === "number" && Number.isInteger(g) && g >= 1 && g <= 1e9 ? g : undefined);
/** A stroke's zoom as kept in a file, to three places, or nothing when it is 1 or out of range. */
const zoomOf = (z: unknown) => (typeof z === "number" && z >= 0.01 && z <= 100 && Math.abs(z - 1) > 1e-3 ? Math.round(z * 1000) / 1000 : undefined);
/**
 * Limits on a file someone opens, so a broken or hostile one cannot stall the page: far above any flowchart a person
 * draws (a busy one has a hundred strokes and twenty thousand points), and low enough that reading it stays well under
 * a second.
 */
export const MAX_STROKES = 1000, MAX_POINTS = 10_000, MAX_TOTAL = 150_000, MAX_TEXT = 100_000;

export function toFile(
  strokes: readonly DrawnStroke[],
  labels: Record<string, string>,
  mermaid: string,
  edited: boolean,
  shapes: Record<string, ShapeKind> = {},
  lines: Record<string, LineStyle> = {},
  diagram: DiagramKind = "flowchart",
  roles: Record<string, StateRole> = {},
): DrawingFile {
  return {
    format: FORMAT,
    version: 1,
    saved: new Date().toISOString(),
    strokes: strokes.map((s) => ({ color: s.color, by: s.by, pts: s.pts.map(([x, y]): Point => [round(x), round(y)]), ...(s.open ? { open: true } : {}), ...(zoomOf(s.zoom) ? { zoom: zoomOf(s.zoom) } : {}), ...(groupOf(s.group) ? { group: groupOf(s.group) } : {}) })),
    labels,
    ...(Object.keys(shapes).length ? { shapes } : {}),
    ...(Object.keys(lines).length ? { lines } : {}),
    ...(diagram === "state" ? { diagram } : {}),
    ...(Object.keys(roles).length ? { roles } : {}),
    mermaid,
    ...(edited ? { edited: true } : {}),
  };
}

/** Reads a drawing file, or explains why it is not one. */
export function fromFile(raw: unknown): { ok: true; file: DrawingFile } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!raw || typeof raw !== "object") return bad("This file is not a drawing.");
  const f = raw as Record<string, unknown>;
  if (f.format !== FORMAT) return bad("This file is not a mermaidify drawing.");
  if (f.version !== 1) return bad("This drawing was saved by a newer version of mermaidify.");
  if (!Array.isArray(f.strokes) || f.strokes.length > MAX_STROKES) return bad("This drawing's strokes cannot be read.");
  const strokes: DrawingFile["strokes"] = [];
  let total = 0;
  for (const s of f.strokes as unknown[]) {
    const o = s as Record<string, unknown>;
    if (!o || !Array.isArray(o.pts) || o.pts.length > MAX_POINTS) return bad("This drawing's strokes cannot be read.");
    total += o.pts.length;
    if (total > MAX_TOTAL) return bad("This drawing is too large to open here.");
    const pts: Point[] = [];
    for (const p of o.pts as unknown[]) {
      if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 1e6 || Math.abs(p[1]) > 1e6)
        return bad("This drawing's strokes cannot be read.");
      pts.push([p[0], p[1]]);
    }
    if (!pts.length) continue;
    strokes.push({ color: INKS.has(o.color as string) ? (o.color as string) : "ink", by: BY.has(o.by as Input) ? (o.by as Input) : "mouse", pts, ...(o.open === true ? { open: true } : {}), ...(zoomOf(o.zoom) ? { zoom: zoomOf(o.zoom) } : {}), ...(groupOf(o.group) ? { group: groupOf(o.group) } : {}) });
  }
  const labels: Record<string, string> = {};
  if (f.labels && typeof f.labels === "object")
    for (const [k, v] of Object.entries(f.labels as Record<string, unknown>))
      if (/^[A-Za-z0-9_]{1,12}$/.test(k) && typeof v === "string") labels[k] = v.slice(0, 200);
  const shapes: Record<string, ShapeKind> = {};
  if (f.shapes && typeof f.shapes === "object")
    for (const [k, v] of Object.entries(f.shapes as Record<string, unknown>))
      if (/^[A-Za-z0-9_]{1,12}$/.test(k) && KINDS.has(v as ShapeKind)) shapes[k] = v as ShapeKind;
  const lines: Record<string, LineStyle> = {};
  if (f.lines && typeof f.lines === "object")
    for (const [k, v] of Object.entries(f.lines as Record<string, unknown>))
      if (/^[A-Za-z0-9_]{1,12}$/.test(k) && STYLES.has(v as LineStyle)) lines[k] = v as LineStyle;
  const roles: Record<string, StateRole> = {};
  if (f.roles && typeof f.roles === "object")
    for (const [k, v] of Object.entries(f.roles as Record<string, unknown>))
      if (/^[A-Za-z0-9_]{1,12}$/.test(k) && ROLES.has(v as StateRole)) roles[k] = v as StateRole;
  const diagram: DiagramKind = f.diagram === "state" ? "state" : "flowchart";
  const mermaid = typeof f.mermaid === "string" ? f.mermaid.slice(0, MAX_TEXT) : "";
  const saved = typeof f.saved === "string" ? f.saved : "";
  return { ok: true, file: { format: FORMAT, version: 1, saved, strokes, labels, shapes, lines, diagram, roles, mermaid, edited: f.edited === true } };
}

const SLOT = "mermaidify.drawing.v1";
/** The drawing kept in this browser, if any. */
export function loadKept(): DrawingFile | null {
  try {
    const raw = localStorage.getItem(SLOT);
    if (!raw) return null;
    const r = fromFile(JSON.parse(raw));
    return r.ok ? r.file : null;
  } catch {
    return null;
  }
}
export function keep(file: DrawingFile | null): void {
  try {
    if (file) localStorage.setItem(SLOT, JSON.stringify(file));
    else localStorage.removeItem(SLOT);
  } catch {}
}
