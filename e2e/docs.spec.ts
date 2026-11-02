import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { DOC_PAGES, DOCS, MOVED } from "../src/site/docs.ts";

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("the docs' index lists every section and page, and reads at any width", async ({ page }) => {
  await page.goto("./docs/");
  await expect(page.locator("h1")).toHaveText("Docs");
  await expect(page.locator(".site-nav a[aria-current=page]")).toHaveText("Docs");
  await expect(page.locator(".group h2")).toHaveText(DOCS.map((s) => s.title));
  for (const section of DOCS) {
    const cards = page.locator(`.group:has(#${section.id}) .card`);
    const want = section.pages.flatMap((p) => (p.cards ? p.cards.map((c) => [`${p.slug}/#${c.anchor}`, c.title]) : [[`${p.slug}/`, p.title]]));
    await expect(cards.locator("strong")).toHaveText(want.map(([, title]) => title));
    for (const [i, [href]] of want.entries()) await expect(cards.nth(i)).toHaveAttribute("href", href);
  }
  await expect(page.locator(".site-footer")).toContainText("Made by");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

for (const [i, doc] of DOC_PAGES.entries()) {
  test(`${doc.title}: header, title, contents, links on, footer`, async ({ page }, info) => {
    await page.goto(`./docs/${doc.slug}/`);
    await expect(page).toHaveTitle(`${doc.title} · mermaidify`);
    await expect(page.locator(".site-nav a[aria-current=true]")).toHaveText("Docs");
    await expect(page.locator(".page-hero .page-chip")).toHaveText(doc.section);
    await expect(page.locator(".page-hero h1")).toHaveText(doc.title);

    // The contents list: one link per h2 and h3, each to a heading on the page; open beside the column on a wide screen.
    const toc = page.locator("details.toc");
    const headings = page.locator(".doc h2[id], .doc h3[id]");
    const ids = await headings.evaluateAll((hs) => hs.map((h) => h.id));
    expect(ids.length).toBeGreaterThanOrEqual(2);
    await expect(toc.locator("a")).toHaveCount(ids.length);
    expect(await toc.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual(ids.map((id) => "#" + id));
    await expect(headings.locator("a.anchor")).toHaveCount(ids.length);
    if (info.project.name === "desktop") await expect(toc).toHaveAttribute("open", "");
    else {
      await expect(toc).not.toHaveAttribute("open", "");
      await toc.locator("summary").click();
    }
    await toc.locator("a").last().click();
    await expect(page).toHaveURL(new RegExp(`#${ids[ids.length - 1]}$`));
    await expect(page.locator(`[id="${ids[ids.length - 1]}"]`)).toBeInViewport();

    // The pages before and after, and the docs' index at either end.
    const pager = page.locator(".doc-pager");
    await expect(pager.locator(".prev")).toHaveAttribute("href", DOC_PAGES[i - 1] ? `../${DOC_PAGES[i - 1].slug}/` : "../");
    await expect(pager.locator(".next")).toHaveAttribute("href", DOC_PAGES[i + 1] ? `../${DOC_PAGES[i + 1].slug}/` : "../");

    await expect(page.locator(".site-footer")).toContainText("Made by");
    await expect(page.locator(".site-footer a", { hasText: "Privacy" })).toHaveAttribute("href", "../../docs/about/#privacy");
    await expect(page.locator("body")).not.toContainText("missing figure");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
}

test("no doc scrolls sideways on a narrow phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ["docs/", ...DOC_PAGES.map((p) => `docs/${p.slug}/`), "how-it-works/"]) {
    await page.goto("./" + path);
    expect(await sideways(page), path).toBeLessThanOrEqual(0);
  }
});

test("How well it reads prints this build's figures", async ({ page }) => {
  await page.goto("./docs/accuracy/");
  const people = page.locator("#people + p + .table-wrap"), generated = page.locator("#generated + p + .table-wrap");
  await expect(people).toContainText(/Shapes found\s*[\d,]+ of [\d,]+ \(\d+\.\d%\)\s*\d+(\.\d)?%/);
  await expect(generated).toContainText(/Shapes read right\s*[\d,]+ of [\d,]+ \(\d+\.\d%\)\s*\d+(\.\d)?%/);
  await expect(page.locator("#cannot-tell + ul")).toContainText(/within about \d+\.\d points either way/);
});

test("the old How it works address and its anchors lead to the docs", async ({ page }) => {
  await page.goto("./how-it-works/");
  await expect(page).toHaveURL(/\/docs\/$/);
  await expect(page.locator("h1")).toHaveText("Docs");
  for (const [from, [slug, anchor]] of Object.entries(MOVED)) {
    await page.goto(`./how-it-works/#${from}`);
    await expect(page, `#${from}`).toHaveURL(new RegExp(`/docs/${slug}/${anchor ? "#" + anchor : ""}$`));
    if (anchor) await expect(page.locator(`[id="${anchor}"]`)).toBeInViewport();
  }
  await page.goto("./how-it-works/?theme=ember#credits");
  await expect(page).toHaveURL(/\/docs\/about\/\?theme=ember#credits$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");
  await page.goto("./how-it-works/#nothing-here");
  await expect(page).toHaveURL(/\/docs\/$/);
});

test("the old address is kept out of search, and says where the docs went without scripts", async ({ request }) => {
  const html = await (await request.get("./how-it-works/")).text();
  expect(html).toContain('<meta name="robots" content="noindex" />');
  expect(html).toContain('<noscript><meta http-equiv="refresh" content="0; url=../docs/" /></noscript>');
  expect(html).toContain('<a href="../docs/">Go to the docs</a>');
});

test("the Copy button copies a code block", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./docs/shapes/");
  await page.locator(".code-bar button").first().click();
  await expect(page.locator(".code-bar button").first()).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^flowchart TD/);
});

test("the not-found page has the credit row and addresses that work at any depth", () => {
  const html = readFileSync(resolve(import.meta.dirname, "../dist/404.html"), "utf8");
  expect(html).toContain("Made by");
  expect(html).toContain("Sponsor on GitHub");
  expect(html).toContain('content="noindex"');
  expect(html).not.toMatch(/(?:href|src)="\.{1,2}\//);
  expect(html).toContain('src="/mermaidify/assets/');
});
