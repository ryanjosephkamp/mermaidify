/**
 * Saving the diagram. Mermaid writes each label as HTML inside the SVG, which draws every character right on screen
 * but which many editors cannot open and which a browser will not paint into a PNG. So the saved SVG and the PNG
 * carry the same labels as plain SVG text, placed line by line where the browser laid them out.
 */

import { hex } from "./diagram.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Line {
  text: string;
  x: number;
  y: number;
}

/** The lines of text inside an element as the browser laid them out: each line's text and center, on the screen. */
function linesOf(el: Element): Line[] {
  const range = document.createRange(), lines: { top: number; bottom: number; left: number; right: number; text: string }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getClientRects()[0];
      if (!r || (!r.width && /\s/.test(text[i]))) {
        if (lines.length) lines[lines.length - 1].text += text[i];
        continue;
      }
      const last = lines[lines.length - 1];
      if (last && Math.abs(r.top - last.top) < r.height / 2) {
        last.text += text[i];
        last.left = Math.min(last.left, r.left);
        last.right = Math.max(last.right, r.right);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: text[i] });
    }
  }
  return lines.map((l) => ({ text: l.text.trim(), x: (l.left + l.right) / 2, y: (l.top + l.bottom) / 2 })).filter((l) => l.text);
}

export interface Portable {
  /** The SVG as a file: plain text labels, a size, and a background. */
  text: string;
  width: number;
  height: number;
}

/**
 * The shown diagram as a file. `fontFaces` is CSS put inside the SVG (the PNG embeds the fonts so the picture is drawn
 * in them); `background` fills the picture behind the diagram.
 */
export function portableSvg(shown: SVGSVGElement, background: string, fontFaces = ""): Portable {
  const copy = shown.cloneNode(true) as SVGSVGElement;
  const live = Array.from(shown.querySelectorAll("foreignObject")), copies = Array.from(copy.querySelectorAll("foreignObject"));
  live.forEach((fo, i) => {
    const target = copies[i], label = fo.firstElementChild;
    if (!target || !label) return;
    // The text goes in the label's frame, so the screen is mapped back into that frame's own units. The label is laid
    // out in those units already, so its font size needs no scaling.
    const frame = (fo.parentNode as SVGGraphicsElement).getScreenCTM();
    if (!frame) return;
    const back = frame.inverse();
    // The look is the shown text's own: the innermost element that holds it, not the frame around it.
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    let holder: Element = label;
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if (n.textContent?.trim() && n.parentElement) {
        holder = n.parentElement;
        break;
      }
    const style = getComputedStyle(holder), color = hex(style.color, "#000000");
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-family", style.fontFamily);
    text.setAttribute("font-size", parseFloat(style.fontSize).toFixed(2));
    text.setAttribute("font-weight", style.fontWeight);
    text.setAttribute("fill", color);
    // A colored shape's style also outlines and fills everything inside it, so the text holds its own colors.
    text.setAttribute("style", `white-space:pre;fill:${color} !important;stroke:none !important`);
    for (const line of linesOf(label)) {
      const t = document.createElementNS(SVG_NS, "tspan"), p = new DOMPoint(line.x, line.y).matrixTransform(back);
      t.setAttribute("x", p.x.toFixed(2));
      t.setAttribute("y", p.y.toFixed(2));
      t.textContent = line.text;
      text.append(t);
    }
    target.replaceWith(text);
  });
  const vb = (copy.getAttribute("viewBox") || "0 0 800 600").split(/[\s,]+/).map(Number);
  const [x, y, w, h] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 800, 600];
  copy.setAttribute("xmlns", SVG_NS);
  copy.setAttribute("width", String(Math.ceil(w)));
  copy.setAttribute("height", String(Math.ceil(h)));
  copy.removeAttribute("style");
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(x));
  bg.setAttribute("y", String(y));
  bg.setAttribute("width", String(w));
  bg.setAttribute("height", String(h));
  bg.setAttribute("fill", background);
  copy.insertBefore(bg, copy.firstChild);
  if (fontFaces) {
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = fontFaces;
    copy.insertBefore(style, copy.firstChild);
  }
  return { text: new XMLSerializer().serializeToString(copy), width: w, height: h };
}

const fontData = new Map<string, Promise<string>>();
/** A font file of the site as a data address, for a picture that has to carry its own fonts. */
function dataUrl(url: string): Promise<string> {
  let p = fontData.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
      .then((b) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(b);
      }));
    p.catch(() => fontData.delete(url));
    fontData.set(url, p);
  }
  return p;
}

/** The site's two text faces as @font-face rules with the files inside, or nothing when they cannot be fetched. */
export async function embeddedFonts(base: URL): Promise<string> {
  const faces: [string, string, string][] = [
    ["Atkinson Hyperlegible Next", "assets/fonts/atkinson-hyperlegible-next.v1.woff2", "400 800"],
    ["Atkinson Hyperlegible Mono", "assets/fonts/atkinson-hyperlegible-mono.v1.woff2", "400 700"],
  ];
  try {
    const urls = await Promise.all(faces.map(([, file]) => dataUrl(new URL(file, base).href)));
    return faces.map(([family, , weight], i) => `@font-face{font-family:"${family}";src:url(${urls[i]}) format("woff2");font-weight:${weight}}`).join("");
  } catch {
    return "";
  }
}

/** The portable SVG painted at `scale` times its size. */
export async function toPng(p: Portable, scale = 2): Promise<Blob> {
  const img = new Image(), url = URL.createObjectURL(new Blob([p.text], { type: "image/svg+xml" }));
  try {
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(p.width * scale);
    canvas.height = Math.ceil(p.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be made."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A page that hosts mermaidify can take the files it saves: set `window.mermaidifyHost = { save(name, blob) }`, and
 * return true when the file was taken. Otherwise the browser downloads it.
 */
export interface Host {
  save?(filename: string, blob: Blob): Promise<boolean> | boolean;
}
declare global {
  interface Window {
    mermaidifyHost?: Host;
  }
}

/** Hands a file to the person: through the host page when there is one, or as a download. */
export async function saveFile(filename: string, blob: Blob): Promise<"saved" | "declined"> {
  const host = window.mermaidifyHost;
  if (host?.save) return (await host.save(filename, blob)) ? "saved" : "declined";
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "saved";
}
