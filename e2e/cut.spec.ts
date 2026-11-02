/** The cutting eraser: it takes only the ink it passes over, and leaves the rest of each stroke. */
import { expect, test } from "@playwright/test";

import { along, arrowDown, box, code, fresh, mermaidify, partEraser, stroke } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

test("the eraser that takes only what it passes over parts the line drawn with a box in one stroke, and the box keeps its name", async ({ page }) => {
  // A box, then on without lifting into a line down to a second box.
  await stroke(page, along([[100, 90], [150, 90], [150, 30], [50, 30], [50, 90], [98, 90], [100, 196]]), "pen");
  await stroke(page, box(40, 200, 120, 50), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Node 1"\]\n {2}B\["Node 2"\]\n {2}A --> B/);
  await page.locator("#name-A").fill("Start");
  await partEraser(page);
  await expect(page.locator('button[data-tool="erase"]')).toHaveAttribute("aria-checked", "true");
  await stroke(page, along([[100, 112], [100, 190]]), "pen");
  await page.locator('button[data-tool="draw"]').click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue('flowchart TD\n  A["Start"]\n  B["Node 2"]');
});

test("a cut across an arrow parts it, and Undo puts it back", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "pen");
  await stroke(page, box(60, 230, 160, 60), "pen");
  await stroke(page, arrowDown(140, 104, 226), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
  await page.keyboard.press("c");
  await stroke(page, along([[110, 165], [170, 165]]), "pen");
  await mermaidify(page);
  await expect(code(page)).not.toHaveValue(/-->/);
  // The arrow's two ends are still there, left out, where Erase would have taken the whole arrow.
  await expect(page.locator("#read")).toContainText("2 marks left out");
  await page.locator("#undo").click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
});

test("with that eraser chosen, the pen's side button still erases whole strokes", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "pen");
  await stroke(page, box(60, 230, 160, 60), "pen");
  await partEraser(page);
  await stroke(page, along([[60, 260], [62, 262]]), "pen", { buttons: 2 });
  await page.locator('button[data-tool="draw"]').click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/^flowchart \w+\n {2}A\["Node 1"\]$/);
});

test("a name given after a cut stays when the cut is undone", async ({ page }) => {
  await stroke(page, along([[100, 90], [150, 90], [150, 30], [50, 30], [50, 90], [98, 90], [100, 196]]), "pen");
  await stroke(page, box(40, 200, 120, 50), "pen");
  await mermaidify(page);
  await page.locator("#name-A").fill("Start");
  await partEraser(page);
  await stroke(page, along([[100, 112], [100, 190]]), "pen");
  await mermaidify(page);
  await page.locator("#name-A").fill("Begin");
  await page.locator("#undo").click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Begin"\][\s\S]*A --> B/);
});

test("with that eraser chosen and fingers drawing, two fingers pinch instead of cutting", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "touch");
  await partEraser(page);
  await page.evaluate(() => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    const fire = (type: string, id: number, x: number, y: number) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 21, clientX: r.left + x, clientY: r.top + y, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
    fire("pointerdown", 21, 120, 70);
    fire("pointerdown", 22, 160, 70);
    for (let k = 1; k <= 10; k++) {
      fire("pointermove", 21, 120 - k * 4, 70);
      fire("pointermove", 22, 160 + k * 4, 70);
    }
    fire("pointerup", 21, 80, 70);
    fire("pointerup", 22, 200, 70);
  });
  await expect(page.locator("#zoom")).toBeVisible();
  await page.locator('button[data-tool="draw"]').click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Node 1"\]/);
  await expect(page.locator("#read")).not.toContainText("left out");
});
