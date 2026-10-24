// The places a file taken out goes to (D19 4.5; docs/pwa.md). The core
// (internal/client/pwa, Take) chooses the mode and gives the bytes as they
// come; nothing is kept in the PWA past the hand-over. A function that waits
// gives a promise, rejected with the browser's DOMException as it is
// (QuotaExceededError: no space; AbortError: the user stopped it).

const OUT = "homecloud-out"; // the folder of OPFS of the file being handed over

let held = null; // the file waiting for the tap of the hand-over (an outgoing)

// The files of OPFS this page made and has not removed: name -> remove. Each
// is under a Web Lock (LOCK + name) while it lives, so the sweep of another
// tab, or of this one, never removes a file still written or handed over.
const mine = new Map();
const LOCK = "homecloud-out/";
// The age past which a file is swept when the browser has no Web Locks.
const OLD = 24 * 60 * 60 * 1000;

// hold takes the lock of the file name; the function it gives lets it go.
async function hold(name) {
  if (!navigator.locks) return () => {};
  let release;
  const p = new Promise((r) => (release = r));
  await new Promise((granted) => {
    navigator.locks.request(LOCK + name, () => {
      granted();
      return p;
    });
  });
  return release;
}

function ios() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function aborted(message) {
  return new DOMException(message, "AbortError");
}

// download gives url to the browser's download as name.
function download(url, name) {
  const a = document.createElement("a");
  a.href = url;
  if (name !== undefined) a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}

// outgoing is a file given to the user. give holds it for the tap of the
// hand-over on the iPhone ("hand"), else downloads it at once ("download");
// drop lets go of it and of the address of its download. The core calls drop
// (by abort) once it is given (Handed; a while after a download).
function outgoing() {
  let url = null;
  const me = {
    file: null,
    name: "",
    give(file, name) {
      me.file = file;
      me.name = name;
      if (ios()) {
        held = me;
        return "hand";
      }
      me.download();
      return "download";
    },
    download() {
      url = URL.createObjectURL(me.file);
      download(url, me.name);
    },
    drop() {
      if (held === me) held = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
      me.file = null;
    },
  };
  return me;
}

async function outDir(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OUT, { create });
}

// sweep removes what is left in OPFS of the files of pages gone (a page
// that was killed): those whose lock no page holds, or, without Web Locks,
// those older than OLD. The files of this page and of the other tabs stay.
async function sweep() {
  if (!navigator.storage || !navigator.storage.getDirectory) return;
  let dir;
  try {
    dir = await outDir(false);
  } catch (e) {
    if (e.name === "NotFoundError") return;
    throw e;
  }
  const names = [];
  for await (const name of dir.keys()) names.push(name);
  for (const name of names) {
    if (mine.has(name)) continue;
    const remove = () => dir.removeEntry(name, { recursive: true }).catch(() => {});
    if (navigator.locks) {
      await navigator.locks.request(LOCK + name, { ifAvailable: true }, async (lock) => {
        if (lock) await remove();
      });
      continue;
    }
    try {
      const h = await dir.getFileHandle(name);
      if (Date.now() - (await h.getFile()).lastModified < OLD) continue;
    } catch {
      // not a file: removed
    }
    await remove();
  }
}

// The photo or the PDF of the view (D19b 3, 5): its chunks in the memory of
// the page alone (never OPFS, a cache or IndexedDB), one at a time; a new one
// lets go of the one before. A photo's address is for an <img> alone
// (viewURL); a PDF's bytes are for pdf.js alone (viewData), never an address.
let viewing = null; // {parts, closed, url}
// away: the page was left (pagehide) and not shown again; no view is opened
// nor given an address meanwhile, whatever the core still sends.
let away = false;

// The types of the Blobs of the view (D19b 4.1 #2): those of the check of the
// core alone.
const IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/avif"]);

// dropView lets go of the photo of the view: its address, its chunks.
export function dropView() {
  const v = viewing;
  viewing = null;
  if (!v) return;
  if (v.url) URL.revokeObjectURL(v.url);
  v.url = null;
  v.parts = [];
}

// viewURL is the address of the photo of the view, once the core closed it,
// as a Blob of mime; null when there is none or mime is not a photo's.
export function viewURL(mime) {
  const v = viewing;
  if (away || !v || !v.closed || !IMAGES.has(mime)) return null;
  if (!v.url) {
    v.url = URL.createObjectURL(new Blob(v.parts, { type: mime }));
    v.parts = [];
  }
  return v.url;
}

// viewData is the bytes of the PDF of the view, once the core closed it, as
// one Uint8Array for pdf.js (D19b 2.3), given once: its chunks are let go of
// here, and pdf.js holds the bytes until its worker is destroyed. null when
// there is none or mime is not a PDF's.
export function viewData(mime) {
  const v = viewing;
  if (away || !v || !v.closed || v.url || mime !== "application/pdf") return null;
  let n = 0;
  for (const p of v.parts) n += p.length;
  const data = new Uint8Array(n);
  n = 0;
  for (const p of v.parts) {
    data.set(p, n);
    n += p.length;
  }
  v.parts = [];
  v.closed = false;
  return data;
}

// The modes of Take, and the view's.
const open = {
  // view: the chunks the core let through its check, kept until the screen
  // shows them (viewURL) and closes the view (dropView).
  view() {
    dropView();
    if (away) throw aborted("the page was left");
    const me = { parts: [], closed: false, url: null };
    viewing = me;
    return {
      write: async (b) => {
        if (viewing !== me) throw aborted("the view was closed");
        me.parts.push(b);
      },
      close: async () => {
        if (viewing !== me) throw aborted("the view was closed");
        me.closed = true;
        return "view";
      },
      abort: async () => {
        if (viewing === me) dropView();
        me.parts = [];
      },
    };
  },

  async picker(name) {
    const h = await window.showSaveFilePicker({ suggestedName: name });
    const w = await h.createWritable();
    return {
      write: (b) => w.write(b),
      close: async () => {
        await w.close();
        return "";
      },
      abort: () => w.abort(),
    };
  },

  // memory: small files alone (the core never puts a large one here).
  memory(name) {
    let parts = [];
    const out = outgoing();
    return {
      write: async (b) => {
        parts.push(b);
      },
      close: async () => {
        const file = new File(parts, name, { type: "application/octet-stream" });
        parts = [];
        return out.give(file, name);
      },
      abort: async () => {
        parts = [];
        out.drop();
      },
    };
  },

  // opfs: the core swept the folder and looked at the free space first.
  async opfs(name) {
    const dir = await outDir(true);
    const entry = crypto.randomUUID();
    const release = await hold(entry);
    let gone = false;
    const remove = async () => {
      if (gone) return;
      gone = true;
      mine.delete(entry);
      await dir.removeEntry(entry).catch(() => {});
      release();
    };
    mine.set(entry, remove);
    let h, w;
    try {
      h = await dir.getFileHandle(entry, { create: true });
      w = await h.createWritable();
    } catch (e) {
      await remove(); // nothing is left of a file that could not be begun
      throw e;
    }
    const out = outgoing();
    let closed = false;
    return {
      write: (b) => w.write(b),
      close: async () => {
        await w.close();
        closed = true;
        const f = await h.getFile();
        return out.give(new File([f], name, { type: "application/octet-stream" }), name);
      },
      abort: async () => {
        out.drop();
        if (!closed) await w.abort().catch(() => {});
        await remove();
      },
    };
  },

  // stream: the Service Worker answers the download of save/<id> with a
  // stream it reads from the port (sw.js); each chunk is sent when it asks
  // for one, so at most a chunk or two are in memory.
  async stream(name, size) {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw) throw new Error("no Service Worker");
    const id = crypto.randomUUID();
    const ch = new MessageChannel();
    const port = ch.port1;
    let credits = 0;
    let wake = null;
    let stopped = null;
    let ready, started;
    const told = new Promise((resolve) => (ready = resolve));
    const asked = new Promise((resolve) => (started = resolve));
    port.onmessage = (e) => {
      const m = e.data || {};
      if (m.ready) ready();
      if (m.pull) {
        credits++;
        started();
      }
      if (m.cancel) stopped = aborted("the download was stopped");
      if (wake) {
        wake();
        wake = null;
      }
    };
    // within: p, or an error after 10 seconds.
    const within = (p, what) =>
      Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(what)), 10000))]);
    sw.postMessage({ type: "hc-save", id, name, size }, [ch.port2]);
    await within(told, "the Service Worker did not answer");
    download(new URL("save/" + id, document.baseURI).href);
    await within(asked, "the download did not start");
    return {
      write: async (b) => {
        while (credits === 0 && !stopped) await new Promise((r) => (wake = r));
        if (stopped) throw stopped;
        credits--;
        port.postMessage({ chunk: b }, [b.buffer]);
      },
      close: async () => {
        port.postMessage({ done: true });
        port.close();
        return "";
      },
      abort: async () => {
        port.postMessage({ abort: true });
        port.close();
      },
    };
  },
};

export const saver = {
  features() {
    const s = navigator.storage;
    return {
      picker: typeof window.showSaveFilePicker === "function",
      stream: !!(navigator.serviceWorker && navigator.serviceWorker.controller) && typeof ReadableStream === "function",
      opfs: !!(s && s.getDirectory) && typeof FileSystemFileHandle === "function" &&
        typeof FileSystemFileHandle.prototype.createWritable === "function",
      ios: ios(),
    };
  },
  async estimate() {
    if (!navigator.storage || !navigator.storage.estimate) throw new Error("no estimate");
    return navigator.storage.estimate();
  },
  // persist is asked; a refusal, or none, is no matter.
  async persist() {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist().catch(() => false);
  },
  sweep,
  open(mode, name, size) {
    const f = open[mode];
    if (!f) throw new Error("no mode " + mode);
    return f(name, size);
  },
};

// handOver gives the file held to the user on the tap of the screen: by the
// share sheet when the browser shares files, else by a download. It is what
// it did, for the core (handed), which removes the file: "shared",
// "download", "cancelled" (the share sheet was closed: still held), "failed",
// or "none" (nothing held).
export async function handOver() {
  const h = held;
  if (!h) return "none";
  try {
    if (navigator.canShare && navigator.canShare({ files: [h.file] })) {
      await navigator.share({ files: [h.file] });
      return "shared";
    }
    h.download();
    return "download";
  } catch (e) {
    return e.name === "AbortError" ? "cancelled" : "failed";
  }
}

// A page that goes away lets go of what it holds and removes its files of
// OPFS if the browser lets it finish; else their locks end with the page and
// the next start sweeps them (Start sweeps).
addEventListener("pagehide", () => {
  away = true;
  dropView();
  if (held) held.drop();
  for (const remove of [...mine.values()]) remove();
});
// A page kept to come back to (the back of the browser) may view again; the
// view left behind was closed (app.js) and the core refuses it.
addEventListener("pageshow", () => {
  away = false;
});
