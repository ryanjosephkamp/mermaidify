/*
 * The service worker that lets the site work offline. It keeps every file of the build in a cache of its own once the
 * site has been opened: pages come from the network when there is one, so a new version shows at once, and from the
 * cache when there is none; every other file, named for its contents, comes from the cache first. The build writes
 * the list of files and a version made from their contents in place of the two names below, so each new build is a
 * new worker, which replaces the old one and its cache.
 */
const VERSION = "__VERSION__";
const FILES = __FILES__;
// Each copy of the site under one address keeps a cache of its own.
const PREFIX = "mermaidify:" + new URL(self.registration.scope).pathname + ":";
const CACHE = PREFIX + VERSION;
const kept = new Set(FILES.map((f) => new URL(f, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Each file fresh from the site, never from the browser's own cache, which may still hold the last version's pages.
      .then((cache) => cache.addAll([...kept].map((href) => new Request(href, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.hash = "";
  url.search = "";
  // A folder's address is its index page, with or without its last slash.
  if (url.pathname.endsWith("/")) url.pathname += "index.html";
  else if (!kept.has(url.href) && kept.has(url.href + "/index.html")) url.pathname += "/index.html";
  if (!kept.has(url.href)) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(url.href, { cacheName: CACHE }).then((hit) => hit ?? Response.error())));
    return;
  }
  event.respondWith(caches.match(url.href, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)));
});
