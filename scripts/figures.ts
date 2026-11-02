/**
 * The reader's figures for the docs' How well it reads, measured when the site is built: the same generated drawings
 * and floor as scripts/bench.ts, so the page always prints what this build of the reader scores.
 */
import { recognize } from "../src/reader/recognize.ts";
import { generateStates, scoreStates } from "../test/gen-state.ts";
import { generate, score } from "../test/gen.ts";
import { FLOOR as BENCH_FLOOR, PLAIN_FLOOR, STATE_FLOOR } from "./bench.ts";
import { FLOOR, load, measure } from "./measure.ts";

const fmt = (n: number) => n.toLocaleString("en-US");
/** A share as the page prints it, to a tenth of a point, or to a hundredth where a tenth would round up to all. */
const pct = (x: number) => (100 * x).toFixed(x < 1 && (100 * x).toFixed(1) === "100.0" ? 2 : 1) + "%";
/** A floor as the page prints it: 0.94 is "94%", 0.994 is "99.4%". */
const floor = (x: number) => +(100 * x).toFixed(1) + "%";

export function benchFigures(): Record<string, string> {
  const cases = 1000, s = score(generate(1, cases, { ampMax: 4 }), recognize), p = score(generate(1, cases, { ampMax: 4, styles: false }), recognize);
  const st = scoreStates(generateStates(1, cases, { ampMax: 4 }), (strokes) => recognize(strokes, { diagram: "state" }));
  const of = (a: number, b: number) => `${fmt(a)} of ${fmt(b)} (${pct(a / b)})`;
  return {
    "state-dots": of(st.dotsRight, st.dots),
    "state-states": of(st.statesRight, st.states),
    "state-choices": of(st.choicesRight, st.choices),
    "state-composites": of(st.compositesRight, st.composites),
    "state-transitions": of(st.transitionsRight, st.transitions),
    "state-whole": of(st.perfect, cases),
    "state-floor-dots": floor(STATE_FLOOR.dots),
    "state-floor-states": floor(STATE_FLOOR.states),
    "state-floor-choices": floor(STATE_FLOOR.choices),
    "state-floor-composites": floor(STATE_FLOOR.composites),
    "state-floor-transitions": floor(STATE_FLOOR.transitions),
    "state-floor-whole": floor(STATE_FLOOR.whole),
    cases: fmt(cases),
    shapes: `${fmt(s.shapesRight)} of ${fmt(s.shapes)} (${pct(s.shapesRight / s.shapes)})`,
    arrows: `${fmt(s.arrowsRight)} of ${fmt(s.arrows)} (${pct(s.arrowsRight / s.arrows)})`,
    styled: `${fmt(s.styledRight)} of ${fmt(s.styled)} (${pct(s.styledRight / s.styled)})`,
    plain: `${fmt(s.plainRight)} of ${fmt(s.plain)} (${pct(s.plainRight / s.plain)})`,
    "plain-arrows": pct(p.arrowsRight / p.arrows),
    "plain-whole": pct(p.perfect / cases),
    whole: `${fmt(s.perfect)} of ${fmt(cases)} (${pct(s.perfect / cases)})`,
    median: s.msMedian.toFixed(1) + " ms",
    "floor-shapes": floor(BENCH_FLOOR.shapes),
    "floor-arrows": floor(BENCH_FLOOR.arrows),
    "floor-styled": floor(BENCH_FLOOR.styled),
    "floor-plain": floor(BENCH_FLOOR.plain),
    "plain-floor-arrows": floor(PLAIN_FLOOR.arrows),
    "plain-floor-whole": floor(PLAIN_FLOOR.whole),
    "floor-whole": floor(BENCH_FLOOR.whole),
  };
}

/** The same figures on 300 drawings people made, as scripts/measure.ts scores them. */
export function measuredFigures(): Record<string, string> {
  const cases = load(new URL("../test/didi/test.json.gz", import.meta.url).pathname), s = measure(cases);
  const of = (a: number, b: number) => `${fmt(a)} of ${fmt(b)} (${pct(a / b)})`;
  // How far chance alone could move the whole-drawing figure on another slice this size: half a 95% interval.
  const p = s.whole / s.drawings, margin = 196 * Math.sqrt((p * (1 - p)) / s.drawings);
  return {
    "didi-drawings": fmt(s.drawings),
    "didi-charts": fmt(new Set(cases.map((c) => c.label)).size),
    "didi-margin": margin.toFixed(1),
    "didi-found": of(s.found, s.shapes),
    "didi-looks": of(s.looksRight, s.looks),
    "didi-arrows": of(s.arrowsRight, s.arrows),
    "didi-plain": of(s.plainRight, s.arrowsRight),
    "didi-whole": of(s.whole, s.drawings),
    "didi-floor-found": floor(FLOOR.found),
    "didi-floor-looks": floor(FLOOR.looks),
    "didi-floor-arrows": floor(FLOOR.arrows),
    "didi-floor-plain": floor(FLOOR.plain),
    "didi-floor-whole": floor(FLOOR.whole),
  };
}
