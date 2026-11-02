/** Clearing in one press, the hint making way, choosing and moving strokes, adding shapes and templates, and aiming arrows. */
import { expect, test, type Page } from "@playwright/test";

import { along, arrowDown, box, code, fresh, mermaidify, stroke, type Pt } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

/** Pointer events one at a time, so a test can look between them. */
const fire = (page: Page, type: string, pts: Pt[], buttons: number) =>
  page.evaluate(
    ({ type, pts, buttons }) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      for (const [x, y] of pts)
        c.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: "mouse", isPrimary: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons, bubbles: true, cancelable: true }));
    },
    { type, pts, buttons },
  );
/** A closed loop through the corners, for a lasso. */
const loop = (corners: Pt[]) => along([...corners, corners[0]], 4);
/** How many strokes the drawing has, once it is kept, a moment after the last change. */
async function strokeCount(page: Page) {
  await page.waitForTimeout(700);
  return page.evaluate(() => JSON.parse(localStorage.getItem("mermaidify.drawing.v1") || "null")?.strokes.length ?? 0);
}

test("the hint makes way as soon as a stroke begins, before the pen lifts", async ({ page }) => {
  await fire(page, "pointerdown", [[100, 100]], 1);
  await fire(page, "pointermove", along([[100, 100], [160, 140]]), 1);
  await expect(page.locator("#hint")).toBeHidden();
  await fire(page, "pointerup", [[160, 140]], 0);
});

test("Clear empties the drawing in one press, and Undo brings it back", async ({ page }) => {
  await expect(page.locator("#clear")).toBeDisabled();
  await stroke(page, box(60, 40, 160, 60), "mouse");
  await page.locator("#clear").click();
  await expect(page.locator("#hint")).toBeVisible();
  await expect(page.locator("#clear")).toBeDisabled();
  await page.locator("#undo").click();
  await expect(page.locator("#hint")).toBeHidden();
  await expect(page.locator("#clear")).toBeEnabled();
});

test("a lasso over part of a box and its arrow takes both whole, and they move together", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "mouse");
  await stroke(page, arrowDown(140, 104, 196), "mouse");
  await stroke(page, box(60, 200, 160, 60), "mouse");
  // The select tool, tapped again, offers the lasso.
  await page.locator('button[data-tool="select"]').click();
  await page.locator('button[data-tool="select"]').click();
  await page.locator('#tool-menu [data-kind="lasso"]').click();
  // Around the lower part of the top box and the top of the arrow only.
  await stroke(page, loop([[40, 80], [240, 80], [240, 130], [40, 130]]), "mouse");
  const bar = page.locator("#sel-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Delete" })).toBeVisible();
  // Drag them 200 to the right: the box and the arrow go, the lower box stays, and the arrow no longer reaches it.
  await stroke(page, along([[140, 70], [340, 70]]), "mouse");
  await page.locator('button[data-tool="draw"]').click();
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("2 shapes");
  await expect(page.locator("#read")).toContainText("0 arrows");
  await page.locator("#undo").click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
});

test("copy and paste, duplicate, group, and delete act on the chosen strokes, and Undo takes each back", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "mouse");
  await page.locator('button[data-tool="select"]').click();
  await stroke(page, [[61, 41]], "mouse");
  const bar = page.locator("#sel-bar");
  await bar.getByRole("button", { name: "Copy" }).click();
  await bar.getByRole("button", { name: "Paste" }).click();
  expect(await strokeCount(page)).toBe(2);
  await bar.getByRole("button", { name: "Duplicate" }).click();
  expect(await strokeCount(page)).toBe(3);
  await bar.getByRole("button", { name: "Delete" }).click();
  expect(await strokeCount(page)).toBe(2);
  await page.locator("#undo").click();
  expect(await strokeCount(page)).toBe(3);
  // Two strokes grouped: a tap on one chooses both, and Delete takes both. A box dragged over both chooses them.
  await stroke(page, along([[20, 20], [300, 200], [600, 400]]), "mouse");
  await bar.getByRole("button", { name: "Group the chosen strokes" }).click();
  await stroke(page, [[400, 400]], "mouse");
  await stroke(page, [[61, 41]], "mouse");
  await bar.getByRole("button", { name: "Delete" }).click();
  expect(await strokeCount(page)).toBe(0);
});

test("Add puts a clean shape in the middle of the drawing, chosen, and a template reads whole with its names", async ({ page }) => {
  await page.locator("#add").click();
  await page.getByRole("menuitem", { name: "Diamond" }).click();
  await expect(page.locator("#sel-bar")).toBeVisible();
  await expect(page.locator('button[data-tool="select"]')).toHaveAttribute("aria-checked", "true");
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("1 diamond");
  await page.locator("#clear").click();
  await page.locator("#add").click();
  await page.getByRole("menuitem", { name: /A door/ }).click();
  await mermaidify(page);
  await expect(page.locator("#diagram-kind")).toHaveValue("state");
  await expect(page.locator("#read")).toContainText("3 states");
  await expect(page.locator("#read")).toContainText("5 transitions");
  await expect(code(page)).toHaveValue(/Closed/);
  await expect(code(page)).toHaveValue(/unlock/);
});

test("holding at the end of an arrow makes it clean, and moving while holding aims it", async ({ page }) => {
  await stroke(page, box(40, 40, 140, 60), "mouse");
  await stroke(page, box(260, 220, 140, 60), "mouse");
  // An arrow down from the first box, its head drawn last; then held, and aimed across at the second box.
  const drawn = along([[110, 106], [112, 200], [104, 188], [112, 200], [120, 188]]);
  await fire(page, "pointerdown", [drawn[0]], 1);
  await fire(page, "pointermove", drawn, 1);
  await page.waitForTimeout(700);
  await fire(page, "pointermove", along([[120, 188], [300, 200]], 6), 1);
  await fire(page, "pointerup", [[300, 200]], 0);
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
});

test("nothing runs off the side at common phone widths, with either menu open", async ({ page }) => {
  for (const width of [320, 360, 375, 385, 390, 393, 402, 412]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}`).toBeLessThanOrEqual(width);
    for (const id of ["#add", "#more"]) {
      await page.locator(id).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width} ${id}`).toBeLessThanOrEqual(width);
      await page.locator(id).click();
    }
    // The select tool's kinds, opened by tapping it again.
    await page.locator('button[data-tool="select"]').click();
    await page.locator('button[data-tool="select"]').click();
    await expect(page.locator("#tool-menu")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width} tool menu`).toBeLessThanOrEqual(width);
    await page.locator('button[data-tool="draw"]').click();
  }
});

/** One pointer event with a given pointer type and id. */
const one = (page: Page, type: string, [x, y]: Pt, kind: string, id: number, buttons: number, extra: Record<string, unknown> = {}) =>
  page.evaluate(
    ({ type, x, y, kind, id, buttons, extra }) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: kind, isPrimary: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons, bubbles: true, cancelable: true, ...extra }));
    },
    { type, x, y, kind, id, buttons, extra },
  );
const firstPoint = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mermaidify.drawing.v1") || "null")?.strokes[0].pts[0]);

test("with Select, a palm that lands before the pen moves nothing, and the pen still works", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "mouse");
  await page.locator('button[data-tool="select"]').click();
  await stroke(page, [[61, 41]], "mouse");
  await page.waitForTimeout(700);
  const before = await firstPoint(page);
  // A palm inside the chosen box, dragging, then the pen comes down elsewhere and the palm lifts.
  await one(page, "pointerdown", [140, 70], "touch", 21, 1);
  await one(page, "pointermove", [150, 72], "touch", 21, 1);
  await one(page, "pointerdown", [300, 300], "pen", 22, 1);
  await one(page, "pointermove", [200, 75], "touch", 21, 1);
  await one(page, "pointerup", [200, 75], "touch", 21, 0);
  await one(page, "pointerup", [300, 300], "pen", 22, 0);
  await page.waitForTimeout(700);
  expect(await firstPoint(page)).toEqual(before);
});

test("a select press cut off by Ctrl and a click's menu moves nothing afterward", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "mouse");
  await page.locator('button[data-tool="select"]').click();
  await stroke(page, [[61, 41]], "mouse");
  await page.waitForTimeout(700);
  const before = await firstPoint(page);
  await one(page, "pointerdown", [140, 70], "mouse", 1, 1, { ctrlKey: true });
  await page.evaluate(() => document.getElementById("pad")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ctrlKey: true })));
  // The menu took the button's release; the mouse moves on with no button down, then clicks somewhere else.
  await one(page, "pointermove", [300, 200], "mouse", 1, 0);
  await stroke(page, [[400, 400]], "mouse");
  await page.waitForTimeout(700);
  expect(await firstPoint(page)).toEqual(before);
});

test("after Undo takes back a duplicate, the bar offers nothing for strokes that are gone", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "mouse");
  await page.locator('button[data-tool="select"]').click();
  await stroke(page, [[61, 41]], "mouse");
  const bar = page.locator("#sel-bar");
  await bar.getByRole("button", { name: "Duplicate" }).click();
  await page.locator("#undo").click();
  await expect(bar.getByRole("button", { name: "Delete" })).toBeHidden();
});
