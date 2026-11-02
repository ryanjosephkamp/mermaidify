import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";

import { contents, DOC_PAGES, docPage, MOVED } from "../src/site/docs.ts";

const ROOT = resolve(import.meta.dirname, "..");
const source = (slug: string) => readFileSync(resolve(ROOT, "docs", slug, "index.html"), "utf8");
const ids = (html: string) => new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));

describe("the docs", () => {
  test("every docs folder is in the docs list, and every page in the list has a folder", () => {
    const folders = globSync("docs/*/index.html", { cwd: ROOT }).map((f) => f.split(/[\\/]/)[1]).sort();
    assert.deepEqual(folders, DOC_PAGES.map((p) => p.slug).sort());
  });

  test("the contents list is the h2s, with the h3s under them, and every heading gets a # link", () => {
    const { html, toc } = contents('<h2 id="a">One</h2><p>x</p><h3>Two &amp; more</h3><h2>Three <code>3</code></h2><h3 id="b">Four</h3>');
    assert.equal(
      toc,
      '<details class="toc"><summary>On this page</summary><ul><li><a href="#a">One</a><ul><li><a href="#two-more">Two &amp; more</a></li></ul></li><li><a href="#three-3">Three 3</a><ul><li><a href="#b">Four</a></li></ul></li></ul></details>',
    );
    assert.match(html, /<h2 id="a">One<a class="anchor" href="#a" aria-label="Link to One">#<\/a><\/h2>/);
    assert.match(html, /<h3 id="two-more">Two &amp; more<a class="anchor" href="#two-more"/);
    assert.equal(contents('<h2 id="x">Only one</h2>').toc, "", "a page with one h2 has no list");
    assert.equal(contents('<p id="one">x</p><h2>One</h2><h2>One</h2>').html.match(/id="one-2"/g)?.length, 1, "ids stay unique");
  });

  test("each page has its parts and links to the pages before and after it", () => {
    for (const [i, page] of DOC_PAGES.entries()) {
      const html = docPage(source(page.slug), page.slug);
      assert.doesNotMatch(html, /<!--doc-/, page.slug);
      assert.match(html, new RegExp(`<p class="page-chip">${page.section}</p><h1>${page.title}</h1>`), page.slug);
      assert.match(html, /<details class="toc">/, `${page.slug} has a contents list`);
      const prev = DOC_PAGES[i - 1]?.slug, next = DOC_PAGES[i + 1]?.slug;
      assert.match(html, new RegExp(`<a class="prev" href="../${prev ? prev + "/" : ""}"`), page.slug);
      assert.match(html, new RegExp(`<a class="next" href="../${next ? next + "/" : ""}"`), page.slug);
    }
  });

  test("every link inside the docs reaches a page and an anchor that exist", () => {
    for (const page of DOC_PAGES) {
      const html = docPage(source(page.slug), page.slug);
      for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [path, anchor] = href.split("#");
        const target = path === "" ? html : path === "../" ? readFileSync(resolve(ROOT, "docs/index.html"), "utf8") : null;
        const slug = /^\.\.\/([\w-]+)\/$/.exec(path)?.[1];
        assert.ok(target !== null || (slug && existsSync(resolve(ROOT, "docs", slug, "index.html"))), `${page.slug}: ${href}`);
        if (anchor) assert.ok(ids(slug ? docPage(source(slug), slug) : target!).has(anchor), `${page.slug}: ${href}`);
      }
    }
  });

  test("every old How it works anchor leads to a page and an anchor that exist", () => {
    const old = ["use", "write", "kinds", "steps", "shapes", "states", "snap", "tips", "measured", "people", "didi-drawings", "why-didi", "scoring", "cannot-tell", "arrows", "generated", "pens", "saving", "privacy", "limits", "credits"];
    assert.deepEqual(Object.keys(MOVED).sort(), old.sort());
    for (const [from, [slug, anchor]] of Object.entries(MOVED)) {
      assert.ok(DOC_PAGES.some((p) => p.slug === slug), from);
      if (anchor) assert.ok(ids(source(slug)).has(anchor), `#${from} -> ${slug}/#${anchor}`);
    }
  });
});
