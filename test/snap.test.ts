import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { densify, dist, type Point } from "../src/reader/geometry.ts";
import { oneStrokeArrow } from "../src/reader/arrows.ts";
import { recognize } from "../src/reader/recognize.ts";
import { cleanArrow, cleanOutline, snap } from "../src/reader/snap.ts";
import { arrow, box, diamond, ellipse, hexagon, line, reset, trapezoid } from "./draw.ts";

beforeEach(() => reset());

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not near ${b}`);

describe("holding a shape", () => {
  test("a box drawn askew snaps to a level box of its own size, not the size of the box around it", () => {
    const a = (15 * Math.PI) / 180, c: Point = [120, 70];
    const pts = box(40, 40, 160, 60).pts.map(([x, y]): Point => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]);
    const r = snap(pts)!;
    assert.equal(r.kind, "rect");
    near(r.box.w, 160, 10, "width");
    near(r.box.h, 60, 10, "height");
  });

  test("a small box held still while zoomed in snaps as the same box drawn at 100% does, in drawing units", () => {
    const pts = box(40, 40, 100, 60).pts.map(([x, y]): Point => [x / 4, y / 4]);
    const r = snap(pts, 0, 4)!;
    assert.equal(r.kind, "rect");
    near(r.box.w, 25, 2, "width");
    near(r.box.h, 15, 2, "height");
  });

  test("each outline snaps to its own kind, clean and closed, and reads as that kind", () => {
    const cases: [string, Point[]][] = [
      ["rect", box(40, 40, 140, 60).pts],
      ["diamond", diamond(110, 90, 140, 90).pts],
      ["hexagon", hexagon(40, 40, 150, 60).pts],
      ["trapezoid", trapezoid(40, 40, 150, 60).pts],
      ["circle", ellipse(100, 100, 34, 34).pts],
      ["stadium", ellipse(120, 80, 70, 26).pts],
    ];
    for (const [kind, pts] of cases) {
      const r = snap(pts);
      assert.ok(r, kind + " snaps");
      assert.equal(r.kind, kind);
      assert.deepEqual(r.pts[0], r.pts[r.pts.length - 1], kind + " is closed");
      assert.deepEqual(recognize([{ pts: r.pts }]).nodes.map((n) => n.kind), [kind], kind + " reads the same");
    }
  });

  test("the clean shape keeps the drawn shape's place and size", () => {
    const r = snap(box(40, 40, 140, 60).pts)!;
    near(r.box.x0, 40, 4, "left");
    near(r.box.y0, 40, 4, "top");
    near(r.box.w, 140, 6, "width");
    near(r.box.h, 60, 6, "height");
  });

  test("a near circle becomes round, and a near square square; a wide box stays wide", () => {
    const c = snap(ellipse(100, 100, 36, 31).pts)!;
    near(c.box.w, c.box.h, 0.01, "circle");
    const sq = snap(box(40, 40, 100, 94).pts)!;
    near(sq.box.w, sq.box.h, 0.01, "square");
    const wide = snap(box(40, 40, 160, 60).pts)!;
    assert.ok(wide.box.w > 2 * wide.box.h);
  });

  test("a line that led to the shape is left out of it, and where it ends is given", () => {
    const lead: Point[] = densify([[100, -80], [100, 40]], 3);
    const outline = box(40, 40, 140, 60).pts;
    const pts = [...lead, ...outline];
    const r = snap(pts)!;
    assert.equal(r.kind, "rect");
    near(r.box.y0, 40, 4, "the top stays at the box, not the line above it");
    assert.ok(r.from >= lead.length - 8 && r.from <= lead.length + 8, `the shape starts where the line met it (${r.from})`);
  });

  test("a second shape drawn inside the first, without lifting, snaps on its own", () => {
    const outer = box(40, 40, 160, 100).pts;
    const inner = box(60, 60, 120, 60).pts;
    const r = snap([...outer.slice(-1), ...densify([outer[outer.length - 1], inner[0]], 3), ...inner])!;
    assert.equal(r.kind, "rect");
    near(r.box.x0, 60, 4, "inner left");
    near(r.box.w, 120, 6, "inner width");
  });

  test("the clean shape starts where the drawn one did, so a loop on a shape stays a loop", () => {
    const host = box(40, 40, 140, 60);
    const curl = densify([[180, 58], [228, 44], [256, 70], [230, 100], [180, 86], [181, 61]], 3);
    const before = recognize([host, { pts: curl }]);
    assert.deepEqual(before.edges.map((e) => e.from + e.to), ["AA"], "drawn by hand, it is a loop on the box");
    const r = snap(curl)!;
    assert.ok(dist(r.pts[0], curl[0]) < 14, "it starts near where the stroke began");
    const after = recognize([host, { pts: r.pts }]);
    assert.equal(after.nodes.length, 1);
    assert.deepEqual(after.edges.map((e) => e.from + e.to), ["AA"], "snapped, it is still a loop on the box");
  });

  test("an outline too rough to be any shape, or not closed, does not snap as a shape", () => {
    const star: Point[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 30 : 80;
      star.push([150 + r * Math.cos(a), 150 + r * Math.sin(a)]);
    }
    assert.equal(snap(densify(star, 3))?.kind ?? null, null);
    const open = box(40, 40, 140, 60).pts.slice(0, -60);
    assert.notEqual(snap(open)?.kind, "rect");
  });
});

describe("holding a line", () => {
  test("a nearly straight line becomes straight", () => {
    const r = snap(line([[20, 20], [220, 30]]).pts)!;
    assert.equal(r.kind, "line");
    assert.equal(r.pts.length, 2);
    near(r.pts[1][0], 220, 3, "it ends where it was held");
  });

  test("a curve, a hook, and a short dash stay as drawn", () => {
    const curve: Point[] = Array.from({ length: 60 }, (_, i): Point => [20 + i * 4, 100 + 40 * Math.sin(i / 19)]);
    assert.equal(snap(curve), null);
    assert.equal(snap(arrow([[20, 20], [220, 20]], "hook")[0].pts), null);
    assert.equal(snap(densify([[20, 20], [35, 20]], 3)), null);
  });

  test("a line bent by holding at its corner keeps the corner", () => {
    const first = densify([[20, 20], [200, 20]], 3), r1 = snap(first)!;
    const bent = [...first.slice(0, r1.from), ...r1.pts, ...densify([[200, 20], [200, 160]], 3).slice(1)];
    const anchor = r1.from + 1;
    const r2 = snap(bent, anchor)!;
    assert.equal(r2.kind, "line");
    assert.deepEqual(r2.pts[0], [200, 20]);
    assert.equal(r2.from, anchor);
  });
});

describe("clean outlines", () => {
  test("corners are kept twice so a smoothed line turns sharply, and points stay close together", () => {
    const pts = cleanOutline("rect", { x0: 0, y0: 0, x1: 120, y1: 60, w: 120, h: 60, cx: 60, cy: 30 });
    const twice = pts.filter((p, i) => i > 0 && dist(p, pts[i - 1]) === 0).length;
    assert.equal(twice, 5, "four corners, and the start again where the outline closes");
    for (let i = 1; i < pts.length; i++) assert.ok(dist(pts[i], pts[i - 1]) <= 6.01);
  });
});

describe("snapping an arrow", () => {
  test("a clean arrow reads as an arrow with its head, whichever way it is aimed and at any zoom", () => {
    for (const zoom of [0.3, 1, 2.5])
      for (const [tx, ty] of [[300, 40], [140, 260], [300, 260], [-60, 200]]) {
        const k = 1 / zoom, at = (x: number, y: number): Point => [x * k, y * k];
        const shape = (x: number, y: number) => box(x * k, y * k, 120 * k, 60 * k);
        const target = shape(tx - 60, ty - (ty > 100 ? 0 : 30));
        const tip = at(tx - (tx > 200 ? 64 : 0), ty > 100 ? ty - 4 : ty);
        const m = recognize([{ ...shape(80, 10), zoom }, { color: "ink", pts: cleanArrow(at(140, 74), tip, zoom), zoom }, { ...target, zoom }]);
        assert.deepEqual(m.edges.map((e) => `${e.from}>${e.to}${e.assumed ? "?" : ""}`).length, 1, `${zoom} ${tx},${ty}`);
        assert.equal(m.edges[0].assumed, false, `${zoom} ${tx},${ty}: the head is read`);
        assert.equal(m.nodes.length, 2, `${zoom} ${tx},${ty}`);
      }
  });

  test("an arrow held at its end is found whether its head is a V or a closed triangle, drawn from its tip or its back", () => {
    const tail: Point = [100, 300], tip: Point = [400, 200], a = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
    const back = (k: number, side: number): Point => [tip[0] - k * Math.cos(a) + side * Math.sin(a), tip[1] - k * Math.sin(a) - side * Math.cos(a)];
    for (const s of [14, 40, 90]) {
      const A = back(0.87 * s, s / 2), B = back(0.87 * s, -s / 2), M = back(0.87 * s, 0);
      const drawn: Record<string, Point[]> = { vee: [tail, tip, A, tip, B], "from its tip": [tail, tip, A, B, tip], "from its back": [tail, M, A, tip, B, M] };
      for (const [how, pts] of Object.entries(drawn)) {
        const found = oneStrokeArrow(densify(pts, 3));
        assert.ok(found, `a head ${s} across, ${how}`);
        assert.ok(dist(found.tail, tail) < 2 && dist(found.tip, tip) < 2, `a head ${s} across, ${how}: ${found.tail} to ${found.tip}`);
      }
    }
    // A shape alone, a line that leads into a box, and a line that leads into a triangle nearly its size are no arrows.
    const triangle = densify([[100, 100], [200, 100], [150, 20], [100, 100]], 3);
    const intoBox = densify([[0, 200], [200, 200], [200, 160], [280, 160], [280, 240], [200, 240], [200, 200]], 3);
    const intoTriangle = densify([[0, 200], [200, 200], [200, 140], [290, 200], [200, 260], [200, 200]], 3);
    // A line that runs on along the base of a triangle standing on it, a shape the line leads to, of several sizes.
    const alongBase = [120, 160, 200].flatMap((len) => [60, 70, 80].map((s) => densify([[0, 200], [len, 200], [len + s, 200], [len + s / 2, 200 - 0.87 * s], [len, 200]], 3)));
    for (const pts of [triangle, box(0, 0, 100, 60).pts, intoBox, intoTriangle, ...alongBase]) assert.equal(oneStrokeArrow(pts), null);
  });

  test("a clean two-way arrow reads with a head at each end, whichever way it is aimed", () => {
    for (const zoom of [0.5, 1, 2])
      for (const [tx, ty] of [[300, 40], [140, 260], [-60, 200]]) {
        const k = 1 / zoom, shape = (x: number, y: number) => box(x * k, y * k, 120 * k, 60 * k);
        const target = shape(tx - 60, ty - (ty > 100 ? 0 : 30)), tip: Point = [(tx - (tx > 200 ? 64 : 0)) * k, (ty > 100 ? ty - 4 : ty) * k];
        const m = recognize([{ ...shape(80, 10), zoom }, { color: "ink", pts: cleanArrow([140 * k, 74 * k], tip, zoom, true), zoom }, { ...target, zoom }]);
        assert.equal(m.edges.length, 1, `${zoom} ${tx},${ty}`);
        assert.ok(m.edges[0].both && !m.edges[0].assumed, `${zoom} ${tx},${ty}: both heads are read`);
      }
  });
});
