/** Mermaid flowchart text for a reading. */
import type { LineStyle, Reading, ReadShape } from "./recognize.ts";
import type { ShapeKind } from "./shapes.ts";

/**
 * Each shape's brackets in Mermaid's flowchart syntax, or, for a shape with none, its name in Mermaid's shape list,
 * written `A@{ shape: tri, label: "Node 1" }`.
 */
export const BRACKETS: Record<ShapeKind, [string, string] | string> = {
  rect: ["[", "]"],
  subroutine: ["[[", "]]"],
  stadium: ["([", "])"],
  circle: ["((", "))"],
  double: ["(((", ")))"],
  diamond: ["{", "}"],
  hexagon: ["{{", "}}"],
  trapezoid: ["[/", "\\]"],
  "inv-trapezoid": ["[\\", "/]"],
  "lean-right": ["[/", "/]"],
  "lean-left": ["[\\", "\\]"],
  triangle: "tri",
  "flip-triangle": "flip-tri",
  dot: "sm-circ",
  bullseye: "fr-circ",
};

/**
 * A node as Mermaid's flowchart syntax writes it, its name already escaped. In `@{ … }` the name is a YAML string, in
 * which a backslash would escape the closing quote, so a backslash is written as its character code there.
 */
export function nodeText(id: string, kind: ShapeKind, name: string): string {
  const b = BRACKETS[kind];
  return typeof b === "string" ? `${id}@{ shape: ${b}, label: "${name.replace(/\\/g, "#92;")}" }` : `${id}${b[0]}"${name}"${b[1]}`;
}

/** Each line's arrow in Mermaid's flowchart syntax: one way, then both ways. */
export const ARROWS: Record<LineStyle, [string, string]> = {
  plain: ["-->", "<-->"],
  dotted: ["-.->", "<-.->"],
  thick: ["==>", "<==>"],
};

/** The inks that become styles: each name's stroke and fill. The default ink ("ink") takes the diagram's own colors. */
export const PALETTE: Record<string, [stroke: string, fill: string]> = {
  green: ["#1f7a5a", "#dcefe6"],
  blue: ["#2563eb", "#e3ebfd"],
  red: ["#c0392b", "#fbe4e1"],
  amber: ["#b26b00", "#fbeed8"],
};

/**
 * A name as Mermaid reads it inside double quotes: the characters that would end or break the label are written as
 * Mermaid's character codes (`#34;` for a quote), and line breaks and other control characters become spaces.
 */
export const escapeLabel = (s: string): string =>
  String(s)
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/[#&<>"]/g, (c) => "#" + c.charCodeAt(0) + ";");

export interface MermaidOptions {
  /** Names typed by a person, by shape or line id. An empty name keeps the default; a line's default is no name. */
  labels?: Record<string, string>;
  palette?: Record<string, [string, string]>;
  /** The text color inside a colored shape. */
  textColor?: string;
}

export function toMermaid(m: Reading, options: MermaidOptions = {}): string {
  const labels = options.labels ?? {}, palette = options.palette ?? PALETTE, text = options.textColor ?? "#161c19";
  if (!m.nodes.length) return "flowchart TD\n  %% Nothing to read yet: draw a shape, then press Mermaidify.";
  const name = (x: ReadShape) => (labels[x.id] !== undefined && labels[x.id].trim() !== "" ? labels[x.id] : x.label);
  const out = ["flowchart " + m.direction];
  const emit = (parent: string | null, pad: string) => {
    for (const n of m.nodes) if (n.parent === parent) out.push(pad + nodeText(n.id, n.kind, escapeLabel(name(n))));
    for (const g of m.groups)
      if (g.parent === parent) {
        out.push(`${pad}subgraph ${g.id} ["${escapeLabel(name(g))}"]`);
        emit(g.id, pad + "  ");
        out.push(pad + "end");
      }
  };
  emit(null, "  ");
  for (const e of m.edges) {
    const named = labels[e.id] !== undefined && labels[e.id].trim() !== "" ? `|"${escapeLabel(labels[e.id])}"|` : "";
    out.push(`  ${e.from} ${ARROWS[e.style][e.both ? 1 : 0]}${named} ${e.to}`);
  }
  const byInk: Record<string, string[]> = {};
  for (const n of m.nodes) if (palette[n.color]) (byInk[n.color] ??= []).push(n.id);
  for (const [k, ids] of Object.entries(byInk)) {
    out.push(`  classDef ${k} stroke:${palette[k][0]},stroke-width:2px,fill:${palette[k][1]},color:${text}`);
    out.push(`  class ${ids.join(",")} ${k}`);
  }
  for (const g of m.groups) if (palette[g.color]) out.push(`  style ${g.id} stroke:${palette[g.color][0]},stroke-width:2px`);
  m.edges.forEach((e, i) => {
    // A thick line keeps Mermaid's thick width.
    if (palette[e.color]) out.push(`  linkStyle ${i} stroke:${palette[e.color][0]},stroke-width:${e.style === "thick" ? 3.5 : 2}px`);
  });
  return out.join("\n");
}

/**
 * A name as a state diagram reads it: as in a flowchart, and also with the characters that end a transition's name or
 * start a note (`;` and `:`) as character codes, and the word "direction", which Mermaid would take for a direction,
 * spelled with its first letter as one.
 */
export const escapeState = (s: string): string =>
  String(s)
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/[#&<>";:]/g, (c) => "#" + c.charCodeAt(0) + ";")
    .replace(/direction/gi, (w) => "#" + w.charCodeAt(0) + ";" + w.slice(1));

/**
 * Mermaid state diagram text for a reading made as a state diagram. Each dot is `[*]`, which Mermaid draws as a start
 * or an end from the way its transition runs, and belongs to the composite state that holds it: a transition from or
 * to it is written inside that composite, to the state there that holds the other end. When the other end is outside
 * the composite, the composite itself stands for the dot, at the top. Any other transition is written inside a
 * composite when both its ends are there, and otherwise at the top.
 */
export function toStateMermaid(m: Reading, options: MermaidOptions = {}): string {
  const labels = options.labels ?? {}, palette = options.palette ?? PALETTE, text = options.textColor ?? "#161c19";
  if (!m.nodes.length) return "stateDiagram-v2\n  %% Nothing to read yet: draw a shape, then press Mermaidify.";
  const named = (id: string) => labels[id] !== undefined && labels[id].trim() !== "";
  // A state always has a name: Mermaid refuses an empty one.
  const name = (x: ReadShape) => (named(x.id) ? labels[x.id] : x.label) || x.id;
  const byId = new Map([...m.nodes, ...m.groups].map((x) => [x.id, x]));
  const isDot = (id: string) => byId.get(id)?.role === "dot";
  const parent = (id: string) => byId.get(id)?.parent ?? null;
  /** The state directly inside `scope` that holds `id`, or `id` itself, or null when `id` is not inside `scope`. */
  const within = (id: string, scope: string | null): string | null => {
    for (let at: string | null = id; at !== null; at = parent(at)) if (parent(at) === scope) return at;
    return null;
  };
  const lines: { at: string | null; text: string }[] = [];
  const write = (a: string, b: string, label: string) => {
    if (isDot(a) && isDot(b)) return;
    if (isDot(a) || isDot(b)) {
      const [d, other] = isDot(a) ? [a, b] : [b, a], c = parent(d), there = within(other, c);
      if (other === c) return;
      const text = (x: string, y: string) => `${x} --> ${y}${label}`;
      if (there !== null) lines.push({ at: c, text: isDot(a) ? text("[*]", there) : text(there, "[*]") });
      else if (c !== null) lines.push({ at: null, text: isDot(a) ? text(c, other) : text(other, c) });
      return;
    }
    const at = parent(a) !== null && parent(a) === parent(b) ? parent(a) : null;
    lines.push({ at, text: `${a} --> ${b}${label}` });
  };
  for (const e of m.edges) {
    const label = named(e.id) ? " : " + escapeState(labels[e.id]) : "";
    write(e.from, e.to, label);
    if (e.both) write(e.to, e.from, label);
  }
  const out = ["stateDiagram-v2", "  direction " + (m.direction === "TD" ? "TB" : m.direction)];
  // A composite with nothing to write inside it, as when it holds only a dot with no transition, is a plain state.
  const emit = (parent: string | null, pad: string): string[] => {
    const at: string[] = [];
    for (const n of m.nodes)
      if (n.parent === parent && n.role !== "dot")
        at.push(n.role === "choice" ? `${pad}state ${n.id} <<choice>>` : `${pad}state "${escapeState(name(n))}" as ${n.id}`);
    for (const g of m.groups)
      if (g.parent === parent) {
        const inner = emit(g.id, pad + "  ");
        if (inner.length) at.push(`${pad}state "${escapeState(name(g))}" as ${g.id} {`, ...inner, pad + "}");
        else at.push(`${pad}state "${escapeState(name(g))}" as ${g.id}`);
      }
    for (const l of lines) if (l.at === parent) at.push(pad + l.text);
    return at;
  };
  out.push(...emit(null, "  "));
  const byInk: Record<string, string[]> = {};
  for (const x of [...m.nodes, ...m.groups]) if (x.role !== "dot" && palette[x.color]) (byInk[x.color] ??= []).push(x.id);
  for (const [k, ids] of Object.entries(byInk)) {
    out.push(`  classDef ${k} stroke:${palette[k][0]},stroke-width:2px,fill:${palette[k][1]},color:${text}`);
    out.push(`  class ${ids.join(",")} ${k}`);
  }
  return out.join("\n");
}
