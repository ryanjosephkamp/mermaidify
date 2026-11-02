import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cut } from "../src/app/cut.ts";
import { densify, type Point } from "../src/reader/geometry.ts";
import { recognize } from "../src/reader/recognize.ts";

const stroke = (id: number, pts: Point[], open?: boolean) => ({ id, color: "ink", pts, ...(open ? { open } : {}) });
const ids = (from = 100) => {
  let n = from;
  return () => n++;
};
const on = (p: Point, y: number, x0: number, x1: number) => p[1] === y && p[0] > x0 && p[0] < x1;

describe("cutting part of a stroke", () => {
  test("a cut across a line's middle leaves its two ends as new strokes, open, in its place", () => {
    const line = stroke(1, Array.from({ length: 41 }, (_, i): Point => [i * 5, 0]));
    const before = stroke(2, [[0, 50], [10, 50]]), after = stroke(3, [[0, 80], [10, 80]]);
    const done = cut([before, line, after], [[100, -20], [100, 20]], 10, ids());
    assert.deepEqual(done.strokes.map((s) => s.id), [2, 100, 101, 3]);
    assert.deepEqual(done.pieces.get(1), [100, 101]);
    const [left, right] = [done.strokes[1], done.strokes[2]];
    assert.ok(Math.max(...left.pts.map((p) => p[0])) < 91);
    assert.ok(Math.min(...right.pts.map((p) => p[0])) > 109);
    assert.equal(left.color, "ink");
    assert.equal(left.open, true);
    // Strokes it does not touch are kept as they were.
    assert.equal(done.strokes[0], before);
    assert.equal(done.strokes[3], after);
  });

  test("a cut across a long straight side cuts where it crosses, adding only the two points the gap begins and ends at", () => {
    const box = stroke(1, [[0, 0], [200, 0], [200, 100], [0, 100], [0, 0]]);
    const done = cut([box], [[100, -15], [100, 15]], 8, ids());
    assert.equal(done.strokes.length, 1);
    const piece = done.strokes[0].pts;
    assert.ok(piece.some((p) => on(p, 0, 88, 93)), "the gap begins near x = 92");
    assert.ok(piece.some((p) => on(p, 0, 107, 112)), "and ends near x = 108");
    assert.ok(!piece.some((p) => on(p, 0, 93, 107)), "with nothing between");
    assert.ok(piece.length <= box.pts.length + 2, `${piece.length} points: no more than the stroke's own and two`);
  });

  test("an outline drawn back past its start, cut once, stays one stroke and still reads as a box", () => {
    const pts = densify([[60, 40], [220, 40], [220, 100], [60, 100], [60, 40], [80, 40]], 3);
    const done = cut([stroke(1, pts)], [[50, 70], [70, 70]], 14, ids());
    assert.equal(done.strokes.length, 1);
    assert.deepEqual(recognize(done.strokes).nodes.map((n) => n.kind), ["rect"]);
  });

  test("an outline drawn zoomed in is told as an outline at the size it had on screen", () => {
    // A box 120 by 60 on screen at 400%: 30 by 15 in drawing units, cut once by the eraser's circle at that zoom.
    const pts = densify([[15, 10], [45, 10], [45, 25], [15, 25], [15, 10], [20, 10]], 0.75);
    const done = cut([{ ...stroke(1, pts), zoom: 4 }], [[12.5, 17.5], [17.5, 17.5]], 3.5, ids());
    assert.equal(done.strokes.length, 1);
  });

  test("a piece is open for good: a second cut leaves two pieces, and the first gap stays", () => {
    const box = stroke(1, densify([[0, 0], [200, 0], [200, 100], [0, 100], [0, 0]], 3));
    const once = cut([box], [[100, -10], [100, 10]], 3.5, ids());
    assert.equal(once.strokes.length, 1);
    const twice = cut(once.strokes, [[100, 90], [100, 110]], 3.5, ids(200));
    assert.equal(twice.strokes.length, 2);
    assert.ok(!twice.strokes.some((s) => s.pts.some((p) => on(p, 0, 97, 103))));
  });

  test("a stroke whose ends happen to be near each other is no outline, and gets no bridge across its mouth", () => {
    const v = stroke(1, densify([[0, 0], [6, 20], [12, 0]], 1));
    const done = cut([v], [[6, 20]], 5, ids());
    assert.equal(done.strokes.length, 2);
  });

  test("a stroke cut away whole leaves nothing, and a sliver at an end is dropped", () => {
    const dot = stroke(1, [[0, 0], [2, 1], [3, 0]]);
    assert.deepEqual(cut([dot], [[1, 0]], 6, ids()).pieces.get(1), []);
    const line = stroke(2, Array.from({ length: 101 }, (_, i): Point => [i, 0]));
    const done = cut([line], [[97, -5], [97, 5]], 2, ids(), 3);
    assert.equal(done.strokes.length, 1, "the 1-unit piece past the cut is dropped");
    assert.ok(Math.max(...done.strokes[0].pts.map((p) => p[0])) <= 95.5);
  });

  test("the strokes given are not changed, and a path that touches nothing changes nothing", () => {
    const line = stroke(1, [[0, 0], [100, 0]]);
    const frozen = JSON.stringify(line);
    cut([line], [[50, -5], [50, 5]], 4, ids());
    assert.equal(JSON.stringify(line), frozen);
    const none = cut([line], [[50, 30], [60, 30]], 4, ids());
    assert.deepEqual(none.strokes, [line]);
    assert.equal(none.pieces.size, 0);
    assert.equal(cut([line], [], 4, ids()).pieces.size, 0);
  });
});
