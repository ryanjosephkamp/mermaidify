/**
 * The header's script, on every page: folds the links under a Menu button on a narrow screen and runs the theme menu.
 * The pages read the same without it. After grooph's site script.
 */
import { THEME_KEY } from "./chrome.ts";

/** Called whenever the look changes, so a page can redraw what it paints itself. */
export function initChrome(onTheme?: () => void): void {
  const root = document.documentElement;
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header) return;

  // The Menu button: the links fold under it below 861 px (chrome.css).
  const menu = header.querySelector<HTMLButtonElement>(".site-menu-toggle")!;
  const nav = header.querySelector<HTMLElement>(".site-nav")!;
  const fold = (open: boolean) => {
    nav.classList.toggle("is-open", open);
    menu.setAttribute("aria-expanded", String(open));
  };
  menu.hidden = false;
  header.classList.add("has-menu");
  menu.addEventListener("click", () => fold(menu.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", () => fold(false));
  header.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.getAttribute("aria-expanded") !== "true") return;
    fold(false);
    menu.focus();
  });

  // The theme menu, a menu button: arrows move, Enter or Space chooses, Escape closes. The choice is kept in this
  // browser; the script in the head applies it before the first paint.
  const theme = header.querySelector<HTMLElement>(".site-theme")!;
  const toggle = theme.querySelector<HTMLButtonElement>(".site-theme-toggle")!;
  const list = theme.querySelector<HTMLElement>(".site-theme-list")!;
  const items = Array.from(list.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
  const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const show = (id: string | null) => {
    const chosen = items.find((item) => item.dataset.themeId === id) ?? items[0];
    if (chosen === items[0]) delete root.dataset.theme;
    else root.dataset.theme = chosen.dataset.themeId;
    for (const item of items) item.setAttribute("aria-checked", String(item === chosen));
    toggle.setAttribute("aria-label", "Theme: " + chosen.textContent!.trim());
    if (bar) bar.content = getComputedStyle(header).backgroundColor;
    return chosen;
  };
  const close = (focus: boolean) => {
    if (list.hidden) return;
    list.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (focus) toggle.focus();
  };
  // The looks after the first are a stylesheet of their own: linked by the head when one was kept, and here the first
  // time one is chosen. A look is put on once its colors are here, or once the file could not be had.
  const looks = (then: () => void) => {
    let sheet = document.querySelector<HTMLLinkElement>("link[data-site-looks]");
    if (sheet && (sheet.sheet || sheet.dataset.siteLooks === "tried")) return then();
    if (!sheet) {
      sheet = document.createElement("link");
      sheet.rel = "stylesheet";
      sheet.dataset.siteLooks = "";
      sheet.href = theme.dataset.looks!;
      document.head.append(sheet);
    }
    const done = () => {
      sheet!.dataset.siteLooks = "tried";
      then();
    };
    sheet.addEventListener("load", done, { once: true });
    sheet.addEventListener("error", done, { once: true });
  };
  const open = () => {
    looks(() => {});
    list.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    (list.querySelector<HTMLElement>('[aria-checked="true"]') ?? items[0]).focus();
  };
  theme.hidden = false;
  show(root.dataset.theme ?? null);
  toggle.addEventListener("click", () => (list.hidden ? open() : close(false)));
  toggle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
    }
  });
  const choose = (item: HTMLButtonElement) => {
    const id = show(item.dataset.themeId!).dataset.themeId!;
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {}
    // A ?theme= in the address would bring the old choice back on the next load.
    const url = new URL(location.href);
    if (url.searchParams.has("theme")) {
      url.searchParams.delete("theme");
      history.replaceState(history.state, "", url);
    }
    close(true);
    onTheme?.();
  };
  list.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLButtonElement>("[role=menuitemradio]");
    if (item) looks(() => choose(item));
  });
  list.addEventListener("keydown", (event) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const to =
      event.key === "ArrowDown" ? (at + 1) % items.length
      : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : -1;
    if (to >= 0) {
      event.preventDefault();
      items[to].focus();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  });
  // A press, not a click: a phone's browser sends no click for a tap on text.
  document.addEventListener("pointerdown", (event) => {
    if (!(event.target as Element).closest(".site-theme")) close(false);
  });
  // The system's light or dark setting changes the colors too.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (bar) bar.content = getComputedStyle(header).backgroundColor;
    onTheme?.();
  });
}
