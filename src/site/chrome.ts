/**
 * The header and the footer of every page, written into the HTML at build time (vite.config.ts), after grooph's site:
 * a night bar with the mark, the links, and the theme menu, and the site footer. The client side, which folds the
 * links under a Menu button and runs the theme menu, is theme.ts.
 */

export const SITE = {
  name: "mermaidify",
  url: "https://ryanjosephkamp.github.io/mermaidify/",
  repo: "https://github.com/ryanjosephkamp/mermaidify",
};

/** The looks the theme menu offers. The first is the page as it loads; the rest are site-looks.v1.css. */
export const THEMES = [
  { id: "mermaidify", label: "Lagoon", dot: "#5fd6e6" },
  { id: "meteor", label: "Meteor", dot: "oklch(0.9 0.2 124)" },
  { id: "harbor", label: "Harbor", dot: "#7fb8ff" },
  { id: "plum", label: "Plum", dot: "#d4a8ff" },
  { id: "ember", label: "Ember", dot: "#ffa564" },
  { id: "graphite", label: "Graphite", dot: "#d4d4d8" },
];
export const THEME_KEY = "mermaidifyTheme";

export const SOCIAL = [
  { href: "https://ryanjosephkamp.github.io/", name: "Ryan Kamp’s website", title: "Website", icon: "globe" },
  { href: "https://github.com/ryanjosephkamp/", name: "Ryan Kamp on GitHub", title: "GitHub", icon: "github" },
  { href: "https://www.linkedin.com/in/rjk1999", name: "Ryan Kamp on LinkedIn", title: "LinkedIn", icon: "linkedin" },
  { href: "https://x.com/ryanjosephkamp", name: "Ryan Kamp on X", title: "X", icon: "x" },
  { href: "https://m.youtube.com/@RyanJosephKamp", name: "Ryan Kamp on YouTube", title: "YouTube", icon: "youtube" },
];
export const SPONSOR = "https://github.com/sponsors/ryanjosephkamp";

/** The mark: a mermaid reaching up to three bubbles, on a tile of the night. Colored by chrome.css. */
export const MARK =
  '<svg viewBox="0 0 1000 1000" aria-hidden="true"><rect width="1000" height="1000" rx="266"/><path d="M254 100q-16 5-18 21 1 15 15 20h12q13-5 15-17 1-16-14-23zm-76 42q-13 2-23 12c-12 16-7 41 11 50q6 4 15 3 11 1 19-5c13-8 18-24 12-39-5-14-19-23-34-21m74 56c-9 1-14 11-10 19 7 13 26 8 26-6q-1-15-16-13m-125 9q-4 0 0 21c4 21 8 28 32 48 9 8 12 12 14 23v3l1 3 1 5 4 23v4l1 3 7 25 2 7 6 11c8 15 17 21 39 30l28 9c28 8 36 12 38 18q3 5-1 9-14 18-12 34c1 9 7 21 16 27l2 3 1 6 3 7 1 5 3 8 1 5 1 4c3 10 2 24-1 32l-6 11a139 139 0 0 0-18 100q3 20 13 41l13 26 15 23a300 300 0 0 0 86 79l14 8 4 2 29 14a342 342 0 0 0 255 2l20-10 3-2 10-6 10-7 2-1c8-6 24-20 30-28l3-4c6-6 14-18 19-27l4-6 1-1 1-3 3-4 2-5 3-5 1-1 3-4c10-16 20-25 46-42 12-8 18-14 27-22l12-14q11-13 16-27c7-19 9-28 9-47 0-15-2-28-6-47l-3-15q-3-20-2-35l3-19q2-3-3-1l-4 1-5 2-4 1-3 1-3 1-11 6-10 5-3 2c-34 19-59 49-67 79l-1 3q-6 25-1 53v5l1 4 1 4 2 7 1 8 1 6 1 11-8-20-2-6-3-8-3-8-1-3-1-2-15-29-4-5q-13-20-36-35l-4-2-3-2q-23-13-65-24l-11-3-13-3-1 3 1 3 1 3 6 15 7 16v1l2 3 2 5 2 8 2 7 1 2 7 22 2 6 8 17a129 129 0 0 0 70 55l2 1 3 1c1 0 12 6 15 9q26 21 6 52-13 18-36 35l-21 12-10 4-2 1-21 7-2 1-12 3-16 2c-10 2-12 2-23 2q-21 0-41-5l-6-1-3-1-17-6-32-19c-9-7-24-22-31-33l-2-2-8-12-6-14-2-5-2-3-1-5-4-11-2-6-1-4-1-5-5-19-2-7-1-7-5-18-1-4-3-10-1-1-8-17-3-6c-7-11-12-16-21-23q-9-8-32-20c-18-10-23-16-23-26 0-8 3-14 19-37l18-29 1-2 30 57 2 3 2 4 9 14a637 637 0 0 0 58 51l10 7 14 11c8 8 12 10 24 13 6 2 20 3 27 2 6-1 8-1 14 3l8 6 3 3 1 1 6 2q3 0 3-3 0-4-6-13-10-16-22-21c-6-3-11-4-26-6s-20-4-27-12l-19-23-12-15-3-3-12-13c-15-14-14-14-20-27l-1-2-2-4-1-4-3-7-3-12-2-6-2-6v-3l-2-6-1-7-2-6c-3-15-4-19-8-27-5-10-11-15-27-24q-30-16-34-45c-3-16 1-33 10-43q5-5 5-10v-3l-3-5c-3-5-3-7-5-14q-3-18 4-35 2-5 3 1 4 8 14 18c17 18 20 30 14 59l1 23q3 17 13 30 8 9 21 18c10 7 12 8 15 12q9 9 15 28l2 6 1 3v1l1 2 5 12q7 11 17 18l2 1 10 4 12 2h24c10-1 13-2 22-5l16-9c12-8 19-15 35-35 12-15 18-21 27-27 17-11 38-12 52-3 10 6 14 18 10 27q-2 5 1 3 9 0 18-7 16-10 22-39v-22l-1-6-3-11c-5-13-16-31-27-40-9-8-13-10-22-15-21-11-50-14-73-8l-38 16-8 4-3 1-7 3h-1l-12 3c-7 2-19 1-26-1-14-4-20-10-37-36l-16-23a81 81 0 0 0-78-32c-25 5-39 13-51 28l-9 9q-6 3-16 3-6 1-7 4l1 6q2 6-3 9-4 1-3 5l-2 3-1 1v4q0 4-4 8-3 7 0 13l17 9q19 4 16 22c0 5-3 14-5 19q-5 12-9 14-4 3-12-1-14-6-28-8l-20-2-16-2-4-1c-9-1-27-7-36-11h-2l-8-5-7-10-1-2-9-14-14-31v-1l-1-2-1-2-4-13q-2-6-2-15l-1-11q-3-10-9-20l-1-2-2-3-1-2-9-11q-3-1-4 3-1 5 3 12l2 7-1 3c-1 0-8-3-11-6q-12-8-18-24-4-10-9-12z"/></svg>';

const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXTERNAL =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 3.5h5v5M16.5 3.5l-7 7M14.5 12v3.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const icon = (root: string, id: string) => `<svg aria-hidden="true"><use href="${root}assets/site-icons.v1.svg#${id}"/></svg>`;

export type Page = "draw" | "docs";
const NAV: { page?: Page; label: string; href: (root: string) => string }[] = [
  { page: "draw", label: "Draw", href: (root) => root },
  { page: "docs", label: "Docs", href: (root) => root + "docs/" },
  { label: "GitHub", href: () => SITE.repo },
];

/**
 * The header. The Menu button and the theme menu are shown by the script; without it the links wrap. `here` marks the
 * current link: "page" on the page it names, "true" on a page under it, such as a doc under Docs.
 */
export function header(root: string, current: Page, here: "page" | "true" = "page"): string {
  const links = NAV.map((item) => {
    const outside = !item.page;
    return `<li><a href="${item.href(root)}"${item.page === current ? ` aria-current="${here}"` : ""}${outside ? ' rel="noopener"' : ""}>${item.label}${outside ? `${EXTERNAL}<span class="sr-only"> (opens GitHub)</span>` : ""}</a></li>`;
  }).join("");
  const themes = THEMES.map(
    (t, i) =>
      `<li role="none"><button type="button" role="menuitemradio" aria-checked="${i === 0}" tabindex="-1" data-theme-id="${t.id}"><span class="site-theme-dot" style="--dot:${t.dot}" aria-hidden="true"></span>${t.label}${CHECK}</button></li>`,
  ).join("");
  return `<header class="site-header"><div class="site-wrap"><a class="site-logo" href="${root}">${MARK}<span>mermaidify</span></a><button class="site-menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M3.5 10h13M3.5 14h13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Menu</button><nav class="site-nav" id="site-nav" aria-label="mermaidify"><ul>${links}</ul></nav><div class="site-theme" data-looks="${root}assets/site-looks.v1.css" hidden><button class="site-theme-toggle" type="button" aria-label="Theme: ${THEMES[0].label}" aria-haspopup="menu" aria-expanded="false" aria-controls="site-theme-list"><span class="site-theme-dot" aria-hidden="true"></span><span class="site-theme-label">Theme</span></button><ul class="site-theme-list" id="site-theme-list" role="menu" aria-label="Theme" hidden>${themes}</ul></div></div></header>`;
}

/** The site footer, as on grooph's site. */
export function footer(root: string): string {
  const column = (title: string, links: { label: string; href: string }[]) =>
    `<div><h2>${title}</h2><ul>${links.map((l) => `<li><a href="${l.href}"${/^https?:/.test(l.href) ? ' rel="noopener"' : ""}>${l.label}</a></li>`).join("")}</ul></div>`;
  const social = SOCIAL.map((s) => `<li><a href="${s.href}" aria-label="${s.name}" title="${s.title}">${icon(root, s.icon)}</a></li>`).join("");
  return `<footer class="site-footer"><div class="site-wrap"><div><a class="site-logo" href="${root}">${MARK}<span>mermaidify</span></a><p>Sketch a flowchart or a state diagram with a finger, a pen, or a mouse, and get Mermaid. Your drawings stay in this browser on this device. Nothing is sent anywhere.</p></div>${column("Use it", [
    { label: "Draw", href: root },
    { label: "Docs", href: root + "docs/" },
    { label: "Shapes it reads", href: root + "docs/shapes/" },
  ])}${column("Help and contact", [
    { label: "Source code", href: SITE.repo },
    { label: "Report a bug or suggest a feature", href: SITE.repo + "/issues" },
    { label: "Privacy", href: root + "docs/about/#privacy" },
  ])}<div class="site-credit"><p class="site-made">Made by <a href="${SOCIAL[0].href}">Ryan Kamp</a></p><ul class="site-social" aria-label="Ryan Kamp online">${social}</ul><a class="site-sponsor" href="${SPONSOR}">${icon(root, "heart")}Sponsor on GitHub</a></div><p class="site-fine">Free to use; sponsorship is optional and never unlocks anything. MIT license, © 2026 Ryan Kamp. This site uses no cookies, analytics, or third-party requests. Diagrams are drawn by <a href="https://mermaid.js.org/" rel="noopener">Mermaid</a> (MIT). Fonts: Atkinson Hyperlegible Next and Mono, SIL Open Font License. <a href="${root}docs/about/#credits">Credits</a>.</p></div></footer>`;
}

/** Before the first paint: ?theme= wins and is kept, then the kept choice; a look after the first brings its stylesheet. */
export function themeScript(root: string): string {
  return `(()=>{const ids=${JSON.stringify(THEMES.map((t) => t.id))};let id=new URLSearchParams(location.search).get("theme");try{if(ids.includes(id))localStorage.setItem("${THEME_KEY}",id);else id=localStorage.getItem("${THEME_KEY}")}catch{}if(ids.indexOf(id)>0){document.documentElement.dataset.theme=id;document.write('<link rel="stylesheet" data-site-looks href="${root}assets/site-looks.v1.css">')}})()`;
}
