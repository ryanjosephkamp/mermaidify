/**
 * Mermaid, loaded the first time a diagram is drawn and served from this site, drawn in the page's look. Mermaid
 * reads colors only in the older forms (hex and rgb), so the look's colors are measured into hex first.
 */
import type { Mermaid } from "mermaid";

let loading: Promise<Mermaid> | null = null;
/** Starts loading Mermaid, once; drawing calls this early so the first diagram does not wait. */
export const loadMermaid = (): Promise<Mermaid> => {
  loading ??= import("mermaid").then((m) => m.default);
  loading.catch(() => (loading = null));
  return loading;
};

const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
/** A CSS color as #rrggbb, whatever form the stylesheet wrote it in. */
export function hex(color: string, fallback = "#000000"): string {
  if (!color) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
const token = (name: string) => hex(getComputedStyle(document.documentElement).getPropertyValue(name).trim());

export interface Look {
  handDrawn: boolean;
  /**
   * The code is someone else's, from a web address: settings written in it may not change the look's CSS, colors, or
   * fonts, which could make the page fetch files from elsewhere.
   */
  locked?: boolean;
}
/** Mermaid's own list of settings that code may not change, and with `locked`, those that could reach elsewhere. */
const SECURE = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges"];
const LOCKED = [...SECURE, "themeCSS", "themeVariables", "fontFamily", "altFontFamily"];

/** The colors the diagram is drawn in, from the page's look. */
export function palette() {
  return {
    surface: token("--surface"),
    surface2: token("--surface-2"),
    ink: token("--ink"),
    ink2: token("--ink-2"),
    line: token("--line-strong"),
    accent: token("--accent"),
    accentSoft: token("--accent-soft"),
  };
}

function configure(mermaid: Mermaid, look: Look) {
  const c = palette(), font = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    look: look.handDrawn ? "handDrawn" : "classic",
    secure: look.locked ? LOCKED : SECURE,
    fontFamily: font,
    flowchart: { curve: "basis", padding: 12 },
    themeVariables: {
      fontFamily: font,
      fontSize: "15px",
      background: c.surface,
      primaryColor: c.accentSoft,
      primaryBorderColor: c.accent,
      primaryTextColor: c.ink,
      lineColor: c.ink2,
      textColor: c.ink,
      clusterBkg: c.surface2,
      clusterBorder: c.line,
      secondaryColor: c.surface2,
      tertiaryColor: c.surface,
      edgeLabelBackground: c.surface,
    },
  });
}

let renders = 0;
/** Makes any render still under way report itself stale, so it cannot show an older diagram. */
export const cancelRenders = () => void renders++;
export type Rendered = { ok: true; svg: string } | { ok: false; error: string } | { ok: false; stale: true };

/** Draws Mermaid text as SVG. A newer call wins: an older one that finishes later reports itself stale. */
export async function render(code: string, look: Look): Promise<Rendered> {
  const mine = ++renders;
  const mermaid = await loadMermaid();
  // Mermaid measures each label as it lays it out, so the page's font has to be there first.
  await Promise.race([document.fonts.load('15px "Atkinson Hyperlegible Next"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  if (mine !== renders) return { ok: false, stale: true };
  configure(mermaid, look);
  try {
    const { svg } = await mermaid.render("mmd-" + mine, code);
    return mine === renders ? { ok: true, svg } : { ok: false, stale: true };
  } catch (e) {
    // A failed render can leave its scratch element behind.
    document.getElementById("dmmd-" + mine)?.remove();
    document.getElementById("mmd-" + mine)?.remove();
    if (mine !== renders) return { ok: false, stale: true };
    const message = String((e as Error)?.message ?? e).split("\n").slice(0, 4).join(" ").replace(/\s+/g, " ").trim();
    return { ok: false, error: message };
  }
}
