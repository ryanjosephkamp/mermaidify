/** Drawing in comfort: holding a stroke to snap it, choosing a shape's look, and full screen. */
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { along, box, circle, code, drawBoxToDiamond, fresh, mermaidify, stroke, type Pt } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

/** A press along the points, held still at each break for longer than a snap takes, then lifted. */
async function heldStroke(page: Page, parts: Pt[][], kind: "pen" | "touch" | "mouse" = "pen") {
  const fire = (type: string, pts: Pt[], buttons: number) =>
    page.evaluate(
      ({ type, pts, kind, buttons }) => {
        const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
        for (const [x, y] of pts)
          c.dispatchEvent(
            new PointerEvent(type, { pointerId: 7, pointerType: kind, isPrimary: true, clientX: r.left + x, clientY: r.top + y, buttons, pressure: 0.5, bubbles: true, cancelable: true }),
          );
      },
      { type, pts, kind, buttons },
    );
  await fire("pointerdown", [parts[0][0]], 1);
  for (const part of parts) {
    await fire("pointermove", part, 1);
    await page.waitForTimeout(700);
  }
  const last = parts[parts.length - 1];
  await fire("pointerup", [last[last.length - 1]], 0);
}
/** A rough box: the corners overshoot and the sides bow, as a quick sketch's do. */
const roughBox = (x: number, y: number, w: number, h: number): Pt[] =>
  along([[x, y], [x + w / 2, y - 4], [x + w + 3, y + 2], [x + w - 2, y + h / 2], [x + w + 2, y + h], [x + w / 2, y + h + 4], [x - 2, y + h - 1], [x + 3, y + h / 2], [x + 1, y + 4]]);
async function kept(page: Page) {
  await page.waitForTimeout(700);
  return page.evaluate(() => JSON.parse(localStorage.getItem("mermaidify.drawing.v1") || "null"));
}
/** Whether every point of a stroke lies on a box's outline: the clean shape a snap draws. */
const onBox = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.every(([x, y]) => Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1)) < 0.2);
};

test("a rough box held at its end snaps clean, and reads as a box", async ({ page }) => {
  await heldStroke(page, [roughBox(60, 60, 170, 80)]);
  const drawing = await kept(page);
  expect(drawing.strokes).toHaveLength(1);
  expect(onBox(drawing.strokes[0].pts)).toBe(true);
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\["Node 1"\]/);
});

test("a box drawn inside a box without lifting snaps twice, and reads as a box in a box", async ({ page }) => {
  const outer = roughBox(50, 50, 220, 120), inner = roughBox(66, 66, 188, 88);
  await heldStroke(page, [outer, [...along([outer[outer.length - 1], inner[0]]), ...inner]]);
  const drawing = await kept(page);
  // The way from the outer box to the inner one is left out: it only crossed the first box.
  expect(drawing.strokes).toHaveLength(2);
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\[\["Node 1"\]\]/);
});

test("a line held at its end becomes straight; a stroke lifted at once stays as drawn", async ({ page }) => {
  await heldStroke(page, [along([[60, 300], [160, 296], [260, 303]])]);
  await stroke(page, along([[60, 360], [160, 356], [260, 363]]), "pen");
  const drawing = await kept(page);
  expect(drawing.strokes[0].pts).toHaveLength(2);
  expect(drawing.strokes[1].pts.length).toBeGreaterThan(20);
});

test("snapping can be turned off, and stays off", async ({ page }) => {
  await page.locator("#more").click();
  const item = page.getByRole("menuitemcheckbox", { name: "Snap shapes and arrows when you hold" });
  await expect(item).toHaveAttribute("aria-checked", "true");
  await item.click();
  await heldStroke(page, [roughBox(60, 60, 170, 80)]);
  const drawing = await kept(page);
  expect(onBox(drawing.strokes[0].pts)).toBe(false);
  await page.reload();
  await page.locator("#more").click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Snap shapes and arrows when you hold" })).toHaveAttribute("aria-checked", "false");
});

test("any shape can take another look from its menu, and keeps it", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await expect(page.locator("#shape-A")).toHaveValue("rect");
  await page.locator("#shape-A").selectOption("hexagon");
  await expect(code(page)).toHaveValue(/A\{\{"Node 1"\}\}/);
  await expect(page.locator("#read")).toContainText("1 hexagon");
  // A new shape and a new reading keep the choice; so does a reload.
  await stroke(page, box(260, 300, 60, 40), "pen");
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/A\{\{"Node 1"\}\}/);
  await page.reload();
  await expect(code(page)).toHaveValue(/A\{\{"Node 1"\}\}/);
  await expect(page.locator("#shape-A")).toHaveValue("hexagon");
  // Saved drawings carry it too, and back to a box drops it.
  await page.locator("#more").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Save the drawing (.json)" }).click()]);
  expect(JSON.parse(await readFile((await file.path())!, "utf8")).shapes).toEqual({ A: "hexagon" });
  await page.locator("#shape-A").selectOption("rect");
  await expect(code(page)).toHaveValue(/A\["Node 1"\]/);
  expect((await kept(page)).shapes).toBeUndefined();
});

test("full screen gives the drawing the window, keeps every tool, and leaves for the diagram", async ({ page }) => {
  const vh = page.viewportSize()!.height;
  await page.locator("#full").click();
  await expect(page.locator("body")).toHaveClass(/is-full/);
  await expect(page.locator("#full")).toHaveAttribute("aria-pressed", "true");
  const pad = await page.locator("#pad").boundingBox();
  expect(pad!.height).toBeGreaterThan(vh - 170);
  for (const id of ["#undo", "#more", "#go", "#full"]) await expect(page.locator(id)).toBeInViewport();
  await expect(page.locator('label[for="ink-red"]')).toBeInViewport();
  await drawBoxToDiamond(page);
  await page.locator("#go").click();
  await expect(page.locator("#read")).toContainText("2 shapes");
  await page.locator("#read .to-result").click();
  await expect(page.locator("body")).not.toHaveClass(/is-full/);
  await expect(page.locator("#result")).toBeInViewport();
});

test("Escape and F leave and enter full screen", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard use");
  await page.keyboard.press("f");
  await expect(page.locator("body")).toHaveClass(/is-full/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/is-full/);
});

test("on a phone turned on its side, the tools and the drawing fit the screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a phone's size");
  await page.setViewportSize({ width: 915, height: 412 });
  await page.locator(".toolbar").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector(".toolbar")!.scrollIntoView({ block: "start" }));
  const bar = (await page.locator(".toolbar").boundingBox())!, pad = (await page.locator("#pad").boundingBox())!;
  expect(pad.y + pad.height - bar.y).toBeLessThanOrEqual(412);
  await page.locator("#full").click();
  const full = (await page.locator("#pad").boundingBox())!;
  expect(full.height).toBeGreaterThan(412 - 110);
  expect(full.y + full.height).toBeLessThanOrEqual(412);
});

// ─── the review's findings ─────────────────────────────────────────────────

test("a name and a look stay on their shape when more is drawn and the page closes before Mermaidify", async ({ page }) => {
  await stroke(page, box(60, 300, 160, 60), "pen");
  await mermaidify(page);
  await page.locator("#name-A").fill("Low");
  await page.locator("#shape-A").selectOption("hexagon");
  // A new box above it takes the letter A at the next reading; the page closes before that reading.
  await stroke(page, box(60, 60, 160, 60), "pen");
  await page.reload();
  await expect(code(page)).toHaveValue(/A\["Node 1"\]\n {2}B\{\{"Low"\}\}/);
});

test("the pen takes a palm's snapped shape away with the rest of the palm's stroke", async ({ page }) => {
  // Before any pen: a palm traces a loop and rests still, long enough to snap.
  const loop = roughBox(60, 260, 120, 70);
  await page.evaluate(
    (pts) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      const fire = (type: string, [x, y]: number[]) =>
        c.dispatchEvent(new PointerEvent(type, { pointerId: 21, pointerType: "touch", clientX: r.left + x, clientY: r.top + y, buttons: 1, bubbles: true, cancelable: true }));
      fire("pointerdown", pts[0]);
      for (const p of pts) fire("pointermove", p);
    },
    loop,
  );
  await page.waitForTimeout(700);
  await stroke(page, along([[60, 120], [260, 120]]), "pen");
  const drawing = await kept(page);
  expect(drawing.strokes).toHaveLength(1);
  expect(drawing.strokes[0].by).toBe("pen");
});

test("a long press with a finger or a pen opens no menu on the drawing; a mouse's right button still does", async ({ page }) => {
  const menu = (kind: string) =>
    page.evaluate((kind) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 31, pointerType: kind, clientX: r.left + 20, clientY: r.top + 20, button: kind === "mouse" ? 2 : 0, buttons: kind === "mouse" ? 2 : 1, bubbles: true }));
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      c.dispatchEvent(e);
      c.dispatchEvent(new PointerEvent("pointerup", { pointerId: 31, pointerType: kind, bubbles: true }));
      return e.defaultPrevented;
    }, kind);
  expect(await menu("touch")).toBe(true);
  expect(await menu("pen")).toBe(true);
  expect(await menu("mouse")).toBe(false);
});

test("full screen hides the rest of the page from the keyboard, and Escape closes an open menu first", async ({ page }) => {
  await page.locator("#full").click();
  for (const sel of [".site-header", ".result", ".site-footer"]) expect(await page.locator(sel).evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await expect(page.locator("#full")).toHaveAttribute("aria-label", "Full screen");
  await page.locator("#more").focus();
  await page.locator("#more").click();
  await expect(page.locator("#more-list")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#more-list")).toBeHidden();
  await expect(page.locator("body")).toHaveClass(/is-full/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/is-full/);
  expect(await page.locator(".result").evaluate((el) => (el as HTMLElement).inert)).toBe(false);
});

test("F pressed twice quickly, or held, leaves the page and the browser in step", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard use");
  await page.keyboard.press("f");
  await page.keyboard.press("f");
  await page.waitForTimeout(600);
  await expect(page.locator("body")).not.toHaveClass(/is-full/);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.keyboard.down("f");
  await page.keyboard.down("f");
  await page.keyboard.down("f");
  await page.keyboard.up("f");
  await expect(page.locator("body")).toHaveClass(/is-full/);
});

test("keys typed in a shape menu do not change the tool or the screen", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard use");
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#shape-A").focus();
  await page.keyboard.press("e");
  await page.keyboard.press("f");
  await expect(page.locator('[data-tool="draw"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("body")).not.toHaveClass(/is-full/);
});

test("a name field says its shape's new look", async ({ page }) => {
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await page.locator("#shape-A").selectOption("circle");
  await expect(page.locator("#name-A")).toHaveAttribute("aria-label", "Name for A, circle");
});

test("in full screen on a phone, See the diagram stays in sight after a long reading", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a phone's size");
  await page.locator("#full").click();
  await drawBoxToDiamond(page);
  // A line with no head, and a stray mark, make the longest line of what was read.
  await stroke(page, along([[140, 270], [140, 330]]), "pen");
  await stroke(page, circle(140, 380, 22), "pen");
  await stroke(page, along([[300, 420], [330, 440], [310, 470]]), "pen");
  await page.locator("#go").click();
  await expect(page.locator("#read")).toContainText("left out");
  const link = (await page.locator("#read .to-result").boundingBox())!, read = (await page.locator("#read").boundingBox())!;
  expect(link.y + link.height).toBeLessThanOrEqual(read.y + read.height + 1);
  await expect(page.locator("#read .to-result")).toBeInViewport({ ratio: 1 });
  // The outlines' switch is in More here.
  await page.locator("#more").click();
  await page.getByRole("menuitemcheckbox", { name: "Show what it read" }).click();
  await expect(page.locator("#show-read")).not.toBeChecked();
});

test("nothing runs off the side of a 320-pixel screen, in full screen or not", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator("#full").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page.locator("#go")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#full")).toBeInViewport({ ratio: 1 });
});

test("on common phones turned on their side, the tools, the drawing, and the line under it fit", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a phone's size");
  // After a reading, so the line under the drawing says the most it says.
  await page.locator("#hint-example").click();
  await expect(page.locator("#read")).toContainText("4 shapes");
  for (const [w, h] of [[568, 320], [667, 375], [740, 360], [844, 390], [915, 412]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(100);
    await page.evaluate(() => document.querySelector(".toolbar")!.scrollIntoView({ block: "start" }));
    const bar = (await page.locator(".toolbar").boundingBox())!, row = (await page.locator(".read-row").boundingBox())!;
    expect(row.y + row.height - bar.y, `${w} by ${h}`).toBeLessThanOrEqual(h);
  }
});

test("a name passed to a shape drawn again in its place is kept when the page closes before Mermaidify", async ({ page }) => {
  await stroke(page, box(60, 60, 160, 60), "pen");
  await mermaidify(page);
  await page.locator("#name-A").fill("Start");
  await page.locator('[data-tool="erase"]').click();
  await stroke(page, along([[55, 80], [65, 90]]), "pen");
  await page.locator('[data-tool="draw"]').click();
  await stroke(page, box(62, 62, 156, 58), "pen");
  await page.reload();
  await expect(code(page)).toHaveValue(/A\["Start"\]/);
});

test("the drawing is kept when the hand lifts, not while a stroke is under way", async ({ page }) => {
  await stroke(page, box(60, 60, 160, 60), "pen");
  await page.evaluate(async () => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    const fire = (type: string, x: number, b: number) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "pen", clientX: r.left + x, clientY: r.top + 300, buttons: b, bubbles: true, cancelable: true }));
    fire("pointerdown", 40, 1);
    for (let x = 40; x < 300; x += 12) {
      fire("pointermove", x, 1);
      await new Promise((go) => setTimeout(go, 45));
    }
    (window as unknown as { keptMidStroke: string | null }).keptMidStroke = localStorage.getItem("mermaidify.drawing.v1");
    fire("pointerup", 300, 0);
  });
  expect(await page.evaluate(() => (window as unknown as { keptMidStroke: string | null }).keptMidStroke)).toBeNull();
  expect((await kept(page)).strokes).toHaveLength(2);
});

test("in full screen, a plain message keeps to two lines like a reading does", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.locator("#full").click();
  await drawBoxToDiamond(page);
  await page.locator("#go").click();
  await expect(page.locator("#read")).toContainText("2 shapes");
  const before = (await page.locator(".read-row").boundingBox())!.height;
  await code(page).evaluate((el: HTMLTextAreaElement) => {
    el.value = "flowchart TD\n  X --> Y";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await stroke(page, [[140, 70], [140, 70]], "pen");
  await expect(page.locator("#read")).toContainText("You edited the code");
  expect((await page.locator(".read-row").boundingBox())!.height).toBeLessThanOrEqual(before + 1);
});

test("Ctrl and a click opens the menu and draws nothing, and a press the menu cut off ends when the mouse moves on", async ({ page }) => {
  await stroke(page, box(40, 40, 100, 60), "pen");
  await stroke(page, box(200, 40, 100, 60), "pen");
  const result = await page.evaluate(async () => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    const fire = (type: string, x: number, y: number, o: PointerEventInit = {}) => {
      const e = new PointerEvent(type, { pointerId: 41, pointerType: "mouse", clientX: r.left + x, clientY: r.top + y, button: 0, buttons: 1, bubbles: true, cancelable: true, ...o });
      c.dispatchEvent(e);
      return e;
    };
    const menu = () => {
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      c.dispatchEvent(e);
      return e.defaultPrevented;
    };
    // Ctrl and a click on a Mac: the menu opens, and the stroke it began is dropped.
    fire("pointerdown", 60, 200, { ctrlKey: true });
    const ctrlMenu = menu();
    for (let x = 60; x < 200; x += 10) fire("pointermove", x, 200, { buttons: 0 });
    // Ctrl held while drawing elsewhere opens no menu, so the stroke is drawn.
    fire("pointerdown", 60, 160, { ctrlKey: true });
    for (let x = 60; x < 200; x += 10) fire("pointermove", x, 160, { ctrlKey: true });
    fire("pointerup", 200, 160, { buttons: 0 });
    // A stroke under way keeps the menu shut; if the lift is lost anyway, moving with no button down ends the stroke.
    fire("pointerdown", 60, 240);
    for (let x = 60; x < 200; x += 10) fire("pointermove", x, 240);
    const midMenu = menu();
    fire("pointermove", 210, 240, { buttons: 0 });
    // The eraser the same way: a lost lift ends the erase, so passing over the boxes afterward marks nothing.
    (document.querySelector('[data-tool="erase"]') as HTMLButtonElement).click();
    fire("pointerdown", 20, 300, { pointerId: 42 });
    fire("pointermove", 22, 300, { pointerId: 42, buttons: 0 });
    for (let x = 40; x < 300; x += 6) fire("pointermove", x, 40, { pointerId: 42, buttons: 0 });
    fire("pointerdown", 20, 320, { pointerId: 43 });
    fire("pointerup", 20, 320, { pointerId: 43, buttons: 0 });
    return { ctrlMenu, midMenu };
  });
  expect(result).toEqual({ ctrlMenu: false, midMenu: true });
  const strokes = (await kept(page)).strokes;
  expect(strokes).toHaveLength(4);
  expect(strokes.slice(2).map((s: { by: string }) => s.by)).toEqual(["mouse", "mouse"]);
});

test("the drawing is not kept in the middle of a pan, only after it", async ({ page }) => {
  await page.evaluate(async () => {
    const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
    const fire = (type: string, x: number, y: number, o: PointerEventInit) =>
      c.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, ...o }));
    const pen = { pointerId: 51, pointerType: "pen", buttons: 1 };
    fire("pointerdown", 40, 60, pen);
    for (let x = 40; x < 240; x += 8) fire("pointermove", x, 60, pen);
    fire("pointerup", 240, 60, { ...pen, buttons: 0 });
    // The middle button pans; it is held for longer than the drawing waits before it is kept.
    const pan = { pointerId: 52, pointerType: "mouse", button: 1, buttons: 4 };
    fire("pointerdown", 100, 200, pan);
    for (let i = 0; i < 20; i++) {
      fire("pointermove", 100 + i * 3, 200, pan);
      await new Promise((go) => setTimeout(go, 50));
    }
    (window as unknown as { keptMidPan: string | null }).keptMidPan = localStorage.getItem("mermaidify.drawing.v1");
    fire("pointerup", 160, 200, { ...pan, buttons: 0 });
    // A pan whose release is lost ends when the mouse moves with no button down, so the next change is still kept.
    fire("pointerdown", 40, 100, pen);
    for (let x = 40; x < 240; x += 8) fire("pointermove", x, 100, pen);
    fire("pointerup", 240, 100, { ...pen, buttons: 0 });
    fire("pointerdown", 100, 200, pan);
    fire("pointermove", 120, 200, pan);
    fire("pointermove", 130, 200, { ...pan, buttons: 0 });
  });
  expect(await page.evaluate(() => (window as unknown as { keptMidPan: string | null }).keptMidPan)).toBeNull();
  expect((await kept(page)).strokes).toHaveLength(2);
});

test("on a phone on its side, a message and the kept-code note are not cut off", async ({ page, isMobile }) => {
  test.skip(!isMobile, "a phone's size");
  const whole = () => page.locator("#read > span").first().evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1);
  await page.setViewportSize({ width: 844, height: 390 });
  await drawBoxToDiamond(page);
  await mermaidify(page);
  await code(page).evaluate((el: HTMLTextAreaElement) => {
    el.value = "flowchart TD\n  X --> Y";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#go").click();
  await expect(page.locator("#read .kept")).toBeVisible();
  expect(await whole()).toBe(true);
  await page.setViewportSize({ width: 667, height: 375 });
  // A tap on a shape, which says names now change in the code; the resize may have moved the drawing, so a box is
  // drawn where the tap will be. A tap on an empty place only puts away what was read.
  await stroke(page, box(300, 30, 100, 50), "pen");
  await stroke(page, [[350, 55], [350, 55]], "pen");
  await expect(page.locator("#read")).toContainText("You edited the code");
  expect(await whole()).toBe(true);
  // A long reading on the narrowest phone: what is cut is the reading, never the note.
  await page.setViewportSize({ width: 568, height: 320 });
  await page.locator("#more").click();
  await page.getByRole("menuitem", { name: /example/i }).click();
  await code(page).evaluate((el: HTMLTextAreaElement) => {
    el.value = "flowchart TD\n  X --> Y";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#go").click();
  const [note, line] = await Promise.all([page.locator("#read .kept").boundingBox(), page.locator("#read > span").first().boundingBox()]);
  expect(note!.y + note!.height).toBeLessThanOrEqual(line!.y + line!.height + 1);
});
