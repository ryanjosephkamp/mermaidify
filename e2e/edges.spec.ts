/** The edges of the Draw page: names, hand-edited code, pens and palms, big files, and saving details. */
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { along, box, circle, code, drawBoxToDiamond, fresh, mermaidify, stroke } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

/** The drawing as this browser keeps it, once the page has saved it. */
async function kept(page: Page) {
  await page.waitForTimeout(700);
  return page.evaluate(() => JSON.parse(localStorage.getItem("mermaidify.drawing.v1") || "null"));
}
const tap = (page: Page, x: number, y: number) => stroke(page, [[x, y], [x, y]], "pen");

test("a name typed on the drawing is kept when the next tap or stroke comes before Enter", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await tap(page, 140, 70);
  await page.locator("#name-input").fill("Login");
  // Straight on to the diamond, with no Enter.
  await tap(page, 140, 220);
  await expect(page.locator("#name-input")).toBeFocused();
  await page.locator("#name-input").fill("Paid?");
  // And then a new stroke, again with no Enter.
  await stroke(page, box(260, 300, 60, 40), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Login"\]/);
  await expect(code(page)).toHaveValue(/B\{"Paid\?"\}/);
});

test("code edited by hand is never replaced without Rebuild", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  const mine = "flowchart LR\n  X[Mine] --> Y[Also mine]";
  await code(page).fill(mine);
  await stroke(page, box(260, 300, 60, 40), "pen");
  // A tap on a shape, Mermaidify, Ctrl+Enter in the code box, and Save the drawing all keep it.
  await tap(page, 140, 70);
  await expect(code(page)).toHaveValue(mine);
  await page.locator("#go").click();
  await expect(code(page)).toHaveValue(mine);
  await expect(page.locator("#read")).toContainText("Your own code is kept");
  await code(page).press("Control+Enter");
  await expect(code(page)).toHaveValue(mine);
  await page.locator("#more").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Save the drawing (.json)" }).click()]);
  const json = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(json.mermaid).toBe(mine);
  expect(json.edited).toBe(true);
  await page.locator("#rebuild").click();
  await expect(code(page)).toHaveValue(/A\["Node 1"\]/);
  await expect(page.locator("#name-A")).toBeEnabled();
});

test("a palm that lands before the pen moves nothing, in pen mode and before it", async ({ page }) => {
  // Before any pen: a palm starts a stroke, and the pen's stroke replaces it.
  await page.evaluate(() => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: r.left + 30, clientY: r.top + 300, buttons: 1, bubbles: true }));
    c.dispatchEvent(new PointerEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: r.left + 50, clientY: r.top + 320, buttons: 1, bubbles: true }));
  });
  await stroke(page, along([[60, 200], [260, 200]]), "pen");
  let drawing = await kept(page);
  expect(drawing.strokes).toHaveLength(1);
  expect(drawing.strokes[0].by).toBe("pen");

  // In pen mode: a palm resting down, then the pen draws a straight line while the palm drifts.
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 12, pointerType: "touch", clientX: r.left + 200, clientY: r.top + 380, buttons: 1, bubbles: true }));
  });
  await page.evaluate(() => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    const pen = (type: string, x: number, b: number) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "pen", clientX: r.left + x, clientY: r.top + 260, buttons: b, bubbles: true }));
    const palm = (dy: number) => c.dispatchEvent(new PointerEvent("pointermove", { pointerId: 12, pointerType: "touch", clientX: r.left + 200, clientY: r.top + 380 - dy, buttons: 1, bubbles: true }));
    pen("pointerdown", 60, 1);
    for (let x = 63; x <= 260; x += 3) {
      pen("pointermove", x, 1);
      palm((x - 60) / 2);
    }
    pen("pointerup", 260, 0);
  });
  drawing = await kept(page);
  const ys = drawing.strokes[1].pts.map((p: number[]) => p[1]);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
});

test("names follow shapes, not places: a group takes no name from a shape erased inside it", async ({ page }) => {
  await stroke(page, box(20, 20, 300, 200), "pen");
  await stroke(page, box(60, 60, 120, 50), "pen");
  await stroke(page, box(60, 150, 120, 50), "pen");
  await mermaidify(page);
  await page.locator("#name-A").fill("Login");
  await page.locator('[data-tool="erase"]').click();
  await stroke(page, along([[55, 80], [65, 90]]), "pen");
  await page.locator('[data-tool="draw"]').click();
  await mermaidify(page);
  await expect(code(page)).not.toHaveValue(/Login/);
});

test("a box drawn inside a named box leaves the name on the outer one", async ({ page }) => {
  await stroke(page, box(20, 20, 300, 200), "pen");
  await mermaidify(page);
  await page.locator("#name-A").fill("Payments");
  await stroke(page, box(80, 80, 120, 50), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/subgraph G1 \["Payments"\]\n {4}A\["Node 1"\]/);
});

test("the example starts fresh, and Clear then Undo brings the names back", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#name-A").fill("Login");
  await page.locator("#clear").click();
  await page.locator("#undo").click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Login"\]/);
  await page.locator("#more").click();
  await page.getByRole("menuitem", { name: "Load the example" }).click();
  await expect(code(page)).not.toHaveValue(/Login/);
  await expect(code(page)).toHaveValue(/B\["Node 2"\]/);
});

test("a drawing too large to read quickly is refused; a large one opens", async ({ page }) => {
  const file = (n: number, pts: number) =>
    JSON.stringify({
      format: "mermaidify-drawing",
      version: 1,
      saved: "",
      labels: {},
      mermaid: "",
      strokes: Array.from({ length: n }, (_, k) => ({ color: "ink", by: "pen", pts: Array.from({ length: pts }, (_, i) => [Math.round((k % 30) * 40 + 20 + 15 * Math.cos(i / 6)), Math.round(Math.floor(k / 30) * 40 + 20 + 15 * Math.sin(i / 6))]) })),
    });
  await page.locator("#open-file").setInputFiles({ name: "huge.json", mimeType: "application/json", buffer: Buffer.from(file(1000, 200)) });
  await expect(page.locator("#read")).toContainText("too large to open here");
  await page.locator("#open-file").setInputFiles({ name: "big.json", mimeType: "application/json", buffer: Buffer.from(file(600, 40)) });
  await expect(page.locator("#read")).toContainText("Opened big.json", { timeout: 10_000 });
});

test("emptying the code clears the diagram, even while one is being drawn", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await code(page).fill("flowchart TD\n  P[One] --> Q[Two] --> R[Three]");
  await code(page).fill("");
  await page.waitForTimeout(1500);
  await expect(page.locator("#diagram svg")).toHaveCount(0);
  await expect(page.locator("#save-svg")).toBeDisabled();
});

test("a saved SVG keeps the diagram's text size and plain colors, groups included", async ({ page }) => {
  await code(page).fill('flowchart TD\n  subgraph G ["Team"]\n    A["Plan"] --> B["Ship"]\n  end');
  await expect(page.locator("#diagram svg")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator("#save-svg").click()]);
  const svg = await readFile((await file.path())!, "utf8");
  const sizes = [...svg.matchAll(/<text[^>]* font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  expect(sizes.length).toBe(3);
  for (const s of sizes) {
    expect(s).toBeGreaterThan(12);
    expect(s).toBeLessThan(18);
  }
  const fills = [...svg.matchAll(/<text[^>]* fill="([^"]+)"/g)].map((m) => m[1]);
  for (const f of fills) expect(f).toMatch(/^#[0-9a-f]{6}$/);
  expect(svg).toContain(">Team<");
});

test("the More menu hands focus back, and Escape closes it", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard use");
  await page.locator("#more").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#more-list")).toBeVisible();
  await page.locator("#more").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#more-list")).toBeHidden();
  await page.locator("#more").click();
  await page.getByRole("menuitem", { name: "Fit the drawing to the screen" }).click();
  await expect(page.locator("#more")).toBeFocused();
});

test("a group's name field says it is a group", async ({ page }) => {
  await stroke(page, box(20, 20, 300, 200), "pen");
  await stroke(page, circle(120, 110, 30), "pen");
  await mermaidify(page);
  await expect(page.locator("#name-G1")).toHaveAttribute("aria-label", "Name for G1, group");
  await expect(page.locator("#name-A")).toHaveAttribute("aria-label", "Name for A, circle");
});
