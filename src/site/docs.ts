/**
 * The docs: their sections and pages, in the order the index lists them and the pages link on, and the pieces the
 * build writes into each page from this list (vite.config.ts): the title band, the contents list, the links to the
 * pages before and after, and the index's cards. A page is docs/<slug>/index.html.
 */

export interface DocPage {
  slug: string;
  title: string;
  /** One line: the page's card on the index, the line under its title, and its description. */
  summary: string;
  /** Cards for parts of the page, shown on the index in place of the page's own. */
  cards?: { anchor: string; title: string; summary: string }[];
}
export interface DocSection {
  id: string;
  title: string;
  pages: DocPage[];
}

export const DOCS: DocSection[] = [
  {
    id: "start",
    title: "Start",
    pages: [
      {
        slug: "quickstart",
        title: "Quickstart",
        summary: "Draw shapes and lines, press Mermaidify, name what it found, and copy the Mermaid or save the diagram.",
      },
      {
        slug: "drawing-tips",
        title: "Drawing for a clean reading",
        summary: "Habits that help the reader: closed shapes, lines that end near their shapes, small heads, clear dashes, and room to draw.",
      },
    ],
  },
  {
    id: "reference",
    title: "Reference",
    pages: [
      {
        slug: "shapes",
        title: "Shapes and lines it reads",
        summary: "Every shape and line the reader knows, the Mermaid it writes for each, and how to change a look or a style.",
      },
      {
        slug: "diagrams",
        title: "Flowcharts and state diagrams",
        summary: "What each kind of diagram shows, and how a drawing reads as a state diagram: starts, ends, choices, and groups.",
      },
      {
        slug: "tools",
        title: "Tools",
        summary: "Drawing with a pen, a finger, or a mouse; moving and zooming; the eraser's two kinds; choosing, moving, copying, and snapping strokes; adding shapes, arrows, and templates; names on the drawing; full screen; and the keys.",
      },
      {
        slug: "saving",
        title: "Saving and sharing",
        summary: "Copy the code, save it as a Mermaid file, save the diagram as SVG or PNG, embed it in a web page, use the site offline, and save the drawing to open again.",
      },
    ],
  },
  {
    id: "how-it-works",
    title: "How it works",
    pages: [
      {
        slug: "reader",
        title: "How the reader works",
        summary: "The five steps from strokes to Mermaid, with the sizes and limits each one uses.",
      },
      {
        slug: "accuracy",
        title: "How well it reads",
        summary: "The reader's scores on drawings people made and on generated drawings, measured on every build, and what they cannot tell you.",
      },
    ],
  },
  {
    id: "project",
    title: "Project",
    pages: [
      {
        slug: "about",
        title: "Privacy, limits, and credits",
        summary: "What stays on your device, what mermaidify cannot do yet, and the work it is built on.",
        cards: [
          { anchor: "privacy", title: "Privacy", summary: "Nothing you draw or type leaves your device, and the site uses no cookies, analytics, or third-party requests." },
          { anchor: "limits", title: "What it cannot do yet", summary: "Handwriting on the drawing, other kinds of diagram, and the parts of a state diagram it does not read." },
          { anchor: "credits", title: "Credits", summary: "Mermaid, the fonts, the icons, and the license." },
        ],
      },
    ],
  },
];

/** Every page in reading order, with its section's title. */
export const DOC_PAGES = DOCS.flatMap((section) => section.pages.map((page) => ({ ...page, section: section.title })));

/**
 * The anchors of the single How it works page the docs replaced, and where each now lives: a page and, when it is not
 * the top of the page, an anchor on it. how-it-works/ sends old links on with this.
 */
export const MOVED: Record<string, [string, string?]> = {
  use: ["quickstart"],
  write: ["quickstart", "write"],
  kinds: ["diagrams"],
  steps: ["reader"],
  shapes: ["shapes"],
  states: ["diagrams", "states"],
  snap: ["tools", "snap"],
  tips: ["drawing-tips"],
  measured: ["accuracy"],
  people: ["accuracy", "people"],
  "didi-drawings": ["accuracy", "didi-drawings"],
  "why-didi": ["accuracy", "why-didi"],
  scoring: ["accuracy", "scoring"],
  "cannot-tell": ["accuracy", "cannot-tell"],
  arrows: ["accuracy", "arrows"],
  generated: ["accuracy", "generated"],
  pens: ["tools", "pens"],
  saving: ["saving"],
  privacy: ["about", "privacy"],
  limits: ["about", "limits"],
  credits: ["about", "credits"],
};

const attr = (s: string) => s.replace(/&(?![#\w]+;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The index's sections of cards, with addresses relative to docs/. */
export function docsIndex(): string {
  const card = (href: string, title: string, summary: string) =>
    `<li><a class="card" href="${href}"><strong>${title}</strong><span>${summary}</span></a></li>`;
  return DOCS.map((section) => {
    const cards = section.pages.flatMap((page) =>
      page.cards ? page.cards.map((c) => card(`${page.slug}/#${c.anchor}`, c.title, c.summary)) : [card(`${page.slug}/`, page.title, page.summary)],
    );
    return `<section class="group" aria-labelledby="${section.id}"><h2 id="${section.id}">${section.title}</h2><ul class="cards">${cards.join("")}</ul></section>`;
  }).join("\n");
}

/** The script that sends an old How it works address on to its page in the docs, keeping ?theme=. */
export function movedScript(): string {
  return `<script>(()=>{const to=${JSON.stringify(MOVED)};const h=location.hash.slice(1);const [page,anchor]=Object.hasOwn(to,h)?to[h]:[];location.replace("../docs/"+(page?page+"/":"")+location.search+(anchor?"#"+anchor:""))})()</script>`;
}

const HEADING = /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/g;

/**
 * A page's headings with a # link on each, and its contents list, built from its h2s with the h3s under them. A
 * heading without an id gets one from its words. A page with fewer than two h2s has no list.
 */
export function contents(html: string): { html: string; toc: string } {
  const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));
  const tree: { id: string; text: string; under: { id: string; text: string }[] }[] = [];
  const out = html.replace(HEADING, (_, level: string, attrs: string, inner: string) => {
    const text = inner.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    let id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    if (!id) {
      const base = text.toLowerCase().replace(/&[#\w]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
      id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
      ids.add(id);
      attrs += ` id="${id}"`;
    }
    const entry = { id, text };
    if (level === "2" || !tree.length) tree.push({ ...entry, under: [] });
    else tree[tree.length - 1].under.push(entry);
    return `<h${level}${attrs}>${inner}<a class="anchor" href="#${id}" aria-label="Link to ${attr(text)}">#</a></h${level}>`;
  });
  const link = (e: { id: string; text: string }) => `<a href="#${e.id}">${e.text}</a>`;
  const toc =
    tree.length < 2
      ? ""
      : `<details class="toc"><summary>On this page</summary><ul>${tree
          .map((e) => `<li>${link(e)}${e.under.length ? `<ul>${e.under.map((u) => `<li>${link(u)}</li>`).join("")}</ul>` : ""}</li>`)
          .join("")}</ul></details>`;
  return { html: out, toc };
}

/**
 * Writes a doc page's own parts into it: its title and description, the title band with its section, the contents
 * list, and the links to the pages before and after it (the docs' index at either end).
 */
export function docPage(html: string, slug: string): string {
  const at = DOC_PAGES.findIndex((p) => p.slug === slug);
  if (at < 0) throw new Error(`docs/${slug}/ is not in the docs list (src/site/docs.ts)`);
  for (const mark of ["<!--doc-head-->", "<!--doc-hero-->", "<!--doc-toc-->", "<!--doc-pager-->"])
    if (!html.includes(mark)) throw new Error(`docs/${slug}/index.html has no ${mark}`);
  const page = DOC_PAGES[at], before = DOC_PAGES[at - 1], after = DOC_PAGES[at + 1];
  const { html: body, toc } = contents(html);
  const side = (rel: "prev" | "next", p: DocPage | undefined) =>
    p
      ? `<a class="${rel}" href="../${p.slug}/" rel="${rel}"><span>${rel === "prev" ? "Previous" : "Next"}</span><strong>${p.title}</strong></a>`
      : `<a class="${rel}" href="../"><span>Back to</span><strong>All docs</strong></a>`;
  return body
    .replace("<!--doc-head-->", () => `<title>${page.title} · mermaidify</title>\n    <meta name="description" content="${attr(page.summary)}" />`)
    .replace(
      "<!--doc-hero-->",
      () => `<div class="page-hero"><div class="site-wrap"><p class="page-chip">${page.section}</p><h1>${page.title}</h1><p>${page.summary}</p></div></div>`,
    )
    .replace("<!--doc-toc-->", () => toc)
    .replace(/(class="[^"]*page-body) has-toc/, toc ? "$1 has-toc" : "$1")
    .replace("<!--doc-pager-->", () => `<nav class="doc-pager" aria-label="More docs">${side("prev", before)}${side("next", after)}</nav>`);
}
