import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { exampleStrokes } from "../src/example.ts";
import { escapeLabel, nodeText, recognize, toMermaid, toStateMermaid, type Reading, type Stroke } from "../src/reader/index.ts";
import type { Point } from "../src/reader/geometry.ts";
import { arrow, box, dashed, diamond, ellipse, hatch, hexagon, invTrapezoid, line, parallelogram, reset, scribble, trapezoid, triangle } from "./draw.ts";
import { generate } from "./gen.ts";

beforeEach(() => reset());

const kinds = (m: Reading) => m.nodes.map((n) => n.kind);
const links = (m: Reading) => m.edges.map((e) => `${e.from}${e.both ? "<->" : ">"}${e.to}`);
const styles = (m: Reading) => m.edges.map((e) => e.style);

describe("shapes", () => {
  test("each outline drawn alone reads as its kind", () => {
    const cases: [string, Stroke[]][] = [
      ["rect", [box(40, 40, 140, 60)]],
      ["diamond", [diamond(110, 90, 140, 90)]],
      ["hexagon", [hexagon(40, 40, 150, 60)]],
      ["trapezoid", [trapezoid(40, 40, 150, 60)]],
      ["circle", [ellipse(100, 100, 34, 34)]],
      ["stadium", [ellipse(120, 80, 70, 26)]],
      ["double", [ellipse(100, 100, 34, 34), ellipse(100, 100, 21, 21)]],
      ["subroutine", [box(40, 40, 150, 70), box(52, 50, 126, 50)]],
      ["inv-trapezoid", [invTrapezoid(40, 40, 150, 60)]],
      ["lean-right", [parallelogram(40, 40, 150, 60)]],
      ["lean-left", [parallelogram(40, 40, 150, 60, true)]],
      ["triangle", [triangle(40, 40, 110, 80)]],
      ["flip-triangle", [triangle(40, 40, 110, 80, true)]],
    ];
    for (const [kind, strokes] of cases) {
      const m = recognize(strokes);
      assert.deepEqual(kinds(m), [kind], kind);
      assert.deepEqual(m.nodes[0].strokes, strokes.map((_, i) => i), kind + " keeps its strokes");
    }
  });

  test("a closed arrowhead is never a triangle: a small closed mark where a line meets a shape is its head", () => {
    const m = recognize([box(80, 40, 120, 60), line([[140, 104], [140, 184]]), line([[120, 184], [160, 184], [140, 222], [121, 185]]), box(80, 226, 120, 60)]);
    assert.deepEqual(kinds(m), ["rect", "rect"]);
    assert.deepEqual(links(m), ["A>B"]);
  });

  test("a box drawn in four strokes is one box", () => {
    const m = recognize([line([[40, 40], [200, 42]]), line([[202, 40], [200, 110]]), line([[200, 112], [40, 110]]), line([[40, 112], [41, 42]])]);
    assert.deepEqual(kinds(m), ["rect"]);
    assert.deepEqual(m.nodes[0].strokes, [0, 1, 2, 3]);
  });

  test("a shape around others is a group, and the shapes inside name it as their parent", () => {
    const m = recognize([box(20, 20, 300, 260), box(60, 60, 120, 50), box(60, 190, 120, 50), ...arrow([[120, 112], [120, 186]])]);
    assert.equal(m.groups.length, 1);
    assert.equal(m.groups[0].id, "G1");
    assert.deepEqual(m.nodes.map((n) => n.parent), ["G1", "G1"]);
    assert.match(toMermaid(m), /subgraph G1 \["Group 1"\]\n {4}A\["Node 1"\]\n {4}B\["Node 2"\]\n {2}end/);
  });

  test("a dot, a tap, or an empty stroke is not read", () => {
    const m = recognize([{ pts: [[10, 10]] }, { pts: [[10, 10], [12, 11]] }, { pts: [] }, { pts: [[NaN, NaN], [NaN, 1]] }]);
    assert.deepEqual(m.nodes, []);
    assert.deepEqual(m.unused, []);
  });
});

describe("lines and heads", () => {
  const twoBoxes = () => [box(40, 40, 140, 60), box(40, 220, 140, 60)];

  for (const head of ["hook", "v", "none"] as const)
    test(`a line with ${head === "none" ? "no head" : `a ${head} head`} joins two shapes, pointing down`, () => {
      const m = recognize([...twoBoxes(), ...arrow([[110, 104], [110, 216]], head)]);
      assert.deepEqual(links(m), ["A>B"]);
      assert.equal(m.edges[0].assumed, head === "none");
      assert.equal(m.direction, "TD");
    });

  /** Whether the reading's one arrow runs from the lower box up to the higher one. */
  const upward = (m: Reading) => {
    const at = (id: string) => m.nodes.find((n) => n.id === id)!.bb.cy;
    return m.edges.length === 1 && at(m.edges[0].from) > at(m.edges[0].to);
  };

  test("a head at the start turns the line around", () => {
    // Drawn top to bottom, with its V at the top.
    const m = recognize([...twoBoxes(), line([[110, 104], [110, 216]]), ...arrow([[110, 150], [110, 102]], "v").slice(1)]);
    assert.ok(upward(m));
    assert.equal(m.edges[0].assumed, false);
    // Ids follow reading order, which starts at the bottom when the arrows run up.
    assert.equal(m.direction, "BT");
    assert.deepEqual(links(m), ["A>B"]);
  });

  test("a hook drawn at a line's start points it back", () => {
    const m = recognize([...twoBoxes(), ...arrow([[110, 104], [110, 216]], "hook").map((s) => ({ ...s, pts: s.pts.slice().reverse() }))]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.direction, "TD");
  });

  test("a line drawn upward with no head points up", () => {
    const m = recognize([...twoBoxes(), ...arrow([[110, 216], [110, 104]], "none")]);
    assert.ok(upward(m));
    assert.equal(m.edges[0].assumed, true);
  });

  test("heads at both ends make a two-way arrow", () => {
    const strokes = [...twoBoxes(), ...arrow([[110, 104], [110, 216]], "v"), ...arrow([[110, 216], [110, 104]], "v").slice(1)];
    const m = recognize(strokes);
    assert.deepEqual(links(m), ["A<->B"]);
    assert.match(toMermaid(m), /A <--> B/);
  });

  test("a V head between shapes drawn close together is the head, not the line", () => {
    const m = recognize([box(40, 40, 140, 60), box(40, 126, 140, 60), ...arrow([[110, 103], [110, 123]], "v")]);
    assert.deepEqual(links(m), ["A>B"]);
  });

  test("arrows running right read left to right", () => {
    const m = recognize([box(20, 40, 110, 60), box(220, 40, 110, 60), ...arrow([[134, 70], [216, 70]])]);
    assert.equal(m.direction, "LR");
    assert.deepEqual(links(m), ["A>B"]);
  });

  test("a line that leaves a shape and comes back is a loop on it", () => {
    const m = recognize([box(40, 40, 140, 60), ...arrow([[184, 60], [240, 60], [240, 90], [184, 90]])]);
    assert.deepEqual(links(m), ["A>A"]);
    assert.equal(m.loops, 1);
  });

  test("a long stroke that reaches no shape is left out", () => {
    const m = recognize([box(40, 40, 140, 60), line([[300, 300], [420, 320], [380, 420]])]);
    assert.deepEqual(m.unused, [1]);
    assert.equal(m.edges.length, 0);
  });
});

describe("dotted and thick lines", () => {
  const twoBoxes = () => [box(40, 40, 140, 60), box(40, 220, 140, 60)];

  for (const head of ["hook", "v", "none"] as const)
    test(`dashes in a row with ${head === "none" ? "no head" : `a ${head} head`} are one dotted line`, () => {
      const drawn = dashed([[110, 104], [110, 216]], head), m = recognize([...twoBoxes(), ...drawn]);
      assert.ok(drawn.length >= 5);
      assert.deepEqual(links(m), ["A>B"]);
      assert.deepEqual(styles(m), ["dotted"]);
      assert.equal(m.edges[0].assumed, head === "none");
      assert.deepEqual(m.edges[0].strokes, drawn.map((_, i) => i + 2));
      assert.deepEqual(m.unused, []);
    });

  // Upward, the diagram runs bottom to top, so the lower box is A.
  test("dashes drawn upward point up, and a hook at the start turns them around", () => {
    const up = recognize([...twoBoxes(), ...dashed([[110, 216], [110, 104]], "none")]);
    assert.equal(up.direction, "BT");
    assert.deepEqual(links(up), ["A>B"]);
    const back = dashed([[110, 216], [110, 104]], "hook").reverse().map((s) => ({ ...s, pts: s.pts.slice().reverse() }));
    const m = recognize([...twoBoxes(), ...back]);
    assert.equal(m.direction, "BT");
    assert.deepEqual([links(m), styles(m)], [["A>B"], ["dotted"]]);
  });

  test("dashes in any order, long or short, around a corner, make one line", () => {
    const m = recognize([...twoBoxes(), ...dashed([[110, 104], [110, 216]], "v", 22, 12).reverse()]);
    assert.deepEqual(styles(m), ["dotted"]);
    const short = recognize([...twoBoxes(), ...dashed([[110, 104], [110, 216]], "v", 9, 6)]);
    assert.deepEqual(styles(short), ["dotted"]);
    const loop = recognize([box(40, 40, 140, 60), box(40, 220, 140, 60), ...dashed([[184, 250], [240, 250], [240, 70], [184, 70]], "v")]);
    assert.equal(loop.direction, "BT");
    assert.deepEqual([links(loop), styles(loop)], [["A>B"], ["dotted"]]);
  });

  test("two dashes between shapes drawn close together are a dotted line", () => {
    const m = recognize([box(40, 40, 140, 60), box(40, 150, 140, 60), ...dashed([[110, 104], [110, 146]], "v", 14, 10)]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.deepEqual(styles(m), ["dotted"]);
  });

  test("dashes that reach no shape are left out, and a line drawn in two touching pieces is no dotted line", () => {
    const far = dashed([[260, 40], [260, 200]], "none"), loose = recognize([...twoBoxes(), ...far]);
    assert.deepEqual(loose.edges, []);
    assert.equal(loose.unused.length, far.length);
    // Each piece is too long to be a dash and reaches only one shape, so both are left out, as they were before.
    const pieces = recognize([...twoBoxes(), line([[110, 104], [110, 160]]), ...arrow([[110, 161], [110, 216]])]);
    assert.deepEqual([pieces.edges, pieces.unused], [[], [2, 3]]);
  });

  test("a line gone over again is one thick line, with the head from either stroke", () => {
    for (const head of ["hook", "v", "none"] as const) {
      const m = recognize([...twoBoxes(), ...arrow([[110, 104], [110, 216]], head), line([[113, 108], [112, 214]])]);
      assert.deepEqual(links(m), ["A>B"], head);
      assert.deepEqual(styles(m), ["thick"], head);
      assert.equal(m.edges[0].assumed, head === "none", head);
    }
    const back = recognize([...twoBoxes(), line([[110, 104], [110, 216]]), ...arrow([[113, 214], [112, 108]])]);
    assert.equal(back.direction, "BT");
    assert.deepEqual(links(back), ["A>B"]);
    assert.deepEqual(styles(back), ["thick"]);
    const thrice = recognize([...twoBoxes(), ...arrow([[110, 104], [110, 216]]), line([[113, 108], [112, 214]]), line([[107, 110], [108, 212]])]);
    assert.deepEqual(styles(thrice), ["thick"]);
    assert.equal(thrice.edges[0].strokes.length, 3);
  });

  test("two arrows close together that point opposite ways stay two plain arrows", () => {
    const m = recognize([...twoBoxes(), ...arrow([[106, 104], [106, 216]]), ...arrow([[114, 216], [114, 104]])]);
    assert.deepEqual(links(m), ["A>B", "B>A"]);
    assert.deepEqual(styles(m), ["plain", "plain"]);
  });

  test("short arrows that meet at a small shape's corners stay two arrows, plain or dotted", () => {
    const shapes = () => [box(140, 20, 120, 50), diamond(200, 129, 50, 50), box(258, 104, 100, 50)];
    for (const head of ["v", "none"] as const) {
      const m = recognize([...shapes(), ...arrow([[200, 74], [200, 104]], head), ...arrow([[225, 129], [259, 129]], head)]);
      assert.deepEqual([links(m), styles(m)], [["A>B", "B>C"], ["plain", "plain"]], head);
    }
    const far = () => [box(140, 20, 120, 50), diamond(200, 200, 50, 50), box(330, 175, 100, 50)];
    for (const head of ["v", "none"] as const) {
      const m = recognize([...far(), ...dashed([[200, 74], [200, 172]], head, 22, 10), ...dashed([[228, 200], [326, 200]], head, 22, 10)]);
      assert.deepEqual([links(m), styles(m)], [["A>B", "B>C"], ["dotted", "dotted"]], head);
    }
  });

  test("a short arrow with a V head between shapes drawn close together keeps its head", () => {
    for (const gap of [24, 34]) {
      const m = recognize([box(40, 40, 140, 60), box(40, 100 + gap, 140, 60), ...arrow([[110, 102], [110, 98 + gap]], "v")]);
      assert.deepEqual([links(m), styles(m), m.edges[0]?.assumed], [["A>B"], ["plain"], false], String(gap));
    }
    // A V as big as its 19-unit line, from the generated drawings, once read as a thick line with no head.
    const m = recognize(generate(1, 448, { styles: false, ampMax: 4 })[447].strokes);
    assert.deepEqual([links(m), styles(m), m.edges.map((e) => e.assumed)], [["A>B", "B>C"], ["plain", "plain"], [false, false]]);
  });

  test("two arrows side by side on a long run stay two, however long", () => {
    for (const [len, apart] of [[300, 20], [500, 30], [800, 40]]) {
      const m = recognize([box(40, 40, 140, 60), box(40, 104 + len, 140, 60), ...arrow([[110 - apart / 2, 104], [110 - apart / 2, 100 + len]]), ...arrow([[110 + apart / 2, 104], [110 + apart / 2, 100 + len]])]);
      assert.deepEqual([links(m), styles(m)], [["A>B", "A>B"], ["plain", "plain"]], `${len} long, ${apart} apart`);
    }
  });

  test("a line with no head drawn back over an arrow goes over it, so the arrow turns thick", () => {
    const m = recognize([box(40, 40, 140, 60), box(40, 220, 140, 60), ...arrow([[107, 104], [107, 216]]), ...arrow([[113, 216], [113, 104]], "none")]);
    assert.deepEqual([links(m), styles(m), m.edges[0].assumed], [["A>B"], ["thick"], false]);
  });

  test("two lines that part in the middle stay two lines", () => {
    const m = recognize([...twoBoxes(), ...arrow([[100, 104], [80, 160], [100, 216]]), ...arrow([[120, 104], [140, 160], [120, 216]])]);
    assert.deepEqual(styles(m), ["plain", "plain"]);
  });
});

describe("drawn as people draw", () => {
  // Habits seen in drawings people made over charts (Google's Didi set; see test/didi), each read wrong before.
  test("a head filled in with many strokes of the pen still points the line", () => {
    const fill: [number, number][] = [[300, 70], [278, 58], [278, 82], [300, 70], [282, 62], [282, 78], [300, 70], [286, 66], [286, 74], [300, 70]];
    const m = recognize([box(40, 40, 140, 60), box(300, 40, 150, 60), line([[296, 70], [184, 70]]), line(fill)]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.deepEqual(m.unused, []);
  });

  test("a V with its tip on the shape and its arms reaching out is the line's head, not a loop", () => {
    const m = recognize([box(40, 40, 140, 60), box(300, 40, 150, 60), line([[280, 70], [184, 70]]), line([[272, 52], [300, 70], [272, 88]])]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.loops, 0);
  });

  test("a line that stops a little short of a shape still reaches it", () => {
    const m = recognize([box(40, 40, 140, 60), box(300, 40, 140, 60), ...arrow([[184, 70], [266, 70]])]);
    assert.deepEqual(links(m), ["A>B"]);
  });

  test("an outline whose end stops short of its start is still a shape", () => {
    const m = recognize([line([[72, 40], [180, 40], [180, 120], [40, 120], [40, 42]])]);
    assert.deepEqual(kinds(m), ["rect"]);
  });

  test("an outline drawn in two strokes with gaps between them is still one shape", () => {
    const m = recognize([line([[40, 40], [180, 40], [180, 95]]), line([[180, 120], [40, 120], [40, 63]])]);
    assert.deepEqual(kinds(m), ["rect"]);
  });

  test("two arrows side by side, one each way, stay two arrows even when they stop short of the shapes", () => {
    const down = recognize([box(40, 40, 160, 60), box(40, 260, 160, 60), ...arrow([[110, 115], [110, 245]], "v"), ...arrow([[130, 245], [130, 115]], "v")]);
    assert.deepEqual(kinds(down), ["rect", "rect"]);
    assert.deepEqual(links(down), ["A>B", "B>A"]);
    const across = recognize([box(40, 40, 120, 60), box(320, 40, 120, 60), ...arrow([[174, 60], [306, 60]], "v"), ...arrow([[306, 82], [174, 82]], "v")]);
    assert.deepEqual(kinds(across), ["rect", "rect"]);
    assert.deepEqual(links(across), ["A>B", "B>A"]);
  });

  test("a small loop on a shape beside another arrow's start is a loop, not that arrow's head", () => {
    for (const head of ["v", "none"] as const) {
      const m = recognize([box(40, 40, 140, 60), box(300, 40, 140, 60), ...arrow([[184, 72], [296, 72]]), ...arrow([[160, 36], [160, 14], [200, 14], [200, 56], [186, 56]], head)]);
      assert.deepEqual(links(m).sort(), ["A>A", "A>B"], head);
    }
  });

  test("an arrow that stops outside a group reaches the group, not a shape just inside it", () => {
    const m = recognize([box(20, 120, 320, 200), box(60, 154, 150, 60), box(250, 160, 70, 50), box(60, 0, 150, 60), ...arrow([[135, 64], [135, 116]])]);
    const top = m.nodes.find((n) => n.bb.cy < 60)!;
    assert.deepEqual(m.edges.map((e) => `${e.from === top.id ? "top" : e.from}>${e.to}`), ["top>G1"]);
  });

  test("a line alongside a shape, not touching it, is no loop", () => {
    const m = recognize([box(40, 40, 150, 60), box(300, 40, 150, 60), ...arrow([[194, 70], [296, 70]]), line([[50, 136], [180, 138]])]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.loops, 0);
  });

  test("a word written beside an arrow's start does not turn the arrow around", () => {
    const yes: [number, number][] = [[192, 70], [197, 82], [202, 70], [199, 84], [196, 92], [206, 78], [212, 76], [208, 82], [214, 84], [222, 76], [216, 76], [218, 82], [224, 84]];
    for (const head of ["hook", "none"] as const) {
      const m = recognize([diamond(110, 90, 140, 90), box(300, 60, 140, 60), ...arrow([[184, 90], [296, 90]], head), line(yes)]);
      assert.deepEqual(links(m), ["A>B"], head);
    }
  });

  test("a small closed mark at a shape's edge is the head of the line that ends at it, not a shape", () => {
    const shapes = () => [box(40, 40, 140, 60), box(300, 40, 140, 60)];
    const m = recognize([...shapes(), line([[184, 70], [268, 70]]), ellipse(284, 70, 16, 14)]);
    assert.deepEqual(kinds(m), ["rect", "rect"]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.edges[0].assumed, false);
    assert.deepEqual(m.edges[0].strokes, [2, 3]);
    // With no line ending at it, the mark is a shape; so is a small shape standing apart where a line ends.
    assert.equal(recognize([...shapes(), ellipse(284, 70, 16, 14)]).nodes.length, 3);
    const apart = recognize([box(40, 40, 140, 60), ellipse(300, 70, 20, 20), ...arrow([[184, 70], [276, 70]])]);
    assert.deepEqual(kinds(apart), ["rect", "circle"]);
    assert.deepEqual(links(apart), ["A>B"]);
  });

  test("a head drawn apart from its line counts when its arms are long, or when it is filled in a little past the line's end", () => {
    const v: [number, number][] = [[296 - 40, 48], [296, 70], [296 - 40, 92]];
    const filled: [number, number][] = [[300, 70], [278, 58], [278, 82], [300, 70], [282, 62], [282, 78], [300, 70], [286, 66], [286, 74], [294, 70]];
    for (const [name, head, end] of [["long arms", v, 296], ["filled", filled, 272]] as const) {
      const m = recognize([box(40, 40, 140, 60), box(310, 40, 140, 60), line([[end, 70], [184, 70]]), line(head.slice())]);
      assert.deepEqual(links(m), ["A>B"], name);
      assert.equal(m.edges[0].assumed, false, name);
      assert.deepEqual(m.unused, [], name);
    }
  });

  test("a head filled in at a line's start or end, in the same stroke, points the line", () => {
    const knot: [number, number][] = [[300, 70], [278, 58], [278, 82], [300, 70], [282, 62], [282, 78], [300, 70], [286, 66], [286, 74], [294, 70]];
    for (const first of [true, false]) {
      const pts = first ? [...knot, [184, 70] as [number, number]] : [[184, 70] as [number, number], ...knot.slice().reverse()];
      const m = recognize([box(40, 40, 140, 60), box(300, 40, 140, 60), line(pts)]);
      assert.deepEqual(links(m), ["A>B"], first ? "head first" : "head last");
      assert.equal(m.edges[0].assumed, false);
    }
  });

  test("a shape and a line drawn in one stroke are both read, whichever comes first", () => {
    const lineThenBox = line([[184, 70], [300, 70], [300, 40], [440, 40], [440, 100], [300, 100], [300, 73]]);
    const m = recognize([box(40, 40, 140, 60), lineThenBox]);
    assert.deepEqual(kinds(m), ["rect", "rect"]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.deepEqual(m.nodes[1].strokes, [1]);
    assert.deepEqual(m.edges[0].strokes, [1]);
    const boxThenLine = line([[180, 70], [180, 40], [40, 40], [40, 100], [180, 100], [180, 68], [296, 70]]);
    const n = recognize([boxThenLine, box(300, 40, 140, 60), line([[278, 58], [300, 70], [278, 82]])]);
    assert.deepEqual(kinds(n), ["rect", "rect"]);
    assert.deepEqual(links(n), ["A>B"]);
    assert.equal(n.edges[0].assumed, false);
    // A box, a line, and a box, all in one stroke.
    const three = recognize([line([[180, 70], [180, 40], [40, 40], [40, 100], [180, 100], [180, 68], [300, 70], [300, 40], [440, 40], [440, 100], [300, 100], [300, 72]])]);
    assert.deepEqual(kinds(three), ["rect", "rect"]);
    assert.deepEqual(links(three), ["A>B"]);
    // When the line reaches nothing, the shape is still read, and the stroke is shaded as not all read.
    const nowhere = recognize([line([[180, 70], [180, 40], [40, 40], [40, 100], [180, 100], [180, 68], [240, 70]]), box(300, 40, 140, 60)]);
    assert.deepEqual(kinds(nowhere), ["rect", "rect"]);
    assert.deepEqual(nowhere.edges, []);
    assert.deepEqual(nowhere.unused, [0]);
  });

  test("where a line runs on into the shape drawn in its stroke, the pen's turn into the outline is no head", () => {
    const m = recognize([box(40, 40, 140, 60), line([[196, 60], [184, 70], [196, 80]]), line([[186, 70], [308, 72], [301, 65], [300, 52], [300, 62], [300, 100], [440, 100], [440, 40], [300, 40], [300, 61]])]);
    const left = m.nodes.find((n) => n.bb.cx < 200)!;
    assert.equal(m.edges.length, 1);
    assert.equal(m.edges[0].both, false);
    assert.equal(m.edges[0].to, left.id);
  });

  test("a big closed head drawn in the same stroke as its line is its head, not a shape", () => {
    for (const s of [28, 32]) {
      const m = recognize([box(40, 40, 140, 60), box(330, 40, 140, 60), line([[184, 70], [310, 70], [280, 70 - s], [280, 70 + s], [312, 70]])]);
      assert.deepEqual(kinds(m), ["rect", "rect"], `head ${2 * s} tall`);
      assert.deepEqual(links(m), ["A>B"], `head ${2 * s} tall`);
      assert.equal(m.edges[0].assumed, false, `head ${2 * s} tall`);
    }
  });

  test("a closed head goes to the line that arrives through it, not to a line that leaves the shape beside it", () => {
    const shapes = () => [box(40, 40, 140, 60), box(40, 240, 140, 60)];
    const leaving = line([[108, 104], [108, 236]]), arriving = line([[136, 236], [136, 118]]), head = ellipse(130, 106, 14, 10);
    for (const lines of [[leaving, arriving], [arriving, leaving]]) {
      const m = recognize([...shapes(), ...lines, head]);
      const down = m.edges.find((e) => e.from === "A")!, up = m.edges.find((e) => e.from === "B")!;
      assert.deepEqual(links(m).sort(), ["A>B", "B>A"]);
      assert.equal(down.assumed, true, "the line that leaves has no head");
      assert.equal(up.assumed, false, "the line that arrives has the head");
    }
  });

  test("a loop on a shape stays a loop when a line leaves the shape beside it", () => {
    const loop: [number, number][] = [];
    for (let i = 0; i <= 40; i++) loop.push([200 + 20 * Math.cos(Math.PI + (i / 40) * 2 * Math.PI), 70 + 20 * Math.sin(Math.PI + (i / 40) * 2 * Math.PI)]);
    const m = recognize([box(40, 40, 140, 60), box(300, 160, 140, 60), line(loop), line([[186, 94], [300, 190]])]);
    assert.deepEqual(links(m).sort(), ["A>A", "A>B"]);
  });

  test("a small shape drawn touching a box keeps the line that leaves it", () => {
    const m = recognize([box(40, 40, 140, 60), ellipse(200, 70, 20, 20), line([[222, 70], [296, 70]]), box(300, 40, 140, 60)]);
    assert.deepEqual(kinds(m), ["rect", "circle", "rect"]);
    assert.deepEqual(links(m), ["B>C"]);
  });

  test("a small shape inside a group's wall keeps the line that leaves it", () => {
    const m = recognize([box(300, 40, 300, 200), box(420, 100, 140, 60), ellipse(326, 140, 22, 22), line([[302, 140], [184, 140]]), box(40, 110, 140, 60)]);
    assert.equal(m.groups.length, 1);
    assert.deepEqual(kinds(m).sort(), ["circle", "rect", "rect"]);
    const circle = m.nodes.find((n) => n.kind === "circle")!;
    assert.equal(m.edges.length, 1);
    assert.ok([m.edges[0].from, m.edges[0].to].includes(circle.id));
  });

  test("an outline drawn on past its start, along its side or out a little way, is one shape and no line", () => {
    for (const past of [[[80, 40]], [[20, 22]], [[40, 40], [40, 20]]] as [number, number][][]) {
      const m = recognize([line([[40, 40], [180, 40], [180, 100], [40, 100], [40, 42], ...past]), box(300, 40, 140, 60)]);
      assert.equal(m.nodes.length, 2, JSON.stringify(past));
      assert.deepEqual(m.edges, [], JSON.stringify(past));
      assert.deepEqual(m.unused, [], JSON.stringify(past));
    }
  });

  test("an ellipse a third wider than tall is an oval, not a circle", () => {
    assert.deepEqual(kinds(recognize([ellipse(150, 100, 54, 40)])), ["stadium"]);
    assert.deepEqual(kinds(recognize([ellipse(150, 100, 44, 40)])), ["circle"]);
  });
});

describe("state diagrams", () => {
  const asState = (strokes: Stroke[]) => recognize(strokes, { diagram: "state" });
  const roles = (m: Reading) => m.nodes.map((n) => `${n.id}:${n.role}`);
  /** A start dot above a box, a box below it, and an end below that, each joined by an arrow down. */
  const column = (start: Stroke[], end: Stroke[]) => [
    ...start,
    ...arrow([[110, 34], [110, 76]]),
    box(40, 80, 140, 60),
    ...arrow([[110, 144], [110, 216]]),
    box(40, 220, 140, 60),
    ...arrow([[110, 284], [110, 330]]),
    ...end,
  ];

  test("a filled dot is the start and a circle with a dot in it the end, and states are numbered alone", () => {
    const m = asState(column([scribble(110, 20, 8)], [ellipse(110, 352, 17, 17), scribble(110, 352, 6)]));
    assert.equal(m.diagram, "state");
    assert.deepEqual(roles(m), ["dot1:dot", "A:state", "B:state", "dot2:dot"]);
    assert.deepEqual(m.nodes.map((n) => n.label), ["", "State 1", "State 2", ""]);
    assert.deepEqual(links(m), ["dot1>A", "A>B", "B>dot2"]);
    assert.deepEqual(m.unused, []);
    assert.equal(
      toStateMermaid(m),
      'stateDiagram-v2\n  direction TB\n  state "State 1" as A\n  state "State 2" as B\n  [*] --> A\n  A --> B\n  B --> [*]',
    );
  });

  test("a small circle, round or a little oval, is a start, and a circle in a circle an end", () => {
    const oval = asState(column([ellipse(110, 20, 16, 12)], [ellipse(110, 354, 20, 20), ellipse(110, 354, 11, 11)]));
    assert.deepEqual(roles(oval), ["dot1:dot", "A:state", "B:state", "dot2:dot"]);
  });

  test("a small circle is a start, a circle in a circle an end, and a dot drawn in its line's stroke a start", () => {
    const rings = asState(column([ellipse(110, 20, 9, 9)], [ellipse(110, 354, 20, 20), ellipse(110, 354, 11, 11)]));
    assert.deepEqual(roles(rings), ["dot1:dot", "A:state", "B:state", "dot2:dot"]);
    assert.deepEqual(links(rings), ["dot1>A", "A>B", "B>dot2"]);
    const pts = scribble(110, 20, 8).pts.concat(line([[110, 30], [110, 76], [102, 66], [110, 76], [118, 66]]).pts);
    const inline = asState([{ pts }, box(40, 80, 140, 60)]);
    assert.deepEqual(roles(inline), ["dot1:dot", "A:state"]);
    assert.deepEqual(links(inline), ["dot1>A"]);
  });

  test("a diamond is a choice, which Mermaid gives no name", () => {
    const m = asState([box(40, 40, 140, 60), ...arrow([[110, 104], [110, 156]]), diamond(110, 200, 100, 70), ...arrow([[160, 200], [256, 200]]), box(260, 170, 140, 60)]);
    assert.deepEqual(roles(m), ["A:state", "B:choice", "C:state"]);
    assert.deepEqual(m.nodes.map((n) => n.label), ["State 1", "", "State 2"]);
    assert.match(toStateMermaid(m, { labels: { B: "ignored", L2: "yes" } }), /state B <<choice>>\n {2}state "State 2" as C\n {2}A --> B\n {2}B --> C : yes/);
  });

  test("a group is a composite state, with its own transitions inside it, and a start outside it written at the top", () => {
    const m = asState([box(20, 100, 220, 260), box(60, 130, 140, 60), box(60, 260, 140, 60), ...arrow([[130, 194], [130, 256]]), scribble(130, 20, 8), ...arrow([[130, 32], [130, 96]])]);
    assert.deepEqual(links(m), ["A>B", "dot1>G1"]);
    assert.equal(
      toStateMermaid(m, { labels: { G1: "Paying" } }),
      'stateDiagram-v2\n  direction TB\n  state "Paying" as G1 {\n    state "State 1" as A\n    state "State 2" as B\n    A --> B\n  }\n  [*] --> G1',
    );
  });

  test("a start inside a composite starts it, even near its wall, and the composite's way out is written at the top", () => {
    for (const y of [138, 150]) {
      const m = asState([box(20, 120, 220, 300), scribble(130, y, 7), ...arrow([[130, y + 12], [130, 196]]), box(60, 200, 140, 60), ...arrow([[130, 264], [130, 336]]), box(60, 340, 140, 60), ...arrow([[130, 424], [130, 476]]), box(60, 480, 140, 60)]);
      assert.deepEqual(roles(m), ["dot1:dot", "A:state", "B:state", "C:state"], `dot at ${y}`);
      assert.equal(m.nodes[0].parent, "G1");
      assert.match(toStateMermaid(m), /state "Group 1" as G1 \{\n {4}state "State 1" as A\n {4}state "State 2" as B\n {4}\[\*\] --> A\n {4}A --> B\n {2}\}\n {2}G1 --> C/);
    }
  });

  test("a composite around one round state stays a composite, not an end", () => {
    for (const inner of [ellipse(120, 190, 60, 26), box(60, 162, 120, 52)]) {
      const m = asState([box(20, 100, 200, 140), scribble(120, 125, 7), ...arrow([[120, 135], [120, 158]]), inner, box(50, 20, 140, 50), ...arrow([[120, 74], [120, 96]]), ...arrow([[120, 244], [120, 290]]), box(50, 294, 140, 50)]);
      assert.equal(m.groups.length, 1);
      assert.deepEqual(links(m).sort(), ["A>G1", "G1>C", "dot1>B"]);
    }
  });

  test("a start or end inside a composite joined to a state outside it is written as the composite", () => {
    const n = (id: string, role: "state" | "dot", parent: string | null) => ({ id, role, parent, label: role === "state" ? "S" : "", kind: "rect" as const, color: "ink", bb: { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0, cx: 0, cy: 0 }, poly: [], unsure: false, strokes: [] });
    const e = (id: string, from: string, to: string) => ({ id, from, to, both: false, assumed: false, style: "plain" as const, color: "ink", pts: [], strokes: [] });
    const base = { diagram: "state" as const, direction: "TD" as const, unused: [], loops: 0, ms: 0 };
    const out = toStateMermaid({ ...base, nodes: [n("A", "state", "G1"), n("dot1", "dot", "G1"), n("B", "state", null)], groups: [{ ...n("G1", "state", null), label: "Group 1" }], edges: [e("L1", "A", "dot1"), e("L2", "dot1", "B"), e("L3", "dot1", "G1")] });
    assert.match(out, /state "Group 1" as G1 \{\n {4}state "S" as A\n {4}A --> \[\*\]\n {2}\}\n {2}G1 --> B$/);
  });

  test("characters and words that would break a state diagram are written as character codes", () => {
    const m = asState([box(40, 40, 140, 60), ...arrow([[184, 70], [296, 70]]), box(300, 40, 140, 60)]);
    const text = toStateMermaid(m, { labels: { A: "turn direction LR", L1: "pay; ship: on error" } });
    assert.match(text, /state "turn #100;irection LR" as A/);
    assert.match(text, /A --> B : pay#59; ship#58; on error/);
  });

  test("names, colors, and two-way lines in Mermaid's state syntax", () => {
    const m = asState([box(40, 40, 140, 60, "green"), ...arrow([[184, 70], [296, 70]]), line([[196, 60], [184, 70], [196, 80]]), box(300, 40, 140, 60)]);
    const text = toStateMermaid(m, { labels: { A: 'Say "hi" <now>', L1: "go & see" } });
    assert.match(text, /direction LR/);
    assert.match(text, /state "Say #34;hi#34; #60;now#62;" as A/);
    assert.match(text, /A --> B : go #38; see\n {2}B --> A : go #38; see/);
    assert.match(text, /classDef green stroke:#1f7a5a,stroke-width:2px,fill:#dcefe6,color:#161c19\n {2}class A green/);
    assert.equal(toStateMermaid(asState([])), "stateDiagram-v2\n  %% Nothing to read yet: draw a shape, then press Mermaidify.");
  });

  test("a hook at a line's end, a short arrow from a group, a head drawn short, and writing are no dots", () => {
    const loop = asState([box(40, 40, 140, 60), box(40, 220, 140, 60), ...arrow([[110, 104], [110, 216]]), ...arrow([[184, 250], [230, 250], [230, 70], [186, 70]])]);
    assert.deepEqual(roles(loop), ["A:state", "B:state"]);
    assert.deepEqual(links(loop).sort(), ["A>B", "B>A"]);
    // A short arrow from a group's bottom to an end just below it.
    const group = asState([box(20, 20, 220, 200), box(60, 50, 140, 50), box(60, 140, 140, 50), ...arrow([[130, 104], [130, 136]]), ...arrow([[130, 226], [130, 256]]), ellipse(130, 274, 14, 14), scribble(130, 274, 5)]);
    assert.deepEqual(roles(group), ["A:state", "B:state", "dot1:dot"]);
    assert.deepEqual(links(group).sort(), ["A>B", "G1>dot1"]);
    // Heads filled in, or closed, short of the box they point to.
    const filled: [number, number][] = [[110, 196], [98, 180], [122, 180], [110, 196], [101, 184], [119, 184], [110, 196], [104, 188], [116, 188], [110, 192]];
    for (const [name, strokes] of [
      ["filled apart", [line([[110, 104], [110, 180]]), line(filled)]],
      ["closed triangle apart", [line([[110, 104], [110, 176]]), ellipse(110, 186, 9, 10)]],
      ["filled in the line's stroke", [line([[110, 104], [110, 180], ...filled])]],
    ] as const) {
      const m = asState([box(40, 40, 140, 60), box(40, 214, 140, 60), ...strokes]);
      assert.deepEqual(links(m), ["A>B"], name);
      assert.deepEqual(links(recognize([box(40, 40, 140, 60), box(40, 214, 140, 60), ...strokes])), ["A>B"], name + ", as a flowchart");
    }
    const word = asState([box(40, 40, 140, 60), scribble(110, 70, 10)]);
    assert.deepEqual(roles(word), ["A:state"]);
    const small = asState([box(40, 40, 64, 44), scribble(72, 62, 8)]);
    assert.deepEqual(roles(small), ["A:state"]);
    // An "e" inside a small round state, and letters written beside a line, stand for nothing.
    const e = line([[104, 220], [116, 220], [115, 215], [110, 213], [104, 217], [104, 224], [110, 227], [116, 225]]);
    const round = asState([box(40, 40, 140, 60), ...arrow([[110, 104], [110, 186]]), ellipse(110, 220, 32, 30), e]);
    assert.deepEqual(roles(round), ["A:state", "B:state"]);
    const see = asState([box(40, 40, 140, 60), ...arrow([[110, 104], [110, 216]]), box(40, 220, 140, 60), line([[130, 140], [138, 136], [134, 146], [140, 150]]), line([[146, 144], [158, 144], [152, 138], [146, 146], [152, 152], [158, 150]])]);
    assert.deepEqual(roles(see), ["A:state", "B:state"]);
  });

  test("the same strokes read as a flowchart are read as before", () => {
    const strokes = column([scribble(110, 20, 8)], [ellipse(110, 354, 20, 20), ellipse(110, 354, 11, 11)]);
    const m = recognize(strokes);
    assert.equal(m.diagram, "flowchart");
    // The filled dot is no shape, and the inner ring is too small to be one, as ever.
    assert.deepEqual(kinds(m), ["rect", "rect", "circle"]);
    assert.ok(m.nodes.every((n) => n.role === undefined));
  });
});

describe("groups and knots", () => {
  test("a box around an oval and a box is a group, never a circle in a circle", () => {
    const m = recognize([box(20, 40, 220, 200), ellipse(130, 105, 75, 24), box(60, 170, 140, 50), ...arrow([[130, 131], [130, 166]])]);
    assert.equal(m.groups.length, 1);
    assert.deepEqual(kinds(m), ["stadium", "rect"]);
    assert.deepEqual(links(m), ["A>B"]);
  });

  test("a long filled head drawn before its line does not close the stroke into a shape", () => {
    const pts = scribble(110, 20, 11).pts.concat(scribble(110, 20, 11).pts, line([[110, 34], [110, 90], [102, 80], [110, 90], [118, 80]]).pts);
    const m = recognize([{ pts }, box(40, 96, 140, 60)]);
    assert.deepEqual(kinds(m), ["rect"]);
  });
});

describe("drawn on a phone", () => {
  const at = (strokes: Stroke[], k: number, zoom: number) => strokes.map((s) => ({ ...s, pts: s.pts.map(([x, y]): Point => [x * k, y * k]), zoom }));

  test("a drawing made zoomed out or in reads as it does made at 100%, and its outlines stay in drawing units", () => {
    // The arrow stops 30 pixels short of the lower box, inside a box's reach on screen and far outside it at 10%; at
    // 400% the boxes are too small in drawing units to be shapes at all.
    const strokes = [box(80, 40, 120, 60), ...arrow([[140, 104], [141, 196]]), box(80, 226, 120, 60)];
    for (const zoom of [0.1, 0.25, 0.37, 2, 4]) {
      const m = recognize(at(strokes, 1 / zoom, zoom));
      assert.deepEqual(kinds(m), ["rect", "rect"], `${zoom}`);
      assert.deepEqual(links(m), ["A>B"], `${zoom}`);
      assert.ok(Math.abs(m.nodes[0].bb.w - 120 / zoom) < 6 / zoom, `${zoom}: the box is ${m.nodes[0].bb.w} wide in drawing units`);
    }
  });

  test("an arrow drawn in one stroke with long barbs, one out and back and then the other, has its head", () => {
    for (const barbs of [35, 55]) {
      const m = recognize([box(80, 40, 120, 60), ...arrow([[140, 104], [142, 250]], "hook", undefined, barbs), box(70, 256, 140, 70)]);
      assert.deepEqual(links(m), ["A>B"], `${barbs}`);
      assert.equal(m.edges[0].assumed, false, `${barbs}: the head is found`);
      assert.deepEqual(m.unused, [], `${barbs}`);
    }
  });

  test("a line that stops short of the box it points at reaches it, and one that points beside it does not", () => {
    const short = recognize([box(80, 40, 120, 60), ...arrow([[140, 104], [141, 250]], "none"), box(80, 296, 120, 60)]);
    assert.deepEqual(links(short), ["A>B"]);
    const beside = recognize([box(80, 40, 120, 60), ...arrow([[140, 104], [141, 250]], "none"), box(230, 296, 120, 60)]);
    assert.deepEqual(links(beside), []);
  });

  test("a V drawn a little past a line's end is its head, and the line reaches the shape past it", () => {
    const v = line([[110, 250], [140, 286], [170, 250]]);
    const m = recognize([box(80, 40, 120, 60), line([[140, 104], [141, 254]]), v, box(80, 310, 120, 60)]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.edges[0].assumed, false);
    assert.deepEqual(m.edges[0].strokes, [1, 2]);
  });

  test("a short line, a gap, a wide V, and another gap, as a quick arrow on a phone is drawn, is one arrow", () => {
    // Measured from a phone: a 71-pixel line, the V's point 32 past its end and 96 wide, and the box 30 past that.
    const m = recognize([box(80, 40, 120, 60), line([[140, 106], [140, 177]]), line([[92, 170], [140, 209], [188, 170]]), box(80, 239, 120, 60)]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.edges[0].assumed, false);
    assert.deepEqual(m.unused, []);
  });

  test("a stray line that bends near an arrow's end is no head of it", () => {
    for (const head of ["hook", "none"] as const) {
      const m = recognize([box(80, 40, 120, 60), ...arrow([[130, 104], [131, 294]], head), box(80, 300, 120, 60), box(330, 300, 120, 60), line([[146, 104], [190, 200], [330, 190]])]);
      assert.deepEqual(links(m), ["A>B"], head);
      assert.equal(m.edges[0].assumed, head === "none", head);
      assert.equal(m.direction, "TD", head);
    }
  });

  test("a V drawn apart from its line, with barbs too long for a short mark, is its head", () => {
    const m = recognize([box(80, 40, 120, 60), ...arrow([[140, 104], [141, 250]], "v", undefined, 60), box(70, 256, 140, 70)]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.edges[0].assumed, false);
    assert.deepEqual(m.unused, []);
  });

  test("a trapezoid, a hexagon, or an oval drawn a little askew keeps its kind, as only a box is straightened", () => {
    const turn = (pts: Point[], deg: number): Point[] => {
      const a = (deg * Math.PI) / 180, c: Point = [140, 80];
      return pts.map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]);
    };
    for (const deg of [-10, 10]) {
      assert.deepEqual(kinds(recognize([{ pts: turn(trapezoid(60, 50, 160, 60).pts, deg) }])), ["trapezoid"], `trapezoid ${deg}`);
      assert.deepEqual(kinds(recognize([{ pts: turn(hexagon(60, 50, 160, 60).pts, deg) }])), ["hexagon"], `hexagon ${deg}`);
      assert.deepEqual(kinds(recognize([{ pts: turn(ellipse(140, 80, 80, 30).pts, deg) }])), ["stadium"], `oval ${deg}`);
    }
  });

  test("a box drawn askew, or past its start at both ends, is a box", () => {
    const turn = (deg: number): Point[] => {
      const a = (deg * Math.PI) / 180, c: Point = [140, 70];
      return ([[60, 40], [220, 40], [220, 100], [60, 100], [60, 40], [66, 40]] as Point[]).map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]);
    };
    for (const deg of [-14, -9, 9, 14]) assert.deepEqual(kinds(recognize([line(turn(deg))])), ["rect"], `${deg} degrees`);
    // Begun left of the corner, and ended above it, the way a quick box is drawn.
    const past = line([[108, 295], [160, 290], [210, 279], [217, 281], [242, 342], [239, 347], [185, 358], [137, 374], [133, 370], [121, 290], [119, 285]]);
    assert.deepEqual(kinds(recognize([past])), ["rect"]);
  });
});

describe("close together, filled in, curved, and in any order", () => {
  test("a short arrow between shapes close together, its head as big as itself, has its head and is no shape", () => {
    for (const [gap, barbs] of [[30, 14], [30, 24], [36, 30], [46, 28]]) {
      for (const head of ["hook", "v"] as const) {
        const m = recognize([box(80, 40, 120, 60), ...arrow([[140, 102], [141, 100 + gap]], head, undefined, barbs), box(80, 106 + gap, 120, 60)]);
        assert.deepEqual(kinds(m), ["rect", "rect"], `${gap} ${barbs} ${head}`);
        assert.deepEqual(links(m), ["A>B"], `${gap} ${barbs} ${head}`);
        assert.equal(m.edges[0].assumed, false, `${gap} ${barbs} ${head}: the head is found`);
      }
    }
  });

  test("a line from a shape that stops short, with a V drawn a little past its end, is an arrow to the next shape", () => {
    // Drawn on a phone: a 57-unit line, and a V 53 across whose point is 34 past the line's end and 27 short of the box.
    const v = line([[151, 332], [177, 376], [204, 324]]);
    const m = recognize([box(134, 197, 103, 78), line([[181, 284], [181, 342]]), v, box(132, 403, 101, 66)]);
    assert.deepEqual(links(m), ["A>B"]);
    assert.equal(m.edges[0].assumed, false);
    assert.deepEqual(m.unused, []);
  });

  test("a V whose legs stop short of the shape they face is no loop on that shape", () => {
    const m = recognize([box(80, 40, 120, 60), line([[118, 124], [140, 150], [162, 124]])]);
    assert.deepEqual(links(m), []);
  });

  test("in a state diagram, a start filled in with hatching is a start, and a ring around a filled dot is an end", () => {
    for (const outlined of [false, true])
      for (const r of [8, 14, 18]) {
        const m = recognize(
          [hatch(140, 20, r, outlined), ...arrow([[140, 26 + r], [140, 76]]), box(80, 80, 120, 60), ...arrow([[140, 144], [140, 196]]), ellipse(140, 218, 18, 18), hatch(140, 218, 9)],
          { diagram: "state" },
        );
        assert.deepEqual(m.nodes.map((n) => n.role), ["dot", "state", "dot"], `${outlined} ${r}`);
        assert.equal(m.edges.length, 2, `${outlined} ${r}`);
        assert.deepEqual(m.unused, [], `${outlined} ${r}`);
      }
  });

  test("in a flowchart, a small shape filled in is a filled dot and a ring around one a stop, in Mermaid's shapes", () => {
    const m = recognize([hatch(140, 22, 16, true), ...arrow([[140, 44], [140, 76]]), box(80, 80, 120, 60), ...arrow([[140, 144], [140, 196]]), ellipse(140, 218, 18, 18), hatch(140, 218, 8, false, 1.5)]);
    assert.deepEqual(kinds(m), ["dot", "rect", "bullseye"]);
    assert.deepEqual(links(m), ["A>B", "B>C"]);
    assert.match(toMermaid(m), /A@\{ shape: sm-circ/);
    assert.match(toMermaid(m), /C@\{ shape: fr-circ/);
  });

  test("in a flowchart, a letter written in a small circle leaves it a circle, not a ring around a dot", () => {
    for (const r of [18, 24, 30]) {
      const w = r * 0.9, h = r * 0.6, x = 140 - w / 2, y = 120 - h / 2;
      const m = recognize([ellipse(140, 120, r, r), line([[x, y], [x + w / 4, y + h], [x + w / 2, y + h / 3], [x + (3 * w) / 4, y + h], [x + w, y]])]);
      assert.deepEqual(kinds(m), ["circle"], `${r}`);
    }
  });

  test("a curved arrow, an arc or an S, joins the shapes at its ends", () => {
    for (const s of [1, 2])
      for (const sag of [30, 80]) {
        const path: Point[] = [];
        for (let i = 0; i <= 30; i++) path.push([126 + (194 * i) / 30, 30 + sag * Math.sin((s * Math.PI * i) / 30)]);
        for (const head of ["hook", "v"] as const) {
          const m = recognize([box(0, 0, 120, 60), ...arrow(path, head), box(326, 0, 120, 60)]);
          assert.deepEqual(links(m), ["A>B"], `${s} ${sag} ${head}`);
          assert.equal(m.edges[0].assumed, false, `${s} ${sag} ${head}`);
        }
      }
  });

  test("the order the strokes were drawn in does not change the reading, save the way a line with no head points", () => {
    // Dashes are one line in the order they were drawn, so a dashed line with no head points the other way when its
    // dashes are drawn from its other end.
    const sig = (m: Reading) =>
      kinds(m).join() + " " + m.edges.map((e) => (e.assumed ? [e.from, e.to].sort().join("-") : `${e.from}>${e.to}`)).sort().join() + " " + m.unused.length;
    const drawings = [exampleStrokes(390), ...generate(7, 3).map((c) => c.strokes)];
    for (const strokes of drawings) {
      const drawn = sig(recognize(strokes));
      let k = 5;
      const shuffle = () => (k = (k * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5;
      for (const order of [strokes.slice().reverse(), strokes.slice().sort(shuffle), strokes.slice().sort(shuffle)]) assert.equal(sig(recognize(order)), drawn);
    }
  });
});

describe("speed", () => {
  test("many long strokes that are no shapes, and long outlines, read in well under a second", () => {
    let seed = 9;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const vees = Array.from({ length: 1000 }, (_, k): Stroke => {
      const x = (k % 30) * 40, y = Math.floor(k / 30) * 40, pts: Point[] = [];
      for (let i = 0; i < 150; i++) pts.push([x + (i < 75 ? i : 150 - i) * 0.3 + rnd(), y + i * 0.2]);
      return { pts };
    });
    let t = performance.now();
    recognize(vees);
    assert.ok(performance.now() - t < 2500, `1,000 strokes of 150 points took ${Math.round(performance.now() - t)} ms`);
    const outlines = Array.from({ length: 15 }, (_, k): Stroke => {
      const pts: Point[] = [];
      for (let i = 0; i <= 10_000; i++) {
        const u = (i / 10_000) * 4, side = Math.floor(u) % 4, f = u - Math.floor(u), x0 = (k % 5) * 700, y0 = Math.floor(k / 5) * 500;
        pts.push(side === 0 ? [x0 + 600 * f, y0] : side === 1 ? [x0 + 600, y0 + 400 * f] : side === 2 ? [x0 + 600 * (1 - f), y0 + 400] : [x0, y0 + 400 * (1 - f)]);
      }
      return { pts };
    });
    t = performance.now();
    assert.equal(recognize(outlines).nodes.length, 15);
    assert.ok(performance.now() - t < 1000, `15 outlines of 10,000 points took ${Math.round(performance.now() - t)} ms`);
  });
});

describe("the example", () => {
  test("reads as an oval, a box, a diamond that loops back, and a double circle, in color", () => {
    const m = recognize(exampleStrokes(360));
    assert.deepEqual(kinds(m), ["stadium", "rect", "diamond", "double"]);
    assert.deepEqual(links(m), ["A>B", "B>C", "C>D", "C>B"]);
    assert.equal(m.loops, 1);
    assert.equal(
      toMermaid(m),
      [
        "flowchart TD",
        '  A(["Node 1"])',
        '  B["Node 2"]',
        '  C{"Node 3"}',
        '  D((("Node 4")))',
        "  A --> B",
        "  B --> C",
        "  C --> D",
        "  C --> B",
        "  classDef amber stroke:#b26b00,stroke-width:2px,fill:#fbeed8,color:#161c19",
        "  class C amber",
        "  classDef red stroke:#c0392b,stroke-width:2px,fill:#fbe4e1,color:#161c19",
        "  class D red",
        "  linkStyle 3 stroke:#1f7a5a,stroke-width:2px",
      ].join("\n"),
    );
  });

  test("reads the same at any width", () => {
    for (const w of [320, 412, 768, 1280]) assert.deepEqual(links(recognize(exampleStrokes(w))), ["A>B", "B>C", "C>D", "C>B"], String(w));
  });
});

describe("Mermaid text", () => {
  test("a line's style and name write Mermaid's arrows, and a blank name writes none", () => {
    const m = recognize([box(40, 40, 140, 60), box(40, 220, 140, 60), box(300, 220, 140, 60), ...dashed([[110, 104], [110, 216]]), ...arrow([[184, 250], [296, 250]]), line([[186, 253], [294, 253]])]);
    assert.deepEqual(m.edges.map((e) => e.id), ["L1", "L2"]);
    assert.match(toMermaid(m), /A -\.-> B\n {2}B ==> C/);
    assert.match(toMermaid(m, { labels: { L1: 'say "no"', L2: "  " } }), /A -\.->\|"say #34;no#34;"\| B\n {2}B ==> C/);
    m.edges[0].both = true;
    m.edges[1].both = true;
    m.edges[1].color = "blue";
    const both = toMermaid(m, { labels: { L2: "x" } });
    assert.match(both, /A <-\.-> B\n {2}B <==>\|"x"\| C/);
    assert.match(both, /linkStyle 1 stroke:#2563eb,stroke-width:3\.5px/);
  });

  test("names typed by a person replace the defaults, and blank names keep them", () => {
    const m = recognize(exampleStrokes(360));
    const text = toMermaid(m, { labels: { A: "Begin", B: "  ", C: 'Ready? "yes" <or> no & #1' } });
    assert.match(text, /A\(\["Begin"\]\)/);
    assert.match(text, /B\["Node 2"\]/);
    assert.match(text, /C\{"Ready\? #34;yes#34; #60;or#62; no #38; #35;1"\}/);
  });

  test("character codes cover every character that would break a quoted label", () => {
    assert.equal(escapeLabel('a"b'), "a#34;b");
    assert.equal(escapeLabel("<&#>"), "#60;#38;#35;#62;");
    assert.equal(escapeLabel("two\nlines\ttab"), "two lines tab");
  });

  test("an empty drawing says what to do", () => {
    assert.match(toMermaid(recognize([])), /^flowchart TD\n {2}%% Nothing to read yet/);
  });

  test("a colored group gets a style line", () => {
    const m = recognize([box(20, 20, 300, 160, "blue"), box(60, 60, 120, 50)]);
    assert.match(toMermaid(m), /style G1 stroke:#2563eb,stroke-width:2px/);
  });

  test("every shape kind writes Mermaid's brackets", () => {
    const m = recognize([
      box(20, 20, 140, 60),
      diamond(300, 50, 140, 90),
      hexagon(20, 160, 150, 60),
      trapezoid(220, 160, 150, 60),
      ellipse(90, 330, 34, 34),
      ellipse(300, 330, 70, 26),
    ]);
    const text = toMermaid(m);
    for (const re of [/\["Node \d"\]/, /\{"Node \d"\}/, /\{\{"Node \d"\}\}/, /\[\/"Node \d"\\\]/, /\(\("Node \d"\)\)/, /\(\["Node \d"\]\)/]) assert.match(text, re);
    const more = toMermaid(recognize([invTrapezoid(20, 20, 150, 60), parallelogram(220, 20, 150, 60), parallelogram(20, 160, 150, 60, true), triangle(220, 150, 110, 80), triangle(20, 290, 110, 80, true)]));
    for (const re of [/\[\\"Node \d"\/\]/, /\[\/"Node \d"\/\]/, /\[\\"Node \d"\\\]/, /@\{ shape: tri, label: "Node \d" \}/, /@\{ shape: flip-tri, label: "Node \d" \}/]) assert.match(more, re);
  });

  test("control characters in a name become spaces, which Mermaid's syntax for a triangle would refuse", () => {
    assert.equal(escapeLabel("a\x0bb\x0cc\x00d\x7fe"), "a b c d e");
  });

  test("a name in a shape written with @{ } codes its backslashes, which would end the name early", () => {
    assert.equal(nodeText("A", "triangle", "C:\\temp\\"), 'A@{ shape: tri, label: "C:#92;temp#92;" }');
    assert.equal(nodeText("A", "rect", "C:\\temp\\"), 'A["C:\\temp\\"]');
  });

  test("a shape's kind gives it no name: every shape is a node, numbered in reading order", () => {
    const m = recognize([box(20, 20, 140, 60), diamond(300, 50, 140, 90), hexagon(20, 160, 150, 60), ellipse(300, 190, 34, 34)]);
    assert.deepEqual(
      m.nodes.map((n) => n.label),
      ["Node 1", "Node 2", "Node 3", "Node 4"],
    );
  });
});
