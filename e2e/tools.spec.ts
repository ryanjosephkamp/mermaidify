/**
 * The tools' kinds, pressing a stroke to move it, adding to what is chosen, moving and zooming the drawing, names kept
 * on the drawing, putting away what was read, Snap, arrows and templates to add, embedding, and arrows held with a
 * closed head.
 */
import { expect, test, type Page } from "@playwright/test";

import { along, box, code, drawBoxToDiamond, fresh, mermaidify, stroke, type Pt } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

/** The drawing as kept in this browser, a moment after the last change. */
async function kept(page: Page): Promise<{ pts: Pt[] }[]> {
  await page.waitForTimeout(700);
  return page.evaluate(() => JSON.parse(localStorage.getItem("mermaidify.drawing.v1") || "null")?.strokes ?? []);
}
/** One mouse event on the drawing, with keys held if asked. */
const one = (page: Page, type: string, [x, y]: Pt, buttons: number, keys: Record<string, boolean> = {}) =>
  page.evaluate(
    ({ type, x, y, buttons, keys }) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(type, { pointerId: 5, pointerType: "mouse", isPrimary: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons, bubbles: true, cancelable: true, ...keys }));
    },
    { type, x, y, buttons, keys },
  );
const click = async (page: Page, at: Pt, keys: Record<string, boolean> = {}) => {
  await one(page, "pointerdown", at, 1, keys);
  await one(page, "pointerup", at, 0, keys);
};
/** How many pixels are painted in a box of the drawing around a point, in CSS pixels: ink, names, and the dots. */
const painted = (page: Page, [x, y]: Pt, w: number, h: number) =>
  page.evaluate(
    ({ x, y, w, h }) => {
      const c = document.getElementById("pad") as HTMLCanvasElement, k = c.width / c.getBoundingClientRect().width;
      const d = c.getContext("2d")!.getImageData(Math.round((x - w / 2) * k), Math.round((y - h / 2) * k), Math.round(w * k), Math.round(h * k)).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
      return n / (k * k);
    },
    { x, y, w, h },
  );
const selectTool = (page: Page) => page.locator('button[data-tool="select"]');

test("the eraser and the select tool, tapped again, offer their kinds, and the kind chosen is kept", async ({ page }) => {
  const eraser = page.locator('button[data-tool="erase"]'), menu = page.locator("#tool-menu");
  await eraser.click();
  await expect(menu).toBeHidden();
  await eraser.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /Erase whole strokes/ })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: /only what it passes over/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#pad")).toHaveAttribute("data-tool", "cut");
  await selectTool(page).click();
  await selectTool(page).click();
  await menu.getByRole("menuitemradio", { name: /lasso/ }).click();
  await page.reload();
  await eraser.click();
  await expect(page.locator("#pad")).toHaveAttribute("data-tool", "cut");
  await selectTool(page).click();
  await selectTool(page).click();
  await expect(menu.getByRole("menuitemradio", { name: /lasso/ })).toHaveAttribute("aria-checked", "true");
});

test("with Select, a press on a stroke moves it at once, and a box dragged on the bare drawing chooses what it reaches", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "mouse");
  await stroke(page, box(60, 200, 160, 60), "mouse");
  await selectTool(page).click();
  await stroke(page, along([[61, 41], [161, 41], [261, 41]]), "mouse");
  const [moved] = await kept(page);
  expect(moved.pts[0][0]).toBeCloseTo(260, 0);
  // A box from the bare drawing over part of the lower box only.
  await stroke(page, along([[20, 180], [160, 230], [300, 230]]), "mouse");
  await page.locator("#sel-bar").getByRole("button", { name: "Delete" }).click();
  expect(await kept(page)).toHaveLength(1);
});

test("with Select, Shift and a click add a stroke to what is chosen, or take it away", async ({ page }) => {
  for (const y of [40, 140, 240]) await stroke(page, box(60, y, 160, 60), "mouse");
  await selectTool(page).click();
  await click(page, [61, 41]);
  await click(page, [61, 141], { shiftKey: true });
  // Inside a box, away from its outline, with Shift held: a click adds it.
  await click(page, [140, 270], { shiftKey: true });
  await click(page, [61, 41], { shiftKey: true });
  await page.locator("#sel-bar").getByRole("button", { name: "Delete" }).click();
  const left = await kept(page);
  expect(left).toHaveLength(1);
  expect(left[0].pts[0][1]).toBeCloseTo(40, 0);
});

test("the hand, Space with a drag, and the wheel move and zoom the drawing", async ({ page }) => {
  await page.locator('button[data-tool="hand"]').click();
  await stroke(page, along([[200, 200], [300, 200]]), "mouse");
  expect(await kept(page)).toHaveLength(0);
  await page.locator('button[data-tool="draw"]').click();
  await stroke(page, along([[150, 100], [200, 100]]), "mouse");
  expect((await kept(page))[0].pts[0][0]).toBeCloseTo(50, 0);
  // Space held with the pointer over the drawing: a drag moves the drawing again and draws nothing, though the pen's
  // button, just pressed, still has the focus.
  await expect(page.locator('button[data-tool="draw"]')).toBeFocused();
  await one(page, "pointermove", [200, 300], 0);
  await page.keyboard.down("Space");
  await stroke(page, along([[200, 300], [250, 300]]), "mouse");
  await page.keyboard.up("Space");
  await stroke(page, along([[150, 150], [200, 150]]), "mouse");
  const all = await kept(page);
  expect(all).toHaveLength(2);
  expect(all[1].pts[0][0]).toBeCloseTo(0, 0);
  // With the eraser's button in focus, Space and a drag erase nothing, and letting Space go does not press the button.
  await page.locator('button[data-tool="erase"]').click();
  await one(page, "pointermove", [200, 150], 0);
  await page.keyboard.down("Space");
  await stroke(page, along([[150, 150], [200, 150]]), "mouse");
  await page.keyboard.up("Space");
  await expect(page.locator("#tool-menu")).toBeHidden();
  expect(await kept(page)).toHaveLength(2);
  // The wheel, up over the drawing, zooms in about the pointer.
  await page.evaluate(() => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    c.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, clientX: r.left + 100, clientY: r.top + 100, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#zoom")).toBeVisible();
  expect(parseInt((await page.locator("#zoom").textContent()) ?? "")).toBeGreaterThan(100);
});

test("a name stays on its shape on the drawing as more is drawn, and the switch in More hides names", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "pen");
  const bare = await painted(page, [140, 70], 70, 16);
  await mermaidify(page);
  await page.locator("#name-A").fill("Start here");
  await stroke(page, along([[300, 300], [340, 330]]), "pen");
  await expect(page.locator("#pad")).not.toHaveAttribute("data-read");
  await expect.poll(() => painted(page, [140, 70], 70, 16)).toBeGreaterThan(bare + 60);
  await page.locator("#more").click();
  await page.getByRole("menuitemcheckbox", { name: "Show names on the drawing" }).click();
  await expect.poll(() => painted(page, [140, 70], 70, 16)).toBeLessThan(bare + 20);
});

test("picking a tool closes the Add menu", async ({ page }) => {
  await page.locator("#add").click();
  await expect(page.locator("#add-list")).toBeVisible();
  await page.locator('button[data-tool="hand"]').click();
  await expect(page.locator("#add-list")).toBeHidden();
});

test("with Select, a tap on the bare drawing puts away what was read too", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await selectTool(page).click();
  await click(page, [330, 320]);
  await expect(page.locator("#pad")).not.toHaveAttribute("data-read");
});

test("a tap on the bare drawing or Escape puts away what was read, and a tap on a shape still names it", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  const pad = page.locator("#pad");
  await expect(pad).toHaveAttribute("data-read", "");
  await click(page, [330, 320]);
  await expect(pad).not.toHaveAttribute("data-read");
  await mermaidify(page);
  await expect(pad).toHaveAttribute("data-read", "");
  await page.keyboard.press("Escape");
  await expect(pad).not.toHaveAttribute("data-read");
  await click(page, [140, 70]);
  await expect(page.locator("#name-edit")).toBeVisible();
  await expect(pad).toHaveAttribute("data-read", "");
});

test("Snap makes a line and a V drawn apart into one clean arrow, which reads with its head", async ({ page }) => {
  await stroke(page, box(40, 40, 140, 60), "mouse");
  await stroke(page, box(40, 260, 140, 60), "mouse");
  await stroke(page, along([[110, 106], [111, 230]]), "mouse");
  await stroke(page, along([[100, 214], [111, 234], [122, 214]]), "mouse");
  await selectTool(page).click();
  await stroke(page, along([[86, 120], [110, 200], [136, 246]]), "mouse");
  await page.locator("#sel-bar").getByRole("button", { name: "Snap" }).click();
  await expect(page.locator("#read")).toContainText("Snapped 1 arrow clean");
  expect(await kept(page)).toHaveLength(3);
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
  await expect(page.locator("#read")).not.toContainText("no head");
});

test("Add offers arrows: a two-way arrow between two shapes reads both ways", async ({ page }) => {
  const { w, h } = await page.locator("#pad").evaluate((c) => ({ w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height }));
  const cx = w / 2, cy = h / 2;
  await stroke(page, box(cx - 70 - 8 - 110, cy - 30, 110, 60), "mouse");
  await stroke(page, box(cx + 78, cy - 30, 110, 60), "mouse");
  await page.locator("#add").click();
  await page.getByRole("menuitem", { name: "Two-way arrow" }).click();
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A <--> B/);
});

test("the Add menu groups its templates, and an agent workflow reads whole", async ({ page }) => {
  await page.locator("#add").click();
  for (const head of ["Shapes", "Arrows", "Flowcharts", "State diagrams", "Agent workflows"]) await expect(page.locator("#add-list .menu-head", { hasText: head })).toBeVisible();
  await page.getByRole("menuitem", { name: "Review gate" }).click();
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("4 shapes");
  await expect(page.locator("#read")).toContainText("5 arrows");
  await expect(code(page)).toHaveValue(/Merge approval/);
});

test("Copy embed code gives a frame whose page shows the diagram", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#embed").click();
  await expect(page.locator("#save-status")).toContainText("Embed code copied");
  const html = await page.evaluate(() => navigator.clipboard.readText());
  const src = /<iframe src="([^"]+)" title="Flowchart" width="640" height="\d+"/.exec(html)?.[1];
  expect(src).toMatch(/\/embed\/#code=z/);
  await page.goto(src!);
  await expect(page.locator("#embed svg")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#embed")).toContainText("Node 1");
});

test("an arrow drawn with a closed triangle for its head, held at its end, snaps clean and can be aimed", async ({ page }) => {
  await stroke(page, box(40, 40, 140, 60), "mouse");
  await stroke(page, box(260, 220, 140, 60), "mouse");
  // Down from the first box to the tip, then round a triangle back to the tip; held, then aimed at the second box.
  const drawn = along([[110, 106], [112, 200], [100, 182], [124, 182], [112, 200]]);
  await one(page, "pointerdown", drawn[0], 1);
  for (const p of drawn) await one(page, "pointermove", p, 1);
  await page.waitForTimeout(700);
  for (const p of along([[112, 200], [300, 205]], 6)) await one(page, "pointermove", p, 1);
  await one(page, "pointerup", [300, 205], 0);
  expect(await kept(page)).toHaveLength(3);
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A --> B/);
  await expect(page.locator("#read")).toContainText("2 shapes");
});
