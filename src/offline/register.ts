/**
 * Registers the service worker (sw.js, at the site's root), so the site works offline once any page of it has been
 * opened. Not in a frame, under test, or on the dev server's port, where a built copy's worker would go on serving its
 * files to the dev server.
 */
export function keepOffline(root: string) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !isSecureContext || window.top !== window || navigator.webdriver) return;
  if (location.port === "4371") return;
  addEventListener("load", () => navigator.serviceWorker.register(new URL("sw.js", new URL(root, location.href))).catch(() => {}));
}
