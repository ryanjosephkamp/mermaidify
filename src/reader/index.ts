/**
 * mermaidify's reader: strokes in, a flowchart and its Mermaid text out. It has no dependencies and touches no page,
 * so it runs the same in a browser, in a worker, and in Node.
 */
export { numberStates, recognize } from "./recognize.ts";
export type { DiagramKind, Direction, LineStyle, ReadOptions, Reading, ReadEdge, ReadShape, StateRole, Stroke } from "./recognize.ts";
export { toMermaid, toStateMermaid, escapeLabel, escapeState, nodeText, ARROWS, BRACKETS, PALETTE } from "./mermaid.ts";
export type { MermaidOptions } from "./mermaid.ts";
export { classify, OUTLINE, TEMPLATES } from "./shapes.ts";
export { cleanOutline, snap } from "./snap.ts";
export type { Snap } from "./snap.ts";
export type { OutlineKind, ShapeKind } from "./shapes.ts";
export type { Box, Point } from "./geometry.ts";
