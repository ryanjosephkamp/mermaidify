/**
 * The embed page: the diagram whose Mermaid code its address carries, drawn as the Draw page draws it, in the look the
 * code was copied in, and fitted to its frame.
 */
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/embed.css";

import { THEMES } from "../site/chrome.ts";
import { render } from "./diagram.ts";
import { unpack } from "./share.ts";

const box = document.getElementById("embed")!;
function note(text: string) {
  const p = document.createElement("p");
  p.className = "embed-note";
  p.textContent = text;
  box.replaceChildren(p);
}

async function show() {
  const q = new URLSearchParams(location.hash.slice(1)), look = q.get("theme"), packed = q.get("code");
  // A look other than the first comes from the site's looks file, as on the site's own pages.
  if (look && THEMES.slice(1).some((t) => t.id === look)) {
    document.documentElement.dataset.theme = look;
    if (!document.querySelector("link[data-site-looks]")) {
      const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "../assets/site-looks.v1.css" });
      link.dataset.siteLooks = "";
      await new Promise((done) => {
        link.onload = link.onerror = done;
        document.head.append(link);
      });
    }
  }
  if (!packed) return note("There is no diagram in this address.");
  let code: string;
  try {
    code = await unpack(packed);
  } catch {
    return note("The diagram in this address could not be read. Copy the embed code again.");
  }
  const r = await render(code, { handDrawn: q.get("look") === "hand", locked: true });
  if ("stale" in r) return;
  if (!r.ok) return note("Mermaid can't draw this diagram: " + r.error);
  box.innerHTML = r.svg;
  document.title = /^\s*stateDiagram/.test(code) ? "State diagram" : "Flowchart";
  fit();
}

/**
 * A diagram fits the frame's width, unless that would shrink it past reading, as a wide one in a narrow frame: then it
 * keeps to a little over half its size, and the frame scrolls sideways.
 */
function fit() {
  const svg = box.querySelector("svg"), vb = svg?.viewBox.baseVal;
  if (!svg || !vb?.width) return;
  const least = 0.55 * vb.width, wide = box.clientWidth - 24 < least;
  box.classList.toggle("wide", wide);
  svg.style.width = wide ? `${least}px` : "";
  svg.style.maxWidth = wide ? "none" : "";
}
addEventListener("resize", fit);
show().catch(() => note("Mermaid did not load. Check the connection and reload."));
addEventListener("hashchange", () => void show());
