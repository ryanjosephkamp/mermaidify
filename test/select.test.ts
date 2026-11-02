import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { DrawnStroke } from "../src/app/pad.ts";
import { around, boxOf, boxPath, copyStrokes, lassoed, moveStrokes, snapAngle, still, tapped, withKin } from "../src/app/select.ts";
import { densify, type Point } from "../src/reader/geometry.ts";

const s = (id: number, pts: Point[], group?: number): DrawnStroke => ({ id, color: "ink", pts: densify(pts, 3), by: "mouse", ...(group ? { group } : {}) });
const box = (id: number, x: number, y: number, w: number, h: number, group?: number) => s(id, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + 2]], group);
const loop = (x0: number, y0: number, x1: number, y1: number): Point[] => densify([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], 4);
const ids = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe("choosing strokes", () => {
  const drawing = [box(1, 60, 40, 160, 60), s(2, [[140, 104], [140, 196]]), box(3, 60, 200, 160, 60), s(4, [[100, 60], [180, 80]])];

  test("a lasso over part of a stroke takes all of it, and what is drawn inside a box goes with the box", () => {
    // Over the bottom of the top box and the top of the line: the box, the line, and the mark inside the box.
    assert.deepEqual(ids(lassoed(drawing, loop(40, 90, 240, 130))), [1, 2, 4]);
    // Over the mark inside the box alone: just the mark.
    assert.deepEqual(ids(lassoed(drawing, loop(90, 55, 190, 85))), [4]);
    // A lasso with no room in it takes nothing.
    assert.deepEqual(ids(lassoed(drawing, [[0, 0], [10, 10]])), []);
  });

  test("a box over the middle of a straightened line takes it, though the line is only its two ends", () => {
    const straight: DrawnStroke = { id: 9, color: "ink", pts: [[0, 300], [300, 300]], by: "pen" };
    assert.deepEqual(ids(lassoed([straight], boxPath([120, 280], [180, 320]))), [9]);
  });

  test("a press inside a shape takes it, but inside a frame around other shapes it takes nothing", () => {
    const frame = box(1, 0, 0, 400, 300), inner = box(2, 40, 40, 100, 60);
    assert.equal(around([frame, inner], [80, 70]), 2);
    assert.equal(around([frame, inner], [300, 250]), null);
    assert.equal(around([frame], [300, 250]), 1);
  });

  test("a tap takes the nearest stroke within reach, or nothing", () => {
    assert.deepEqual(ids(tapped(drawing, [141, 150], 8)), [2]);
    assert.deepEqual(ids(tapped(drawing, [400, 400], 8)), []);
  });

  test("grouped strokes are chosen together, however they are reached", () => {
    const grouped = [box(1, 0, 0, 50, 50, 7), box(2, 200, 0, 50, 50, 7), box(3, 400, 0, 50, 50)];
    assert.deepEqual(ids(tapped(grouped, [0, 25], 6)), [1, 2]);
    assert.deepEqual(ids(withKin(grouped, [3])), [3]);
  });
});

describe("moving and copying strokes", () => {
  const drawing = [box(1, 0, 0, 100, 50), s(2, [[50, 54], [50, 120]])];

  test("a move shifts, turns, and grows only the chosen strokes, which keep their ids", () => {
    const m = { ...still(50, 25), dx: 10, dy: 5 };
    const moved = moveStrokes(drawing, new Set([1]), m);
    assert.equal(moved[0].id, 1);
    assert.deepEqual(moved[0].pts[0], [10, 5]);
    assert.equal(moved[1], drawing[1]);
    // A quarter turn about the box's middle turns its top left corner to the top right of a standing box.
    const turned = moveStrokes(drawing, new Set([1]), { ...still(50, 25), angle: Math.PI / 2 });
    const b = boxOf(turned, new Set([1]))!;
    assert.ok(Math.abs(b.w - 50) < 1e-6 && Math.abs(b.h - 100) < 1e-6, `${b.w} by ${b.h}`);
    const grown = boxOf(moveStrokes(drawing, new Set([1]), { ...still(0, 0), scale: 2 }), new Set([1]))!;
    assert.ok(Math.abs(grown.w - 200) < 1e-6);
  });

  test("copies get new ids, keep their originals', and are grouped apart from them and from every other group", () => {
    let next = 3;
    const grouped = [box(1, 0, 0, 50, 50, 3), box(2, 100, 0, 50, 50, 3)], other = box(5, 300, 0, 50, 50, 4);
    // The next stroke id is 3 and another group is 4: the copies' group must be neither 3 nor 4.
    const { copies, from } = copyStrokes(grouped, new Set([1, 2]), 20, 20, () => next++, [...grouped, other]);
    assert.deepEqual(copies.map((c) => c.id), [3, 4]);
    assert.deepEqual([...from], [[3, 1], [4, 2]]);
    assert.equal(copies[0].group, copies[1].group);
    assert.equal(copies[0].group, 5);
    assert.deepEqual(copies[0].pts[0], [20, 20]);
  });

  test("turns snap to 15 degrees", () => {
    assert.equal(snapAngle(0.1), 0);
    assert.ok(Math.abs(snapAngle(0.2) - Math.PI / 12) < 1e-9);
    assert.ok(Math.abs(snapAngle(-1.6) + Math.PI / 2) < 1e-9);
  });
});
