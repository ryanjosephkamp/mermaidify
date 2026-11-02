import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ADDABLE, TEMPLATES, shapeParts, type Part } from "../src/app/templates.ts";
import { bbox } from "../src/reader/geometry.ts";
import { recognize, type Reading } from "../src/reader/recognize.ts";

/** A template read as drawn, or shrunk as far as the Add menu ever shrinks one to fit a small screen. */
const read = (parts: Part[], k: number, diagram: Reading["diagram"]) =>
  recognize(parts.map((p) => ({ pts: p.pts.map(([x, y]): [number, number] => [x * k, y * k]) })), { diagram });

/** Each shape's and line's name, found as the app finds it: the first named stroke it was drawn with. */
function names(m: Reading, parts: Part[]) {
  const of = (strokes: number[], line: boolean) => strokes.map((i) => parts[i]).find((p) => p.name && !!p.line === line)?.name;
  const node = new Map(m.nodes.map((n) => [n.id, of(n.strokes, false) ?? "*"]));
  return { node, edge: new Map(m.edges.map((e) => [e.id, of(e.strokes, true)])) };
}

describe("shapes and templates to add", () => {
  test("each shape the Add menu offers reads as its kind, in a flowchart and in a state diagram", () => {
    for (const a of ADDABLE)
      for (const diagram of ["flowchart", "state"] as const) {
        const m = recognize(shapeParts(a.kind, 200, 200, a.w, a.h).map((p) => ({ pts: p.pts })), { diagram });
        assert.deepEqual(m.nodes.map((n) => n.kind), [a.kind], `${a.kind} in a ${diagram}`);
        assert.deepEqual(m.unused, [], `${a.kind} in a ${diagram}`);
      }
  });

  test("each template reads whole: every shape, every arrow with its head, and nothing left out", () => {
    const want: Record<string, [nodes: number, edges: number]> = {
      steps: [4, 3], decision: [4, 3], loop: [4, 4], "sign-in": [6, 6], retry: [5, 5],
      door: [4, 5], light: [4, 4], order: [6, 6], player: [5, 7], vending: [4, 5],
      "grind-loop": [3, 3], "ralph-loop": [4, 5], "red-team-loop": [3, 3], "review-gate": [4, 5], "spec-then-loop": [5, 5],
      "human-gated-irreversible": [3, 2], "debate-then-build": [7, 8], "tournament-then-judge": [7, 6],
    };
    assert.deepEqual(TEMPLATES.map((t) => t.id).sort(), Object.keys(want).sort());
    // Drawn as they are, and shrunk to fit a small screen, as far as the Add menu ever shrinks them.
    for (const t of TEMPLATES)
      for (const k of [1, 0.6]) {
        const m = read(t.parts(), k, t.diagram);
        assert.equal(m.nodes.length, want[t.id][0], `${t.id} at ${k}: shapes`);
        assert.equal(m.edges.length, want[t.id][1], `${t.id} at ${k}: arrows`);
        assert.ok(m.edges.every((e) => !e.assumed && !e.both), `${t.id} at ${k}: every arrow has one head`);
        assert.deepEqual(m.unused, [], `${t.id} at ${k}: nothing left out`);
        // Mermaid lays it out the way it is drawn: down or across, never up or back.
        assert.ok(m.direction === "TD" || m.direction === "LR", `${t.id} at ${k}: read ${m.direction}`);
      }
  });

  test("each template's arrows join the shapes they were drawn between, and carry their names", () => {
    // Each arrow as "from>to" or "from>to:name", by the names of its shapes; a start or an end is "*".
    const want: Record<string, string[]> = {
      steps: ["Start>First step", "First step>Second step", "Second step>Done"],
      decision: ["Start>Ready?", "Ready?>Go ahead:Yes", "Ready?>Wait:No"],
      loop: ["Start>Try", "Try>Done?", "Done?>Finish:Yes", "Done?>Try:No"],
      "sign-in": [
        "Start>Enter password", "Enter password>Correct?", "Correct?>Signed in:Yes", "Correct?>Tries left?:No",
        "Tries left?>Enter password:Yes", "Tries left?>Locked out:No",
      ],
      retry: ["Start>Send request", "Send request>Worked?", "Worked?>Done:Yes", "Worked?>Wait:No", "Wait>Send request"],
      door: ["*>Closed", "Closed>Open:open", "Open>Closed:close", "Closed>Locked:lock", "Locked>Closed:unlock"],
      light: ["*>Red", "Red>Green:go", "Green>Yellow:slow", "Yellow>Red:stop"],
      order: ["*>Placed", "Placed>Paid:pay", "Paid>Shipped:ship", "Shipped>*", "Placed>Canceled:cancel", "Canceled>*"],
      player: [
        "*>Stopped", "Stopped>Playing:play", "Playing>Stopped:stop", "Playing>Paused:pause", "Paused>Playing:play",
        "Paused>Stopped:stop", "Stopped>*:close",
      ],
      vending: ["*>Idle", "Idle>Paid:coin", "Paid>Idle:refund", "Paid>Vending:choose", "Vending>Idle:done"],
      // The agent workflows, edge for edge as grooph's patterns have them, each condition as grooph writes it.
      "grind-loop": ["Builder>Tests", "Tests>Builder:fail", "Tests>Done:pass"],
      "ralph-loop": ["Builder>Tests", "Tests>Builder:fail", "Tests>Plan empty?:pass", "Plan empty?>Builder:fail", "Plan empty?>Done:pass"],
      "red-team-loop": ["Builder>Red team", "Red team>Builder:fail", "Red team>Done:pass"],
      "review-gate": ["Builder>Critic", "Critic>Builder:fail", "Critic>Merge approval:pass", "Merge approval>Done:pass", "Merge approval>Builder:fail"],
      "spec-then-loop": ["Planner>Spec approval", "Spec approval>Builder:pass", "Builder>Critic", "Critic>Builder:fail", "Critic>Done:pass"],
      "human-gated-irreversible": ["Step approval>Irreversible step:pass", "Irreversible step>Done"],
      "debate-then-build": [
        "Planner A>Planner B", "Planner B>Judge", "Judge>Planner A:verdict: rebut", "Judge>Plan approval:pass",
        "Plan approval>Builder:pass", "Builder>Tests", "Tests>Builder:fail", "Tests>Done:pass",
      ],
      "tournament-then-judge": [
        "Candidate A>Finalist filter", "Candidate B>Finalist filter", "Candidate C>Finalist filter", "Finalist filter>Judge:pass",
        "Judge>Finisher:pass", "Finisher>Done",
      ],
    };
    for (const t of TEMPLATES)
      for (const k of [1, 0.6]) {
        const parts = t.parts(), m = read(parts, k, t.diagram), { node, edge } = names(m, parts);
        const arrows = m.edges.map((e) => `${node.get(e.from)}>${node.get(e.to)}${edge.get(e.id) ? ":" + edge.get(e.id) : ""}`);
        assert.deepEqual(arrows.sort(), [...want[t.id]].sort(), `${t.id} at ${k}`);
        // Every name drawn comes through, once, on the shape or line it was drawn for.
        const drawn = (line: boolean) => parts.filter((p) => p.name && !!p.line === line).map((p) => p.name).sort();
        assert.deepEqual([...node.values()].filter((n) => n !== "*").sort(), drawn(false), `${t.id} at ${k}: shape names`);
        assert.deepEqual([...edge.values()].filter(Boolean).sort(), drawn(true), `${t.id} at ${k}: line names`);
      }
  });

  test("templates come in their menu groups, in order, and each fits the space the Add menu allows", () => {
    const groups = ["Flowcharts", "State diagrams", "Agent workflows"];
    const order = TEMPLATES.map((t) => groups.indexOf(t.group));
    assert.ok(order.every((g) => g >= 0), "every group is a menu heading");
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "grouped, in the menu's order");
    for (const t of TEMPLATES) {
      assert.equal(t.diagram === "state", t.group === "State diagrams", `${t.id}: its group matches its diagram`);
      // Fitted to 90% of the screen and never shrunk below 0.6, a template this size fits a phone 375 pixels wide.
      const b = bbox(t.parts().flatMap((p) => p.pts));
      assert.ok(b.w <= 560 && b.h <= 760, `${t.id}: ${Math.round(b.w)} by ${Math.round(b.h)}`);
    }
  });
});
