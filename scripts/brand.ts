/**
 * Draws the site's raster images from the mark in public/favicon.svg: the home-screen icons (192 and 512 pixels, and a
 * maskable 512 with room around the mark) and the 1200 by 630 link-preview image.
 *
 *   node scripts/brand.ts
 *
 * It needs the Chromium that Playwright uses (npx playwright install chromium).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const root = join(import.meta.dirname, "..");
const mark = readFileSync(join(root, "public/favicon.svg"), "utf8");
const font = (file: string) => readFileSync(join(root, "public/assets/fonts", file)).toString("base64");
const faces = `@font-face{font-family:A;src:url(data:font/woff2;base64,${font("atkinson-hyperlegible-next.v1.woff2")}) format("woff2");font-weight:400 800}
@font-face{font-family:M;src:url(data:font/woff2;base64,${font("atkinson-hyperlegible-mono.v1.woff2")}) format("woff2");font-weight:400 700}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function icon(size: number, file: string, maskable = false) {
  // A maskable icon is cut to a circle or a squircle by the phone, so the mark sits inside the middle 80% on the tile's
  // own color, and the tile's rounded corners are left to the phone.
  const tile = /<rect [^>]*fill="([^"]+)"/.exec(mark)![1];
  const svg = maskable ? mark.replace(/(<rect [^>]*)rx="[\d.]+"/, '$1rx="0"') : mark;
  const inner = maskable ? `<div style="width:${size}px;height:${size}px;background:${tile};display:grid;place-items:center"><div style="width:${size * 0.72}px;height:${size * 0.72}px">${svg}</div></div>` : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style><div style="width:${size}px;height:${size}px">${inner}</div>`);
  await page.screenshot({ path: join(root, "public", file), omitBackground: !maskable });
}

await icon(192, "icon-192.png");
await icon(512, "icon-512.png");
await icon(512, "icon-maskable-512.png", true);

// The link preview: the mark and the name on the night, and a sketch beside the flowchart it becomes.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>${faces}
html,body{margin:0}
.og{box-sizing:border-box;width:1200px;height:630px;padding:72px 80px;background:#04161d;color:#ecf5f7;font-family:A;display:grid;grid-template-columns:1fr 430px;gap:48px;align-items:center}
.brand{display:flex;align-items:center;gap:20px;font-size:64px;font-weight:800;letter-spacing:-0.03em}
.brand svg{width:84px;height:84px}
h1{margin:36px 0 0;font-size:42px;line-height:1.12;font-weight:750;letter-spacing:-0.02em;text-wrap:balance}
p{margin:22px 0 0;color:#a6bcc3;font-size:26px;line-height:1.4}
.art{width:430px;height:470px}
</style>
<div class="og"><div><div class="brand">${mark}<span>mermaidify</span></div><h1>Sketch a flowchart. Get Mermaid.</h1><p>With a finger, a pen, or a mouse, in your browser.</p></div>
<svg class="art" viewBox="0 0 430 470" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="#ecf5f7" stroke-width="3.2" opacity="0.92">
    <path d="M60 41 161 38.5l2 54.5-106 1.5 1-49"/>
    <path d="M110 96c1 18 0 34-1 52M100 136l9 13 9-12"/>
    <path d="M110 160 168 210 110 262 52 210Z"/>
    <path d="M110 266c0 20 1 38 0 56M101 310l9 12 9-12"/>
    <circle cx="110" cy="356" r="30"/><circle cx="110" cy="356" r="18"/>
  </g>
  <path d="M196 210h40M226 198l12 12-12 12" stroke="#5fd6e6" stroke-width="3.5"/>
  <g font-family="A" font-size="17" font-weight="600" text-anchor="middle">
    <rect x="270" y="40" width="140" height="52" rx="4" fill="#123845" stroke="#5fd6e6" stroke-width="2"/><text x="340" y="72" fill="#ecf5f7">Write the draft</text>
    <path d="M340 92v58" stroke="#a6bcc3" stroke-width="2"/><path d="M334 142l6 8 6-8" stroke="#a6bcc3" stroke-width="2"/>
    <path d="M340 154 404 210 340 266 276 210Z" fill="#123845" stroke="#5fd6e6" stroke-width="2"/><text x="340" y="216" fill="#ecf5f7">Good enough?</text>
    <path d="M340 266v52" stroke="#a6bcc3" stroke-width="2"/><path d="M334 310l6 8 6-8" stroke="#a6bcc3" stroke-width="2"/>
    <circle cx="340" cy="356" r="32" fill="#123845" stroke="#5fd6e6" stroke-width="2"/><circle cx="340" cy="356" r="25" stroke="#5fd6e6" stroke-width="2"/><text x="340" y="362" fill="#ecf5f7">Ship</text>
  </g>
  <g font-family="M" font-size="15" fill="#a6bcc3"><text x="270" y="430">flowchart TD</text><text x="270" y="452">  A --&gt; B --&gt; C</text></g>
</svg></div>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, "public/og.png") });
await browser.close();
console.log("wrote public/icon-192.png, icon-512.png, icon-maskable-512.png, and og.png");
