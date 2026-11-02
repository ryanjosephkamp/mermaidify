import { createHash } from "node:crypto";
import { globSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

import { footer, header, SITE, themeScript, type Page } from "./src/site/chrome.ts";
import { DOC_PAGES, docPage, docsIndex, movedScript } from "./src/site/docs.ts";
import { benchFigures, measuredFigures } from "./scripts/figures.ts";

/** Every page of the site: the Draw page, the embed page, the docs' index and each doc, the old How it works address, and the page shown for an unknown address. */
function pages(): Record<string, string> {
  const docs = globSync("docs/*/index.html", { cwd: import.meta.dirname }).map((file) => file.split(/[\\/]/)[1]).sort();
  const listed = DOC_PAGES.map((p) => p.slug).sort();
  if (docs.join() !== listed.join()) throw new Error(`The docs folders (${docs.join(", ")}) and the docs list in src/site/docs.ts (${listed.join(", ")}) differ`);
  return Object.fromEntries(
    [["draw", "index.html"], ["embed", "embed/index.html"], ["docs", "docs/index.html"], ["how", "how-it-works/index.html"], ["notfound", "404.html"], ...docs.map((slug) => [`docs-${slug}`, `docs/${slug}/index.html`])].map(
      ([name, file]) => [name, resolve(import.meta.dirname, file)],
    ),
  );
}

/**
 * Writes the header, the footer, and the head's shared tags into each page; each doc's title band, contents list, and
 * links on (src/site/docs.ts); the docs' index cards; and the measured figures.
 */
function site(): Plugin {
  let figures: Record<string, string> | null = null;
  return {
    name: "mermaidify-site",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        // The page's folder from the site's root, such as "" or "docs/shapes/", and the way back up to the root.
        // The not-found page is served for an unknown address at any depth, so its addresses start at the site's path.
        const notFound = ctx.path === "/404.html";
        const dir = notFound ? "" : ctx.path.replace(/^\//, "").replace(/index\.html$/, "");
        const depth = dir.split("/").filter(Boolean).length;
        const root = notFound ? new URL(SITE.url).pathname : depth ? "../".repeat(depth) : "./";
        const slug = /^docs\/([\w-]+)\/$/.exec(dir)?.[1];
        const page = (m: string) => m as Page;
        const head = () => {
          const url = SITE.url + dir;
          return [
            '<meta name="color-scheme" content="light dark" />',
            '<meta name="theme-color" content="#04161d" />',
            ...(notFound ? [] : [`<link rel="canonical" href="${url}" />`]),
            `<link rel="icon" href="${root}favicon.svg" type="image/svg+xml" />`,
            `<link rel="apple-touch-icon" href="${root}icon-192.png" />`,
            `<link rel="manifest" href="${root}manifest.webmanifest" />`,
            `<link rel="preload" href="${root}assets/fonts/atkinson-hyperlegible-next.v1.woff2" as="font" type="font/woff2" crossorigin />`,
            '<meta property="og:type" content="website" />',
            '<meta property="og:site_name" content="mermaidify" />',
            `<meta property="og:url" content="${url}" />`,
            `<meta property="og:image" content="${SITE.url}og.png" />`,
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
            '<meta name="twitter:card" content="summary_large_image" />',
            `<script>${themeScript(root)}</script>`,
          ].join("\n    ");
        };
        // A page's header link is the current page on the page it names, and marked as current on the pages under it.
        const here = dir === "" || dir === "docs/" ? "page" : "true";
        let out = slug ? docPage(html, slug) : html;
        out = out
          .replace("<!--docs-index-->", docsIndex)
          .replace("<!--docs-moved-->", movedScript)
          .replace(/<!--root-->/g, root)
          .replace(/<!--site-head:(\w+)-->/, head)
          .replace(/<!--site-header:(\w+)-->/, (_, p) => header(root, page(p), here))
          .replace(/<!--site-footer:(\w+)-->/, () => footer(root));
        if (out.includes("<!--figure:")) {
          figures ??= { ...benchFigures(), ...measuredFigures() };
          out = out.replace(/<!--figure:([\w-]+)-->/g, (_, k) => figures![k] ?? `(missing figure ${k})`);
        }
        return out;
      },
    },
  };
}

/** The not-found page's scripts and stylesheets, from the site's path, since it is served at any depth. */
function notFoundAddresses(): Plugin {
  return {
    name: "mermaidify-not-found",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.path !== "/404.html") return html;
        return html.replace(/(href|src)="\.\//g, `$1="${new URL(SITE.url).pathname}`);
      },
    },
  };
}

/**
 * The service worker (src/offline/sw.js), written into the build with the list of the build's files and a version made
 * from their contents, so the site works offline once opened and each new build replaces the last. The social image is
 * left out: no page shows it.
 */
function offline(): Plugin {
  let outDir = "";
  return {
    name: "mermaidify-offline",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const files = globSync("**/*", { cwd: outDir })
        .map((f) => f.split(/[\\/]/).join("/"))
        .filter((f) => f !== "sw.js" && f !== "og.png" && statSync(resolve(outDir, f)).isFile())
        .sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(resolve(outDir, f)));
      const worker = readFileSync(resolve(import.meta.dirname, "src/offline/sw.js"), "utf8")
        .replace('"__VERSION__"', JSON.stringify(hash.digest("hex").slice(0, 16)))
        .replace("__FILES__", JSON.stringify(files));
      writeFileSync(resolve(outDir, "sw.js"), worker);
    },
  };
}

export default defineConfig({
  // Relative addresses, so the same build works at any path: a project site, a subfolder, or a local file server.
  base: "./",
  plugins: [site(), notFoundAddresses(), offline()],
  build: {
    target: "es2022",
    // Mermaid's layout engines are large, and each loads only when a diagram needs it.
    chunkSizeWarningLimit: 1600,
    rollupOptions: { input: pages() },
  },
  server: { port: 4371, strictPort: true },
  preview: { port: 4371, strictPort: true },
});
