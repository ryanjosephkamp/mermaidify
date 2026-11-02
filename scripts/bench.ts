/**
 * Scores the reader on generated flowcharts and state diagrams and prints the result.
 *
 *   node scripts/bench.ts [--cases 1000] [--seed 1] [--amp 4] [--floor] [--json]
 *
 * It scores the flowcharts twice: as generated, with about half their lines drawn as dashes or gone over twice, and
 * with every line plain. Then it scores as many state diagrams, read as state diagrams. With --floor it fails when a
 * score falls below the floors below, which CI holds the reader to. Generated drawings are tidier than a person's, so
 * this is a floor for regressions, not a measure of real use.
 */
import { recognize } from "../src/reader/recognize.ts";
import { generateStates, scoreStates, type StateScore } from "../test/gen-state.ts";
import { generate, score, type Score } from "../test/gen.ts";

export const FLOOR = { shapes: 0.994, arrows: 0.993, styled: 0.985, plain: 0.995, whole: 0.965 };
/** The same drawings with every line plain. */
export const PLAIN_FLOOR = { shapes: 0.994, arrows: 0.995, whole: 0.975 };
/** The state diagrams. */
export const STATE_FLOOR = { dots: 0.995, states: 0.995, choices: 0.99, composites: 0.98, transitions: 0.995, whole: 0.99 };

/** The figures a score is held to: each as a share. */
export const rates = (s: Score) => ({
  shapes: s.shapesRight / s.shapes,
  arrows: s.arrowsRight / s.arrows,
  styled: s.styledRight / Math.max(1, s.styled),
  plain: s.plainRight / Math.max(1, s.plain),
  whole: s.perfect / s.cases,
});
export const stateRates = (s: StateScore) => ({
  dots: s.dotsRight / s.dots,
  states: s.statesRight / s.states,
  choices: s.choicesRight / Math.max(1, s.choices),
  composites: s.compositesRight / Math.max(1, s.composites),
  transitions: s.transitionsRight / s.transitions,
  whole: s.perfect / s.cases,
});

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string, fallback: number) => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
  const cases = opt("cases", 1000), seed = opt("seed", 1), amp = opt("amp", 4);

  const s = score(generate(seed, cases, { ampMax: amp }), recognize);
  const p = score(generate(seed, cases, { ampMax: amp, styles: false }), recognize);
  const st = scoreStates(generateStates(seed, cases, { ampMax: amp }), (strokes) => recognize(strokes, { diagram: "state" }));
  const r = rates(s), rp = rates(p), rs = stateRates(st);
  const pct = (x: number) => (100 * x).toFixed(x < 1 && (100 * x).toFixed(1) === "100.0" ? 2 : 1) + "%";

  if (args.includes("--json")) console.log(JSON.stringify({ seed, amp, ...s, plainOnly: p, states: st }, null, 2));
  else {
    console.log(`${cases} generated flowcharts (seed ${seed}, wobble up to ${amp})`);
    console.log(`  shapes  ${s.shapesRight} of ${s.shapes} (${pct(r.shapes)})`);
    console.log(`  arrows  ${s.arrowsRight} of ${s.arrows} (${pct(r.arrows)}), ${s.arrowsExtra} extra`);
    console.log(`  dotted and thick lines read with their style: ${s.styledRight} of ${s.styled} (${pct(r.styled)})`);
    console.log(`  plain lines read as plain: ${s.plainRight} of ${s.plain} (${pct(r.plain)})`);
    console.log(`  whole drawings read right: ${s.perfect} of ${cases} (${pct(r.whole)})`);
    console.log(`  time    median ${s.msMedian.toFixed(2)} ms, slowest ${s.msMax.toFixed(2)} ms`);
    if (Object.keys(s.wrong).length) console.log("  read wrong:", s.wrong);
    if (Object.keys(s.missed).length) console.log("  arrows missed, by head:", s.missed);
    console.log(`The same drawings with every line plain`);
    console.log(`  shapes ${pct(rp.shapes)}, arrows ${p.arrowsRight} of ${p.arrows} (${pct(rp.arrows)}), whole drawings ${p.perfect} (${pct(rp.whole)})`);
    console.log(`${cases} generated state diagrams`);
    console.log(`  starts and ends  ${st.dotsRight} of ${st.dots} (${pct(rs.dots)})`);
    console.log(`  states           ${st.statesRight} of ${st.states} (${pct(rs.states)})`);
    console.log(`  choices          ${st.choicesRight} of ${st.choices} (${pct(rs.choices)})`);
    console.log(`  composite states ${st.compositesRight} of ${st.composites} (${pct(rs.composites)})`);
    console.log(`  transitions      ${st.transitionsRight} of ${st.transitions} (${pct(rs.transitions)}), ${st.extra} extra`);
    console.log(`  whole diagrams   ${st.perfect} of ${cases} (${pct(rs.whole)}), median ${st.msMedian.toFixed(2)} ms`);
  }
  if (args.includes("--floor")) {
    const low = [
      ...(Object.keys(FLOOR) as (keyof typeof FLOOR)[]).filter((k) => r[k] < FLOOR[k]).map((k) => `${k} ${pct(r[k])} < ${pct(FLOOR[k])}`),
      ...(Object.keys(PLAIN_FLOOR) as (keyof typeof PLAIN_FLOOR)[]).filter((k) => rp[k] < PLAIN_FLOOR[k]).map((k) => `all plain: ${k} ${pct(rp[k])} < ${pct(PLAIN_FLOOR[k])}`),
      ...(Object.keys(STATE_FLOOR) as (keyof typeof STATE_FLOOR)[]).filter((k) => rs[k] < STATE_FLOOR[k]).map((k) => `state diagrams: ${k} ${pct(rs[k])} < ${pct(STATE_FLOOR[k])}`),
    ];
    if (low.length) {
      console.error("Below the floor: " + low.join(", "));
      process.exit(1);
    }
  }
}
