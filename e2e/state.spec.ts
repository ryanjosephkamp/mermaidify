/** State diagrams on the Draw page: the choice, starts and ends, names, what each shape is, and keeping it all. */
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { along, arrowDown, box, circle, code, diamond, fresh, mermaidify, stroke, type Pt } from "./helpers.ts";

test.beforeEach(async ({ page }) => fresh(page));

/** A dot filled in with the pen: a tight scribble. */
const dot = (cx: number, cy: number, r: number): Pt[] =>
  Array.from({ length: 61 }, (_, i): Pt => {
    const a = i * 1.07, rr = r * (0.25 + 0.75 * Math.abs(Math.sin(i * 0.53)));
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  });

/** A start dot, two boxes, and an end, top to bottom. */
async function drawStates(page: Page) {
  await stroke(page, dot(130, 20, 7), "pen");
  await stroke(page, arrowDown(130, 32, 62), "pen");
  await stroke(page, box(70, 66, 120, 46), "pen");
  await stroke(page, arrowDown(130, 116, 162), "pen");
  await stroke(page, box(70, 166, 120, 46), "pen");
  await stroke(page, arrowDown(130, 216, 256), "pen");
  await stroke(page, circle(130, 274, 15), "pen");
  await stroke(page, dot(130, 274, 6), "pen");
}
async function readAsState(page: Page) {
  await page.locator("#diagram-kind").selectOption("state");
}

test("read as a state diagram, a dot starts it and a circle with a dot ends it", async ({ page }) => {
  await drawStates(page);
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/^flowchart/);
  await readAsState(page);
  await expect(code(page)).toHaveValue('stateDiagram-v2\n  direction TB\n  state "State 1" as A\n  state "State 2" as B\n  [*] --> A\n  A --> B\n  B --> [*]');
  await expect(page.locator("#read")).toContainText("2 states, 2 starts and ends · 3 transitions");
  await expect(page.locator("#diagram svg g.node").first()).toBeVisible();
  // The menu in More says the same.
  await page.locator("#more").click();
  await expect(page.locator('[data-act="state"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-act="flowchart"]')).toHaveAttribute("aria-checked", "false");
  await page.locator('[data-act="flowchart"]').click();
  await expect(code(page)).toHaveValue(/^flowchart/);
  await expect(page.locator("#diagram-kind")).toHaveValue("flowchart");
});

test("states and transitions take names, which follow them back to a flowchart", async ({ page }) => {
  await drawStates(page);
  await readAsState(page);
  await mermaidify(page);
  await page.locator("#name-A").fill("Paying");
  await page.locator("#name-L2").fill("paid");
  await expect(code(page)).toHaveValue(/state "Paying" as A\n {2}state "State 2" as B\n {2}\[\*\] --> A\n {2}A --> B : paid/);
  // A start or an end has no name, and no line style waits in a state diagram.
  await expect(page.locator("#names input[placeholder='No name']").first()).toBeDisabled();
  await expect(page.locator("#style-L2")).toHaveCount(0);
  await page.locator("#diagram-kind").selectOption("flowchart");
  await expect(code(page)).toHaveValue(/\["Paying"\][\s\S]*-->\|"paid"\|/);
});

test("a shape's menu makes it a choice, which keeps through a reload and in a saved file", async ({ page }) => {
  await drawStates(page);
  await readAsState(page);
  await mermaidify(page);
  await page.locator("#role-B").selectOption("choice");
  await expect(code(page)).toHaveValue(/state B <<choice>>/);
  await expect(page.locator("#name-B")).toBeDisabled();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator("#diagram-kind")).toHaveValue("state");
  await expect(code(page)).toHaveValue(/state B <<choice>>/);
  const saving = page.waitForEvent("download");
  await page.locator("#more").click();
  await page.locator('[data-act="save-drawing"]').click();
  const file = JSON.parse(await readFile(await (await saving).path(), "utf8"));
  expect(file.diagram).toBe("state");
  expect(file.roles).toEqual({ B: "choice" });
});

test("a diamond is read as a choice, and a tap on it says it takes no name", async ({ page }) => {
  await stroke(page, box(70, 30, 120, 46), "pen");
  await stroke(page, arrowDown(130, 80, 126), "pen");
  await stroke(page, diamond(130, 170, 100, 70), "pen");
  await stroke(page, along([[182, 170], [240, 170], [240, 226], [233, 216], [240, 226], [247, 216]]), "pen");
  await stroke(page, box(180, 230, 120, 46), "pen");
  await readAsState(page);
  await mermaidify(page);
  await expect(code(page)).toHaveValue(/state B <<choice>>/);
  await stroke(page, [[130, 170], [130, 170]], "pen");
  await expect(page.locator("#read")).toContainText("A choice has no name");
  await expect(page.locator("#name-edit")).toBeHidden();
});

test("a tap on a state in the diagram goes to its name", async ({ page }) => {
  await drawStates(page);
  await readAsState(page);
  await mermaidify(page);
  await page.locator("#diagram svg g.node", { hasText: "State 2" }).click();
  await expect(page.locator("#name-B")).toBeFocused();
});

test("with code edited by hand, Read as reads the drawing again and Rebuild writes the new kind", async ({ page }) => {
  await drawStates(page);
  await mermaidify(page);
  await code(page).fill("flowchart LR\n  X --> Y");
  await readAsState(page);
  await expect(code(page)).toHaveValue("flowchart LR\n  X --> Y");
  await expect(page.locator("#read")).toContainText("Your own code is kept");
  await expect(page.locator("#role-A")).toHaveCount(1);
  await page.locator("#rebuild").click();
  await expect(code(page)).toHaveValue(/^stateDiagram-v2/);
});

test("a shape's role keeps while the drawing reads as a flowchart, through a reload", async ({ page }) => {
  await drawStates(page);
  await readAsState(page);
  await mermaidify(page);
  await page.locator("#role-B").selectOption("choice");
  await page.locator("#diagram-kind").selectOption("flowchart");
  await expect(code(page)).toHaveValue(/^flowchart/);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator("#diagram-kind")).toHaveValue("flowchart");
  await page.locator("#diagram-kind").selectOption("state");
  await expect(code(page)).toHaveValue(/state B <<choice>>/);
});

test("a tap on a start opens no name box, and saves are named for a state diagram", async ({ page }) => {
  await drawStates(page);
  await readAsState(page);
  await mermaidify(page);
  await stroke(page, [[130, 20], [130, 20]], "pen");
  await expect(page.locator("#name-edit")).toBeHidden();
  const saving = page.waitForEvent("download");
  await page.locator("#save-mmd").click();
  expect((await saving).suggestedFilename()).toBe("state-diagram.mmd");
});
