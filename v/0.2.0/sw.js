// The Service Worker of one version of the PWA (D19 4.4). Its scope is the
// path of its version (/v/<版>/), its cache holds the files of that version
// alone, under a name of that path, and it takes no request outside them:
// another origin, another version, or a file not of the lists goes to the
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
  "pdfjs/build/pdf.min.mjs",
  "pdfjs/build/pdf.worker.min.mjs",
  "save.js",
  "style.css",
  "wasm_exec.js",
];

// LAZY are the other files of pdf.js in the version (D19b 2.3), relative to
// BASE: not taken by the install, but when pdf.js asks for one, and then kept
// in the cache of the version. They are pdf.js's own, never a file of the
// family (D19 4.5). The test of cmd/pwabuild checks that FILES and LAZY are
// the files of the version.
const LAZY = [
  "pdfjs/LICENSE",
  "pdfjs/SHA256SUMS",
  "pdfjs/SOURCE.md",
  "pdfjs/cmaps/78-EUC-H.bcmap",
  "pdfjs/cmaps/78-EUC-V.bcmap",
  "pdfjs/cmaps/78-H.bcmap",
  "pdfjs/cmaps/78-RKSJ-H.bcmap",
  "pdfjs/cmaps/78-RKSJ-V.bcmap",
  "pdfjs/cmaps/78-V.bcmap",
  "pdfjs/cmaps/78ms-RKSJ-H.bcmap",
  "pdfjs/cmaps/78ms-RKSJ-V.bcmap",
  "pdfjs/cmaps/83pv-RKSJ-H.bcmap",
  "pdfjs/cmaps/90ms-RKSJ-H.bcmap",
  "pdfjs/cmaps/90ms-RKSJ-V.bcmap",
  "pdfjs/cmaps/90msp-RKSJ-H.bcmap",
  "pdfjs/cmaps/90msp-RKSJ-V.bcmap",
  "pdfjs/cmaps/90pv-RKSJ-H.bcmap",
  "pdfjs/cmaps/90pv-RKSJ-V.bcmap",
  "pdfjs/cmaps/Add-H.bcmap",
  "pdfjs/cmaps/Add-RKSJ-H.bcmap",
  "pdfjs/cmaps/Add-RKSJ-V.bcmap",
  "pdfjs/cmaps/Add-V.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-0.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-1.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-2.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-3.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-4.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-5.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-6.bcmap",
  "pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap",
  "pdfjs/cmaps/Adobe-GB1-0.bcmap",
  "pdfjs/cmaps/Adobe-GB1-1.bcmap",
  "pdfjs/cmaps/Adobe-GB1-2.bcmap",
  "pdfjs/cmaps/Adobe-GB1-3.bcmap",
  "pdfjs/cmaps/Adobe-GB1-4.bcmap",
  "pdfjs/cmaps/Adobe-GB1-5.bcmap",
  "pdfjs/cmaps/Adobe-GB1-UCS2.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-0.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-1.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-2.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-3.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-4.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-5.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-6.bcmap",
  "pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap",
  "pdfjs/cmaps/Adobe-Korea1-0.bcmap",
  "pdfjs/cmaps/Adobe-Korea1-1.bcmap",
  "pdfjs/cmaps/Adobe-Korea1-2.bcmap",
  "pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap",
  "pdfjs/cmaps/B5-H.bcmap",
  "pdfjs/cmaps/B5-V.bcmap",
  "pdfjs/cmaps/B5pc-H.bcmap",
  "pdfjs/cmaps/B5pc-V.bcmap",
  "pdfjs/cmaps/CNS-EUC-H.bcmap",
  "pdfjs/cmaps/CNS-EUC-V.bcmap",
  "pdfjs/cmaps/CNS1-H.bcmap",
  "pdfjs/cmaps/CNS1-V.bcmap",
  "pdfjs/cmaps/CNS2-H.bcmap",
  "pdfjs/cmaps/CNS2-V.bcmap",
  "pdfjs/cmaps/ETHK-B5-H.bcmap",
  "pdfjs/cmaps/ETHK-B5-V.bcmap",
  "pdfjs/cmaps/ETen-B5-H.bcmap",
  "pdfjs/cmaps/ETen-B5-V.bcmap",
  "pdfjs/cmaps/ETenms-B5-H.bcmap",
  "pdfjs/cmaps/ETenms-B5-V.bcmap",
  "pdfjs/cmaps/EUC-H.bcmap",
  "pdfjs/cmaps/EUC-V.bcmap",
  "pdfjs/cmaps/Ext-H.bcmap",
  "pdfjs/cmaps/Ext-RKSJ-H.bcmap",
  "pdfjs/cmaps/Ext-RKSJ-V.bcmap",
  "pdfjs/cmaps/Ext-V.bcmap",
  "pdfjs/cmaps/GB-EUC-H.bcmap",
  "pdfjs/cmaps/GB-EUC-V.bcmap",
  "pdfjs/cmaps/GB-H.bcmap",
  "pdfjs/cmaps/GB-V.bcmap",
  "pdfjs/cmaps/GBK-EUC-H.bcmap",
  "pdfjs/cmaps/GBK-EUC-V.bcmap",
  "pdfjs/cmaps/GBK2K-H.bcmap",
  "pdfjs/cmaps/GBK2K-V.bcmap",
  "pdfjs/cmaps/GBKp-EUC-H.bcmap",
  "pdfjs/cmaps/GBKp-EUC-V.bcmap",
  "pdfjs/cmaps/GBT-EUC-H.bcmap",
  "pdfjs/cmaps/GBT-EUC-V.bcmap",
  "pdfjs/cmaps/GBT-H.bcmap",
  "pdfjs/cmaps/GBT-V.bcmap",
  "pdfjs/cmaps/GBTpc-EUC-H.bcmap",
  "pdfjs/cmaps/GBTpc-EUC-V.bcmap",
  "pdfjs/cmaps/GBpc-EUC-H.bcmap",
  "pdfjs/cmaps/GBpc-EUC-V.bcmap",
  "pdfjs/cmaps/H.bcmap",
  "pdfjs/cmaps/HKdla-B5-H.bcmap",
  "pdfjs/cmaps/HKdla-B5-V.bcmap",
  "pdfjs/cmaps/HKdlb-B5-H.bcmap",
  "pdfjs/cmaps/HKdlb-B5-V.bcmap",
  "pdfjs/cmaps/HKgccs-B5-H.bcmap",
  "pdfjs/cmaps/HKgccs-B5-V.bcmap",
  "pdfjs/cmaps/HKm314-B5-H.bcmap",
  "pdfjs/cmaps/HKm314-B5-V.bcmap",
  "pdfjs/cmaps/HKm471-B5-H.bcmap",
  "pdfjs/cmaps/HKm471-B5-V.bcmap",
  "pdfjs/cmaps/HKscs-B5-H.bcmap",
  "pdfjs/cmaps/HKscs-B5-V.bcmap",
  "pdfjs/cmaps/Hankaku.bcmap",
  "pdfjs/cmaps/Hiragana.bcmap",
  "pdfjs/cmaps/KSC-EUC-H.bcmap",
  "pdfjs/cmaps/KSC-EUC-V.bcmap",
  "pdfjs/cmaps/KSC-H.bcmap",
  "pdfjs/cmaps/KSC-Johab-H.bcmap",
  "pdfjs/cmaps/KSC-Johab-V.bcmap",
  "pdfjs/cmaps/KSC-V.bcmap",
  "pdfjs/cmaps/KSCms-UHC-H.bcmap",
  "pdfjs/cmaps/KSCms-UHC-HW-H.bcmap",
  "pdfjs/cmaps/KSCms-UHC-HW-V.bcmap",
  "pdfjs/cmaps/KSCms-UHC-V.bcmap",
  "pdfjs/cmaps/KSCpc-EUC-H.bcmap",
  "pdfjs/cmaps/KSCpc-EUC-V.bcmap",
  "pdfjs/cmaps/Katakana.bcmap",
  "pdfjs/cmaps/LICENSE",
  "pdfjs/cmaps/NWP-H.bcmap",
  "pdfjs/cmaps/NWP-V.bcmap",
  "pdfjs/cmaps/RKSJ-H.bcmap",
  "pdfjs/cmaps/RKSJ-V.bcmap",
  "pdfjs/cmaps/Roman.bcmap",
  "pdfjs/cmaps/UniCNS-UCS2-H.bcmap",
  "pdfjs/cmaps/UniCNS-UCS2-V.bcmap",
  "pdfjs/cmaps/UniCNS-UTF16-H.bcmap",
  "pdfjs/cmaps/UniCNS-UTF16-V.bcmap",
  "pdfjs/cmaps/UniCNS-UTF32-H.bcmap",
  "pdfjs/cmaps/UniCNS-UTF32-V.bcmap",
  "pdfjs/cmaps/UniCNS-UTF8-H.bcmap",
  "pdfjs/cmaps/UniCNS-UTF8-V.bcmap",
  "pdfjs/cmaps/UniGB-UCS2-H.bcmap",
  "pdfjs/cmaps/UniGB-UCS2-V.bcmap",
  "pdfjs/cmaps/UniGB-UTF16-H.bcmap",
  "pdfjs/cmaps/UniGB-UTF16-V.bcmap",
  "pdfjs/cmaps/UniGB-UTF32-H.bcmap",
  "pdfjs/cmaps/UniGB-UTF32-V.bcmap",
  "pdfjs/cmaps/UniGB-UTF8-H.bcmap",
  "pdfjs/cmaps/UniGB-UTF8-V.bcmap",
  "pdfjs/cmaps/UniJIS-UCS2-H.bcmap",
  "pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap",
  "pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap",
  "pdfjs/cmaps/UniJIS-UCS2-V.bcmap",
  "pdfjs/cmaps/UniJIS-UTF16-H.bcmap",
  "pdfjs/cmaps/UniJIS-UTF16-V.bcmap",
  "pdfjs/cmaps/UniJIS-UTF32-H.bcmap",
  "pdfjs/cmaps/UniJIS-UTF32-V.bcmap",
  "pdfjs/cmaps/UniJIS-UTF8-H.bcmap",
  "pdfjs/cmaps/UniJIS-UTF8-V.bcmap",
  "pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap",
  "pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap",
  "pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap",
  "pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap",
  "pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap",
  "pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap",
  "pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap",
  "pdfjs/cmaps/UniJISPro-UCS2-V.bcmap",
  "pdfjs/cmaps/UniJISPro-UTF8-V.bcmap",
  "pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap",
  "pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap",
  "pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap",
  "pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap",
  "pdfjs/cmaps/UniKS-UCS2-H.bcmap",
  "pdfjs/cmaps/UniKS-UCS2-V.bcmap",
  "pdfjs/cmaps/UniKS-UTF16-H.bcmap",
  "pdfjs/cmaps/UniKS-UTF16-V.bcmap",
  "pdfjs/cmaps/UniKS-UTF32-H.bcmap",
  "pdfjs/cmaps/UniKS-UTF32-V.bcmap",
  "pdfjs/cmaps/UniKS-UTF8-H.bcmap",
  "pdfjs/cmaps/UniKS-UTF8-V.bcmap",
  "pdfjs/cmaps/V.bcmap",
  "pdfjs/cmaps/WP-Symbol.bcmap",
  "pdfjs/iccs/CGATS001Compat-v2-micro.icc",
  "pdfjs/iccs/LICENSE",
  "pdfjs/standard_fonts/FoxitDingbats.pfb",
  "pdfjs/standard_fonts/FoxitFixed.pfb",
  "pdfjs/standard_fonts/FoxitFixedBold.pfb",
  "pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
  "pdfjs/standard_fonts/FoxitFixedItalic.pfb",
  "pdfjs/standard_fonts/FoxitSerif.pfb",
  "pdfjs/standard_fonts/FoxitSerifBold.pfb",
  "pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
  "pdfjs/standard_fonts/FoxitSerifItalic.pfb",
  "pdfjs/standard_fonts/FoxitSymbol.pfb",
  "pdfjs/standard_fonts/LICENSE_FOXIT",
  "pdfjs/standard_fonts/LICENSE_LIBERATION",
  "pdfjs/standard_fonts/LiberationSans-Bold.ttf",
  "pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
  "pdfjs/standard_fonts/LiberationSans-Italic.ttf",
  "pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  "pdfjs/wasm/LICENSE_JBIG2",
  "pdfjs/wasm/LICENSE_OPENJPEG",
  "pdfjs/wasm/LICENSE_PDFJS_JBIG2",
  "pdfjs/wasm/LICENSE_PDFJS_OPENJPEG",
  "pdfjs/wasm/LICENSE_PDFJS_QCMS",
  "pdfjs/wasm/LICENSE_QCMS",
  "pdfjs/wasm/jbig2.wasm",
  "pdfjs/wasm/openjpeg.wasm",
  "pdfjs/wasm/qcms_bg.wasm",
  "pdfjs/wasm/quickjs-eval.wasm",
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
  const lazy = LAZY.includes(name);
  if (!FILES.includes(name) && !lazy) {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(name).then((hit) => hit || (lazy ? keep(cache, name) : fetch(req)))),
  );
});

// keep takes the file name of LAZY, not in the cache yet, by its path in the
// version, and puts it in the cache of the version if the answer is whole
// and of the place (200, this origin, no redirect); else it is the answer
// as it came, kept nowhere.
function keep(cache, name) {
  return fetch(BASE + name).then((res) => {
    if (res.status !== 200 || res.type !== "basic" || res.redirected) {
      return res;
    }
    return cache.put(name, res.clone()).then(
      () => res,
      () => res,
    );
  });
}
