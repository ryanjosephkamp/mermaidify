import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { snapChosen } from "../src/app/tidy.ts";
import type { DrawnStroke } from "../src/app/pad.ts";
import { densify, dist } from "../src/reader/geometry.ts";
import { recognize, type Stroke } from "../src/reader/recognize.ts";
import { arrow, box, dashed, ellipse, reset } from "./draw.ts";
import { TEMPLATES, shapeParts } from "../src/app/templates.ts";
import { toStateMermaid } from "../src/reader/mermaid.ts";

beforeEach(() => reset());

const drawn = (list: Stroke[]): DrawnStroke[] => list.map((s, i) => ({ id: i + 1, color: "ink", pts: s.pts, by: "pen" }));
const read = (strokes: readonly DrawnStroke[]) => recognize(strokes, { diagram: "flowchart" });
const snapAll = (strokes: DrawnStroke[]) => {
  let next = 100;
  const r = snapChosen(strokes, new Set(strokes.map((s) => s.id)), read(strokes), () => next++);
  return { ...r, made: r.shapes + r.arrows };
};

describe("snapping chosen strokes", () => {
  test("a line and a V drawn apart, with nothing at their ends, become one clean arrow with the V's point", () => {
    // As in a drawing of an arrow alone: the V drawn past the line's end, up and to the right of it.
    const line = densify([[50, 330], [228, 168]], 3), vee = densify([[208, 145], [262, 145], [240, 189]], 2);
    const { strokes, made } = snapAll(drawn([{ pts: line }, { pts: vee }]));
    assert.equal(made, 1);
    assert.equal(strokes.length, 1);
    assert.equal(strokes[0].id, 1, "the clean arrow keeps the line's id");
    assert.ok(dist(strokes[0].pts[0], [50, 330]) < 1, "the tail stays");
    assert.ok(strokes[0].pts.some((p) => dist(p, [262, 145]) < 1), "the tip is the V's point");
    // Joined to boxes at its ends, it reads as one arrow with its head.
    const m = read([...drawn([box(-80, 330, 100, 60), box(270, 60, 100, 60)]).map((s) => ({ ...s, id: s.id + 10 })), ...strokes]);
    assert.equal(m.edges.length, 1);
    assert.equal(m.edges[0].assumed, false);
  });

  test("a line and a triangle drawn apart become one clean arrow, the triangle's point its tip", () => {
    const line = densify([[50, 300], [250, 200]], 3), tri = densify([[240, 180], [300, 175], [262, 228], [240, 180]], 2);
    const { strokes } = snapAll(drawn([{ pts: line }, { pts: tri }]));
    assert.equal(strokes.length, 1);
    assert.ok(strokes[0].pts.some((p) => dist(p, [300, 175]) < 1), "the tip is the triangle's point");
  });

  test("rough shapes and the arrow between them become clean, and read the same as before", () => {
    const before = drawn([box(40, 40, 140, 60), ellipse(420, 70, 70, 34), ...arrow([[186, 70], [342, 70]], "v")]);
    const m0 = read(before), { strokes, made } = snapAll(before);
    assert.equal(made, 3, "two shapes and one arrow");
    assert.equal(strokes.length, 3, "the arrow's V is part of the clean arrow");
    const m1 = read(strokes);
    assert.deepEqual(m1.nodes.map((n) => n.kind), m0.nodes.map((n) => n.kind));
    assert.deepEqual(m1.edges.map((e) => `${e.from}>${e.to}`), m0.edges.map((e) => `${e.from}>${e.to}`));
    assert.equal(m1.edges[0].assumed, false);
    assert.deepEqual(strokes.map((s) => s.id), [1, 2, 3], "each clean stroke keeps the id of the stroke it replaces");
  });

  test("only chosen strokes snap, and a shape drawn with its line snaps only with that line", () => {
    const b = box(40, 40, 140, 60), lead = densify([[110, 100], [110, 200]], 3);
    // A box and the line leaving its bottom, drawn in one stroke.
    const one: DrawnStroke = { id: 1, color: "ink", pts: [...b.pts, ...lead], by: "pen" };
    const target: DrawnStroke = { id: 2, color: "ink", pts: box(40, 206, 140, 60).pts, by: "pen" };
    const all = [one, target], m = read(all);
    let next = 100;
    const alone = snapChosen(all, new Set([2]), m, () => next++);
    assert.equal(alone.strokes[0], one, "the stroke not chosen stays as it was");
    const both = snapChosen(all, new Set([1, 2]), m, () => next++);
    assert.ok(both.strokes.length >= 3, "the box and its line each become a stroke of their own");
    assert.ok([...both.from.values()].every((was) => was === 1), "the new stroke comes from the one drawn with the box");
    const m1 = read(both.strokes);
    assert.equal(m1.nodes.length, 2);
    assert.equal(m1.edges.length, 1);
  });

  test("a dot chosen with its arrow, a filled dot, and a dotted line keep what they mean", () => {
    // The door's start dot and the arrow from it, chosen together, as a state diagram.
    const door = TEMPLATES.find((t) => t.id === "door")!.parts(), strokes = drawn(door.map((p) => ({ pts: p.pts })));
    const m = recognize(strokes, { diagram: "state" });
    const arrowFromDot = m.edges.find((e) => m.nodes.find((n) => n.id === e.from)?.role === "dot")!;
    const chosen = new Set([strokes[0].id, ...arrowFromDot.strokes.map((i) => strokes[i].id)]);
    let next = 100;
    const after = snapChosen(strokes, chosen, m, () => next++);
    assert.ok(after.strokes.some((s) => s.id === strokes[0].id), "the dot is kept");
    assert.match(toStateMermaid(recognize(after.strokes, { diagram: "state" })), /\[\*\] --> A/);
    // A filled dot alone in a flowchart stays a dot.
    const dot = drawn(shapeParts("dot", 100, 100, 30, 30).map((p) => ({ pts: p.pts })));
    assert.deepEqual(read(snapAll(dot).strokes).nodes.map((n) => n.kind), ["dot"]);
    // A dotted arrow between two boxes stays dotted.
    const styled = drawn([box(40, 40, 140, 60), box(40, 260, 140, 60), ...dashed([[110, 104], [110, 254]], "hook")]);
    assert.equal(read(styled).edges[0].style, "dotted");
    assert.equal(read(snapAll(styled).strokes).edges[0].style, "dotted");
  });
});
