// The Service Worker of one version of the PWA (D19 4.4). Its scope is the
// path of its version (/v/<版>/), its cache holds the files of that version
// alone, under a name of that path, and it takes no request outside them:
// another origin, another version, or a file not of the list goes to the
// network as the page asked it. A version is never written again, so its
// cache is never refreshed in place. The files taken out (save/<id>, D19
// 4.5) go from the page's port to the download as they come and are never
// put in the cache.
const BASE = new URL("./", self.location).pathname;
const CACHE = "homecloud" + BASE;
const SAVE = BASE + "save/";

// The downloads the page told of, each taken by one request: id -> {name, size, port}.
const saves = new Map();

// FILES are the files of the version, relative to BASE (cmd/pwabuild writes
// these, and its test checks that the list is the same).
const FILES = [
  "app.js",
  "files.json",
  "homecloud.wasm",
  "i/index.html",
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "messages.json",
  "save.js",
  "style.css",
  "wasm_exec.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A page of the version tells of a download (save.js): its port gives the
// chunks, one each time the stream asks for one.
self.addEventListener("message", (event) => {
  const m = event.data || {};
  const port = event.ports[0];
  if (m.type !== "hc-save" || !port || typeof m.id !== "string" || !event.source || !sameVersion(event.source.url)) {
    return;
  }
  saves.set(m.id, { name: String(m.name), size: Number(m.size), port });
  setTimeout(() => saves.delete(m.id), 60000); // one never asked for
  port.postMessage({ ready: true });
});

function sameVersion(u) {
  const url = new URL(u);
  return url.origin === self.location.origin && url.pathname.startsWith(BASE);
}

// saved is the answer of a download told of: the bytes of the port as they
// come, not stored (no-store) and never put in the cache.
function saved(s) {
  let ctl;
  let wake = null;
  const stream = new ReadableStream(
    {
      start(c) {
        ctl = c;
        s.port.onmessage = (e) => {
          const m = e.data || {};
          if (m.chunk) ctl.enqueue(m.chunk);
          else if (m.done) ctl.close();
          else if (m.abort) ctl.error(new Error("the file was not taken out"));
          if (wake) {
            wake();
            wake = null;
          }
        };
      },
      pull() {
        s.port.postMessage({ pull: true });
        return new Promise((r) => (wake = r));
      },
      cancel() {
        s.port.postMessage({ cancel: true });
      },
    },
    { highWaterMark: 1 },
  );
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(s.name),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (Number.isSafeInteger(s.size) && s.size >= 0) headers["Content-Length"] = String(s.size);
  return new Response(stream, { headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) {
    return;
  }
  if (url.pathname.startsWith(SAVE)) {
    const id = url.pathname.slice(SAVE.length);
    const s = saves.get(id);
    saves.delete(id);
    event.respondWith(s ? saved(s) : new Response("", { status: 404, headers: { "Cache-Control": "no-store" } }));
    return;
  }
  // A page of the version (the invitation's /v/<版>/i too) is the app.
  const name = req.mode === "navigate" ? "index.html" : url.pathname.slice(BASE.length);
  if (!FILES.includes(name)) {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(name)).then((hit) => hit || fetch(req)),
  );
});
