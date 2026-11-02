/**
 * The docs: the header's script, a Copy button on each code block, the contents list opened beside a wide column, and
 * the offline worker.
 */
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/chrome.css";
import "../styles/doc.css";

import { keepOffline } from "../offline/register.ts";
import { initChrome } from "../site/theme.ts";

initChrome();
// Each doc is two folders below the site's root, as docs/<page>/, and the docs' index one.
keepOffline(/\/docs\/[\w-]+\/(index\.html)?$/.test(location.pathname) ? "../../" : "../");

const toc = document.querySelector<HTMLDetailsElement>("details.toc");
if (toc && matchMedia("(min-width: 980px)").matches) toc.open = true;

for (const block of document.querySelectorAll<HTMLElement>(".doc .code")) {
  const code = block.querySelector("code");
  if (!code) continue;
  const bar = document.createElement("div"), label = document.createElement("span"), button = document.createElement("button");
  const said = document.createElement("span");
  bar.className = "code-bar";
  label.textContent = block.dataset.lang ?? "";
  button.type = "button";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy this code");
  said.className = "sr-only";
  said.setAttribute("role", "status");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = (text: string) => {
    button.textContent = text;
    said.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.textContent = "Copy";
      said.textContent = "";
    }, 1800);
  };
  button.addEventListener("click", () => {
    navigator.clipboard.writeText(code.textContent!.replace(/\n$/, "")).then(
      () => done("Copied"),
      () => done("Select and copy"),
    );
  });
  bar.append(label, button, said);
  block.prepend(bar);
}
