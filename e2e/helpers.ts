/** Drawing on the page the way a person would: pointer events along a path, from a pen, a finger, or a mouse. */
import { expect, type Page } from "@playwright/test";

export type Pt = [number, number];
export type Kind = "mouse" | "pen" | "touch";

const ids: Record<Kind, number> = { mouse: 1, pen: 7, touch: 11 };

/** One stroke along the points, in CSS pixels from the drawing's top-left corner. */
export async function stroke(page: Page, pts: Pt[], kind: Kind = "pen", opts: { buttons?: number; pointerId?: number } = {}) {
  await page.evaluate(
    ({ pts, kind, id, buttons }) => {
      const c = document.getElementById("pad")!, r = c.getBoundingClientRect();
      const fire = (type: string, [x, y]: [number, number], b: number) =>
        c.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: kind,
            isPrimary: true,
            clientX: r.left + x,
            clientY: r.top + y,
            button: type === "pointermove" ? -1 : 0,
            buttons: b,
            pressure: b ? 0.5 : 0,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire("pointerdown", pts[0], buttons);
      for (const p of pts.slice(1)) fire("pointermove", p, buttons);
      fire("pointerup", pts[pts.length - 1], 0);
    },
    { pts, kind, id: opts.pointerId ?? ids[kind], buttons: opts.buttons ?? 1 },
  );
}

/** Points every few pixels along a polyline. */
export function along(path: Pt[], step = 3): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = [path[i], path[i + 1]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(path[path.length - 1]);
  return out;
}
export const box = (x: number, y: number, w: number, h: number) => along([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + 3]]);
export const diamond = (cx: number, cy: number, w: number, h: number) =>
  along([[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy], [cx + 2, cy - h / 2 + 2]]);
export function circle(cx: number, cy: number, r: number): Pt[] {
  return Array.from({ length: 70 }, (_, i): Pt => [cx + r * Math.cos((i / 64) * 2 * Math.PI), cy + r * Math.sin((i / 64) * 2 * Math.PI)]);
}
/** A line down from (x, y0) to (x, y1) with a hook for its head. */
export const arrowDown = (x: number, y0: number, y1: number) => along([[x, y0], [x, y1], [x - 7, y1 - 10], [x, y1], [x + 7, y1 - 10]]);

/** A box over a diamond, joined by an arrow: the smallest flowchart worth reading. */
export async function drawBoxToDiamond(page: Page, kind: Kind = "pen") {
  await stroke(page, box(60, 40, 160, 60), kind);
  await stroke(page, diamond(140, 220, 150, 90), kind);
  await stroke(page, arrowDown(140, 104, 172), kind);
}

export const code = (page: Page) => page.locator("#code");
export async function mermaidify(page: Page) {
  await page.locator("#go").click();
  await expect(page.locator("#diagram svg")).toBeVisible({ timeout: 15_000 });
}
/** Starts each test on an empty page: nothing kept from another test. */
export async function fresh(page: Page) {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#hint")).toBeVisible();
}

/** Picks the eraser that takes only what it passes over: the eraser, tapped again, and that kind from its menu. */
export async function partEraser(page: Page) {
  const eraser = page.locator('button[data-tool="erase"]');
  if ((await eraser.getAttribute("aria-checked")) !== "true") await eraser.click();
  await eraser.click();
  await page.locator('#tool-menu [data-kind="part"]').click();
  await expect(page.locator("#pad")).toHaveAttribute("data-tool", "cut");
}
