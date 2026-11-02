/** Drawing zoomed out or in: the reader reads a drawing at the size it was drawn on screen. */
import { expect, type Page, test } from "@playwright/test";

import { along, box, code, fresh, mermaidify, stroke } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

/** Two fingers spread or pinched about a point, by the given factor. */
async function pinch(page: Page, at: [number, number], factor: number) {
  await page.evaluate(
    ({ at, factor }) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      const fire = (type: string, id: number, x: number, y: number) =>
        c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 31, clientX: r.left + x, clientY: r.top + y, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
      const d0 = 80, d1 = d0 * factor;
      fire("pointerdown", 31, at[0] - d0 / 2, at[1]);
      fire("pointerdown", 32, at[0] + d0 / 2, at[1]);
      for (let k = 1; k <= 12; k++) {
        const d = d0 + ((d1 - d0) * k) / 12;
        fire("pointermove", 31, at[0] - d / 2, at[1]);
        fire("pointermove", 32, at[0] + d / 2, at[1]);
      }
      fire("pointerup", 31, at[0] - d1 / 2, at[1]);
      fire("pointerup", 32, at[0] + d1 / 2, at[1]);
    },
    { at, factor },
  );
}

test("a drawing made zoomed out to 30% reads as it does at 100%, and the drawing zooms out to 10%", async ({ page }) => {
  await pinch(page, [180, 200], 0.3);
  await expect(page.locator("#zoom")).toHaveText("30%");
  // The same size on screen as at 100%: an arrow with long barbs drawn in its stroke, stopping short of the box.
  await stroke(page, box(80, 40, 120, 60), "touch");
  await stroke(page, along([[140, 106], [141, 210], [112, 176], [141, 210], [170, 176]]), "touch");
  await stroke(page, box(80, 240, 120, 60), "touch");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Node 1"\]\n {2}B\["Node 2"\]\n {2}A --> B/);
  // The zoom each stroke was drawn at is kept with it, so the drawing reads the same after a reload.
  await page.reload();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
  await pinch(page, [180, 200], 0.2);
  await pinch(page, [180, 200], 0.2);
  await expect(page.locator("#zoom")).toHaveText("10%");
});

test("triangles, parallelograms, and a trapezoid wide at the top are read, and Mermaid draws them", async ({ page }) => {
  await stroke(page, along([[90, 20], [140, 100], [40, 100], [90, 20], [94, 24]]), "pen");
  await stroke(page, along([[200, 20], [300, 20], [250, 100], [200, 20], [204, 22]]), "pen");
  await stroke(page, along([[62, 150], [160, 150], [138, 210], [40, 210], [62, 150], [66, 150]]), "pen");
  await stroke(page, along([[200, 150], [300, 150], [280, 210], [220, 210], [200, 150], [204, 150]]), "pen");
  await mermaidify(page);
  const text = await code(page).inputValue();
  expect(text).toMatch(/[A-D]@\{ shape: tri, label: "Node \d" \}/);
  expect(text).toMatch(/[A-D]@\{ shape: flip-tri, label: "Node \d" \}/);
  expect(text).toMatch(/[A-D]\[\/"Node \d"\/\]/);
  expect(text).toMatch(/[A-D]\[\\"Node \d"\/\]/);
  await expect(page.locator("#diagram svg g.node")).toHaveCount(4);
  await expect(page.locator("#mm-error")).toBeHidden();
  await expect(page.locator("#read")).toContainText("1 triangle");
});
