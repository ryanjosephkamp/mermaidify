/** Lines on the Draw page: dashes and lines gone over twice, line names, and line styles. */
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { along, box, code, fresh, mermaidify, stroke, type Pt } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

/** The drawing as this browser keeps it, once the page has saved it. */
async function kept(page: Page) {
  await page.waitForTimeout(700);
  return page.evaluate(() => JSON.parse(localStorage.getItem("mermaidify.drawing.v1") || "null"));
}

const tap = (page: Page, x: number, y: number) => stroke(page, [[x, y], [x, y]], "pen");
/** Dashes down from y0 to y1 at x, the last with a hook for its head. */
async function dashesDown(page: Page, x: number, y0: number, y1: number) {
  for (let y = y0; y < y1 - 30; y += 22) await stroke(page, along([[x, y], [x, y + 13]]), "pen");
  await stroke(page, along([[x, y1 - 13], [x, y1], [x - 7, y1 - 9], [x, y1], [x + 7, y1 - 9]]), "pen");
}
const arrowRight = (y: number, x0: number, x1: number): Pt[] => along([[x0, y], [x1, y], [x1 - 9, y - 7], [x1, y], [x1 - 9, y + 7]]);

/** A box over a box joined by dashes, and a box beside the lower one joined by a line gone over twice. */
async function drawStyled(page: Page) {
  await stroke(page, box(40, 30, 140, 56), "pen");
  await stroke(page, box(40, 200, 140, 56), "pen");
  await stroke(page, box(270, 200, 140, 56), "pen");
  await dashesDown(page, 110, 92, 195);
  await stroke(page, arrowRight(228, 184, 264), "pen");
  await stroke(page, along([[186, 232], [262, 232]]), "pen");
}

test("dashes read as a dotted line, and a line gone over again as a thick one", async ({ page }) => {
  await drawStyled(page);
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("2 arrows (1 dotted, 1 thick)");
  await expect(code(page)).toHaveValue(/A -\.-> B\n {2}B ==> C/);
  await expect(page.locator("#diagram svg .edge-pattern-dotted")).toHaveCount(1);
  await expect(page.locator("#diagram svg .edge-thickness-thick")).toHaveCount(1);
});

test("a tap on a line names it, and the name follows the line through more drawing and a reload", async ({ page }) => {
  await drawStyled(page);
  await mermaidify(page);
  await tap(page, 115, 140);
  const input = page.locator("#name-input");
  await expect(input).toBeFocused();
  await expect(page.locator("#name-label")).toHaveText("Name for the line from A to B");
  await input.fill('say "yes"');
  await input.press("Enter");
  await expect(code(page)).toHaveValue(/A -\.->\|"say #34;yes#34;"\| B/);
  await expect(page.locator("#name-L1")).toHaveValue('say "yes"');
  await expect(page.locator("#diagram")).toContainText('say "yes"');
  // A new box above-left takes the letter A; the name stays on the dotted line, now from B to C.
  await stroke(page, box(4, 4, 30, 20), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/B -\.->\|"say #34;yes#34;"\| C/);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(code(page)).toHaveValue(/B -\.->\|"say #34;yes#34;"\| C/);
});

test("a line's menu changes its style, and the choice stays with the line", async ({ page }) => {
  await drawStyled(page);
  await mermaidify(page);
  await page.locator("#style-L1").selectOption("thick");
  await page.locator("#style-L2").selectOption("plain");
  await expect(code(page)).toHaveValue(/A ==> B\n {2}B --> C/);
  await expect(page.locator("#read")).toContainText("2 arrows (1 thick)");
  // A new box top right becomes C, so the plain line now runs from B to D.
  await stroke(page, box(270, 30, 140, 56), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A ==> B\n {2}B --> D/);
  expect((await kept(page)).lines).toEqual({ L1: "thick", L2: "plain" });
  // Back to the style it was drawn with, the line needs no choice kept.
  await page.locator("#style-L1").selectOption("dotted");
  await expect(code(page)).toHaveValue(/A -\.-> B/);
  expect((await kept(page)).lines).toEqual({ L2: "plain" });
});

test("a named line erased and drawn again keeps its name", async ({ page }) => {
  await drawStyled(page);
  await mermaidify(page);
  await page.locator("#name-L2").fill("then");
  await expect(code(page)).toHaveValue(/B ==>\|"then"\| C/);
  await page.locator('[data-tool="erase"]').click();
  await stroke(page, along([[225, 215], [225, 245]]), "pen");
  await page.locator('[data-tool="draw"]').click();
  await stroke(page, arrowRight(230, 184, 264), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/B -->\|"then"\| C/);
});

test("a tap on a line's name in the diagram goes to its name field, among lines between the same two shapes", async ({ page }) => {
  await stroke(page, box(40, 30, 200, 56), "pen");
  await stroke(page, box(40, 230, 200, 56), "pen");
  await stroke(page, along([[90, 92], [90, 224], [83, 215], [90, 224], [97, 215]]), "pen");
  await stroke(page, along([[190, 92], [190, 224], [183, 215], [190, 224], [197, 215]]), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B\n {2}A --> B/);
  await page.locator("#name-L1").fill("first");
  await page.locator("#name-L2").fill("second");
  await expect(page.locator("#diagram svg g.edgeLabel", { hasText: "second" })).toBeVisible();
  await page.locator("#name-L1").focus();
  await page.locator("#diagram svg g.edgeLabel", { hasText: "second" }).click();
  await expect(page.locator("#name-L2")).toBeFocused();
});

test("a line inside a group can be tapped and named", async ({ page }) => {
  await stroke(page, box(20, 20, 300, 300), "pen");
  await stroke(page, box(80, 50, 140, 56), "pen");
  await stroke(page, box(80, 220, 140, 56), "pen");
  await stroke(page, along([[150, 112], [150, 214], [143, 205], [150, 214], [157, 205]]), "pen");
  await mermaidify(page);
  await tap(page, 154, 160);
  await expect(page.locator("#name-label")).toHaveText("Name for the line from A to B");
  await page.locator("#name-input").fill("inside");
  await page.locator("#name-input").press("Enter");
  await expect(code(page)).toHaveValue(/A -->\|"inside"\| B/);
});

test("erasing one of two named lines between the same shapes gives its name to neither the other nor back", async ({ page }) => {
  await stroke(page, box(40, 30, 200, 56), "pen");
  await stroke(page, box(40, 230, 200, 56), "pen");
  await stroke(page, along([[90, 92], [90, 224], [83, 215], [90, 224], [97, 215]]), "pen");
  await stroke(page, along([[190, 224], [190, 92], [183, 101], [190, 92], [197, 101]]), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B\n {2}B --> A/);
  await page.locator("#name-L1").fill("yes");
  await page.locator('[data-tool="erase"]').click();
  await stroke(page, along([[84, 160], [96, 160]]), "pen");
  await page.locator('[data-tool="draw"]').click();
  await mermaidify(page);
  // Only the upward line is left, so the diagram runs bottom to top and the lower box is A; the line has no name.
  await expect(code(page)).toHaveValue(/^flowchart BT\n[^|]*\n {2}A --> B$/);
  await page.locator("#undo").click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A -->\|"yes"\| B\n {2}B --> A$/);
});

test("a saved drawing opens again with its line names and styles", async ({ page }) => {
  await drawStyled(page);
  await mermaidify(page);
  await page.locator("#name-L1").fill("maybe");
  await page.locator("#style-L2").selectOption("dotted");
  await page.locator("#more").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Save the drawing (.json)" }).click()]);
  const json = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(json.labels).toEqual({ L1: "maybe" });
  expect(json.lines).toEqual({ L2: "dotted" });
  await page.locator("#clear").click();
  await page.locator("#open-file").setInputFiles((await file.path())!);
  await expect(code(page)).toHaveValue(/A -\.->\|"maybe"\| B\n {2}B -\.-> C/);
  await expect(page.locator("#style-L2")).toHaveValue("dotted");
});

test("a shape and a line drawn in one stroke keep their own names", async ({ page }) => {
  await stroke(page, box(40, 30, 140, 56), "pen");
  // One stroke: a line down from the box, then the box it leads to, drawn without lifting the pen.
  await stroke(page, along([[110, 92], [110, 200], [180, 200], [180, 256], [40, 256], [40, 200], [108, 200]]), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
  await page.locator("#name-L1").fill("next");
  await page.locator("#name-B").fill("Pay");
  await expect(code(page)).toHaveValue(/B\["Pay"\][\s\S]*A -->\|"next"\| B/);
  // Read again with one more box: each name stays where it was typed.
  await stroke(page, box(270, 200, 140, 56), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/B\["Pay"\][\s\S]*C\["Node 3"\][\s\S]*A -->\|"next"\| B/);
});
