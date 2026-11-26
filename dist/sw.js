const CACHE = "draftbridge-shell-v1";
const ROOT = new URL("./", self.location);
const FILES = ["index.html", "styles.css", "config.js", "icon.svg", "app.mjs", "flow.mjs", "receipts.mjs", "flags.mjs", "vendor/flagsmith.mjs"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new URL(file, ROOT)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("draftbridge-shell-") && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== ROOT.origin) return;
  if (event.request.mode === "navigate" && [ROOT.pathname, new URL("index.html", ROOT).pathname].includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(new URL("index.html", ROOT))));
  } else if (FILES.some(file => new URL(file, ROOT).pathname === url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(url)));
  }
});
