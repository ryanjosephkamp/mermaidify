/**
 * Records docs/demo.gif for the README: the example sketch drawn stroke by stroke, Mermaidify pressed, and a shape
 * named by tapping it. Frames are taken one at a time, so the result is the same on every run; ffmpeg joins them, each
 * shown for its own time.
 *
 *   npx vite preview --port 4372 &   (after npm run build)
 *   node scripts/demo-gif.ts [http://localhost:4372/] [docs/demo.gif]
 *
 * It needs Playwright's Chromium and ffmpeg.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { chromium } from "@playwright/test";

import { exampleStrokes } from "../src/example.ts";

const [url = "http://localhost:4372/", out = "docs/demo.gif"] = process.argv.slice(2);
const W = 1040, H = 640;
const dir = mkdtempSync(join(tmpdir(), "mermaidify-gif-"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(600);

const frames: { file: string; seconds: number }[] = [];
const shot = async (seconds: number) => {
  const file = join(dir, `f${String(frames.length).padStart(4, "0")}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, seconds });
};
const pointer = (type: string, x: number, y: number, buttons: number) =>
  page.evaluate(
    ({ type, x, y, buttons }) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: r.left + x, clientY: r.top + y, buttons, button: type === "pointermove" ? -1 : 0, bubbles: true, cancelable: true }));
    },
    { type, x, y, buttons },
  );

await shot(1.0);
const width = await page.evaluate(() => document.getElementById("pad")!.getBoundingClientRect().width);
// The example drawn at about two thirds of the drawing's width, as a person would center it.
for (const s of exampleStrokes(Math.min(width, 520))) {
  await page.locator(`label[for="ink-${s.color ?? "ink"}"]`).click();
  const pts = s.pts, chunk = Math.max(6, Math.ceil(pts.length / 5));
  await pointer("pointerdown", pts[0][0], pts[0][1], 1);
  for (let i = 1; i < pts.length; i++) {
    await pointer("pointermove", pts[i][0], pts[i][1], 1);
    if (i % chunk === 0) {
      await page.waitForTimeout(20);
      await shot(0.05);
    }
  }
  await pointer("pointerup", pts[pts.length - 1][0], pts[pts.length - 1][1], 0);
  await page.waitForTimeout(20);
  await shot(0.12);
}
await page.locator(`label[for="ink-ink"]`).click();
await shot(0.5);
await page.locator("#go").click();
await page.locator("#diagram svg").waitFor();
await page.waitForTimeout(400);
await shot(2.2);

// Tap the box and name it.
const cx = Math.round(Math.min(width, 520) / 2);
await pointer("pointerdown", cx, 129, 1);
await pointer("pointerup", cx, 129, 0);
await page.waitForTimeout(100);
await shot(0.5);
const name = "Write the draft";
for (let i = 0; i < name.length; i += 2) {
  await page.keyboard.type(name.slice(i, i + 2));
  await shot(0.07);
}
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await shot(3.0);
await browser.close();

const list = join(dir, "list.txt");
writeFileSync(list, ["ffconcat version 1.0", ...frames.flatMap((f) => [`file '${f.file}'`, `duration ${f.seconds}`]), `file '${frames[frames.length - 1].file}'`].join("\n") + "\n");
mkdirSync(dirname(out), { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", "-fps_mode", "vfr", "-loop", "0", out]);
rmSync(dir, { recursive: true });
console.log(`wrote ${out}: ${frames.length} frames, ${Math.round(statSync(out).size / 1024)} KB`);
