import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { along, box, circle, code, drawBoxToDiamond, fresh, mermaidify, stroke } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

test("opens ready to draw, with no sideways scroll", async ({ page }) => {
  await expect(page.locator("#pad")).toBeVisible();
  await expect(page.locator("#hint")).toContainText("Draw a flowchart here");
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
  await expect(page.locator(".site-header .site-logo")).toContainText("mermaidify");
  await expect(page.locator(".site-footer")).toContainText("Made by");
  await expect(page.locator(".site-footer .site-sponsor")).toHaveAttribute("href", "https://github.com/sponsors/ryanjosephkamp");
});

test("draws a flowchart with a pen and reads it", async ({ page }) => {
  await drawBoxToDiamond(page);
  await expect(page.locator("#go")).toHaveAttribute("data-stale", "true");
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("2 shapes");
  await expect(code(page)).toHaveValue(/flowchart TD\n {2}A\["Node 1"\]\n {2}B\{"Node 2"\}\n {2}A --> B/);
  await expect(page.locator("#diagram svg g.node")).toHaveCount(2);
});

test("draws with a real mouse", async ({ page, isMobile }) => {
  test.skip(isMobile, "a phone has no mouse");
  const r = (await page.locator("#pad").boundingBox())!;
  const drag = async (pts: [number, number][]) => {
    await page.mouse.move(r.x + pts[0][0], r.y + pts[0][1]);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(r.x + x, r.y + y);
    await page.mouse.up();
  };
  await drag(box(60, 40, 160, 60));
  await drag(circle(140, 220, 34));
  await drag(along([[140, 104], [140, 184], [133, 174], [140, 184], [147, 174]]));
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Node 1"\]\n {2}B\(\("Node 2"\)\)\n {2}A --> B/);
});

test("a palm while the pen is down draws nothing, and fingers then move the drawing", async ({ page }) => {
  await stroke(page, box(60, 40, 160, 60), "pen");
  await expect(page.locator("#pen-chip")).toBeVisible();
  // A touch right after the pen is a palm.
  await stroke(page, along([[30, 300], [200, 320]]), "touch");
  await page.waitForTimeout(700);
  // A finger later pans the drawing instead of drawing.
  await stroke(page, along([[100, 300], [160, 340]]), "touch");
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("1 shape");
  await expect(page.locator("#read")).not.toContainText("left out");
  // Letting fingers draw again.
  await page.locator("#fingers-draw").click();
  await expect(page.locator("#pen-chip")).toBeHidden();
  await page.waitForTimeout(700);
  await stroke(page, box(60, 200, 160, 60), "touch");
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("2 shapes");
});

test("erases whole strokes, and undo and redo cover it", async ({ page }) => {
  await drawBoxToDiamond(page);
  await page.locator('[data-tool="erase"]').click();
  // Rub across the diamond's left corner.
  await stroke(page, along([[55, 210], [75, 230]]), "pen");
  await page.locator('[data-tool="draw"]').click();
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("1 shape");
  await page.locator("#undo").click();
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("2 shapes");
  await page.locator("#redo").click();
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("1 shape");
});

test("the pen's side button erases while held", async ({ page }) => {
  await drawBoxToDiamond(page);
  await stroke(page, along([[55, 210], [75, 230]]), "pen", { buttons: 3 });
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("1 shape");
});

test("a tap on a shape names it, and the name stays with its shape", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await stroke(page, [[140, 70], [140, 70]], "pen");
  const input = page.locator("#name-input");
  await expect(input).toBeFocused();
  await input.fill('Write the "draft"');
  await input.press("Enter");
  await expect(code(page)).toHaveValue(/A\["Write the #34;draft#34;"\]/);
  await expect(page.locator("#name-A")).toHaveValue('Write the "draft"');
  // A new box drawn left of it takes the letter A in reading order; the name moves with its box to B.
  await stroke(page, box(4, 46, 48, 44), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Node 1"\]\n {2}B\["Write the #34;draft#34;"\]/);
});

test("the names list writes the code, and editing the code by hand pauses it until a rebuild", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#name-B").fill("Good enough?");
  await expect(code(page)).toHaveValue(/B\{"Good enough\?"\}/);
  await code(page).fill("flowchart LR\n  X[Mine] --> Y[Also mine]");
  await expect(page.locator("#name-A")).toBeDisabled();
  await expect(page.locator("#diagram svg g.node")).toHaveCount(2);
  await expect(page.locator("#diagram")).toContainText("Also mine");
  await page.locator("#rebuild").click();
  await expect(code(page)).toHaveValue(/B\{"Good enough\?"\}/);
  await expect(page.locator("#name-A")).toBeEnabled();
});

test("broken Mermaid says so, and the last diagram stays", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await code(page).fill("flowchart TD\n  A[open --> ");
  await expect(page.locator("#mm-error")).toBeVisible();
  await expect(page.locator("#mm-error")).toContainText("Mermaid can't read this yet");
  await expect(page.locator("#diagram svg")).toBeVisible();
});

test("saves SVG with plain text names, PNG, and .mmd", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#name-A").fill("Plan <it> & ship");
  await expect(code(page)).toHaveValue(/Plan #60;it#62; #38; ship/);
  await page.waitForTimeout(600);

  const [svgFile] = await Promise.all([page.waitForEvent("download"), page.locator("#save-svg").click()]);
  expect(svgFile.suggestedFilename()).toBe("flowchart.svg");
  const svg = await readFile((await svgFile.path())!, "utf8");
  expect(svg).not.toContain("<foreignObject");
  expect(svg).toContain("Plan &lt;it&gt; &amp; ship");
  expect(svg).toMatch(/^<svg[^>]+width="\d+"[^>]+height="\d+"/);

  const [pngFile] = await Promise.all([page.waitForEvent("download"), page.locator("#save-png").click()]);
  expect(pngFile.suggestedFilename()).toBe("flowchart.png");
  const png = await readFile((await pngFile.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.readUInt32BE(16)).toBeGreaterThan(100);

  const [mmdFile] = await Promise.all([page.waitForEvent("download"), page.locator("#save-mmd").click()]);
  expect(await readFile((await mmdFile.path())!, "utf8")).toBe((await code(page).inputValue()) + "\n");
});

test("a saved drawing opens again with its names and code", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#name-A").fill("Draft");
  await page.locator("#more").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Save the drawing (.json)" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^drawing-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const json = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(json.format).toBe("mermaidify-drawing");
  expect(json.strokes).toHaveLength(3);
  expect(json.strokes[0].by).toBe("pen");
  expect(json.mermaid).toContain('A["Draft"]');

  await page.locator("#clear").click();
  await expect(page.locator("#hint")).toBeVisible();
  await page.locator("#open-file").setInputFiles((await file.path())!);
  await expect(code(page)).toHaveValue(/A\["Draft"\]\n {2}B\{"Node 2"\}/);
  await expect(page.locator("#read")).toContainText("Opened");
});

test("a file that is not a drawing is refused, and the drawing stays", async ({ page }) => {
  await drawBoxToDiamond(page);
  await page.locator("#open-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"format":"other"}') });
  await expect(page.locator("#read")).toContainText("not a mermaidify drawing");
  await mermaidify(page);
  await expect(page.locator("#read")).toContainText("2 shapes");
});

test("the drawing and its names survive a reload", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#name-B").fill("Ship it?");
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator("#hint")).toBeHidden();
  await expect(code(page)).toHaveValue(/B\{"Ship it\?"\}/);
  await expect(page.locator("#diagram svg")).toBeVisible({ timeout: 15_000 });
});

test("the example loads, reads, and draws", async ({ page }) => {
  await page.locator("#hint-example").click();
  await expect(page.locator("#read")).toContainText("4 shapes");
  await expect(page.locator("#read")).toContainText("1 loop");
  await expect(page.locator("#diagram svg g.node")).toHaveCount(4, { timeout: 15_000 });
  await page.locator("#hand").check();
  // The hand-drawn look marks its shapes "rough-node".
  await expect(page.locator("#diagram svg g.rough-node")).toHaveCount(4, { timeout: 15_000 });
});

test("the theme menu changes the look and keeps it across pages", async ({ page }) => {
  await page.locator(".site-theme-toggle").click();
  await page.getByRole("menuitemradio", { name: "Ember" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");
  await page.goto("./docs/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");
  const night = await page.evaluate(() => getComputedStyle(document.querySelector(".site-header")!).backgroundColor);
  expect(night).toBe("rgb(28, 19, 13)");
});
