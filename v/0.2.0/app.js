// The screens of the PWA (D19 4.1, 4.4, 5.1; D17b 2.1): an ES module with no
// build tool, the words of messages.json, and textContent alone. The core is
// the WebAssembly of cmd/homecloud-pwa: it takes the invitation of the
// address (and wipes it), registers, reads the lists, takes the files out
// to the places of save.js (D19 4.5) and uploads the files chosen, reading
// them a part at a time (D9 4.8).

import { saver, handOver, viewURL, viewData, dropView } from "./save.js";

// The invitation after "#" is taken into memory and wiped from the address
// bar and the history before anything else (D19 5.1), before the words and
// the WebAssembly are fetched: .../v/<版>/i#... becomes .../v/<版>/. The core
// reads it once (hcpwaHref) and removes it.
(function takeInvite() {
  const href = location.href;
  const i = href.indexOf("#");
  if (i < 0) return;
  let base = href.slice(0, i);
  for (const s of ["/i", "/i/"]) {
    if (base.endsWith(s)) {
      base = base.slice(0, -s.length) + "/";
      break;
    }
  }
  history.replaceState(null, "", base);
  globalThis.hcpwaHref = href;
})();

const here = (name) => new URL(name, import.meta.url);

let words = {};
let hc = null;
const folders = []; // the folders opened, from the top: {id, name}
let back = null; // where 「このアプリについて」 goes back to, once a list is shown

// msg is the words of key, with {name} replaced by vars[name].
function msg(key, vars = {}) {
  let s = typeof words[key] === "string" ? words[key] : key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split("{" + k + "}").join(String(v));
  }
  return s;
}

function errorText(code) {
  const e = words.errors || {};
  return e[code] || e.internal || code;
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function button(text, onclick) {
  const b = el("button", text);
  b.type = "button";
  b.addEventListener("click", onclick);
  return b;
}

function show(...nodes) {
  document.getElementById("main").replaceChildren(...nodes);
}

function when(ms) {
  return new Date(ms).toLocaleString("ja-JP");
}

function size(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 ? String(n) : n.toFixed(1)) + " " + units[i];
}

async function call(name, ...args) {
  return JSON.parse(await hc[name](...args));
}

function showInvite(st) {
  const inv = st.invite;
  const nodes = [el("h2", msg("invite_title")), el("p", msg("invite_user", { user: inv.user }))];
  if (inv.expires) nodes.push(el("p", msg("invite_expires", { time: when(inv.expires) })));
  if (inv.maybe_expired) nodes.push(el("p", msg("maybe_expired"), "error"));
  if (!window.matchMedia("(display-mode: standalone)").matches) nodes.push(el("p", msg("invite_home")));
  const label = el("label", msg("device_name"));
  const input = el("input");
  input.value = msg("device_default", { user: inv.user });
  input.maxLength = 100;
  label.append(el("br"), input);
  const status = el("p");
  const go = button(msg("accept"), async () => {
    go.disabled = true;
    status.className = "";
    status.textContent = msg("registering");
    const r = await call("accept", input.value);
    if (r.error) {
      status.className = "error";
      status.textContent = errorText(r.error);
      go.disabled = false;
      return;
    }
    if (r.pending) {
      showPending(r.code);
      return;
    }
    openFolder(null);
  });
  show(...nodes, label, el("p"), go, status);
}

function showPending(code) {
  show(
    el("p", msg("pending")),
    el("p", code, "code"),
    button(msg("check_again"), () => openFolder(null)),
  );
}

// openFolder opens item (null: the top) and shows its list.
async function openFolder(item) {
  if (item === null) folders.length = 0;
  else folders.push(item);
  await showList();
}

// openSaved opens the folder of the copy kept (the last one seen), with the
// folders above it, so the copy is shown again where it was when the server
// is not reached.
async function openSaved(cp) {
  const path = (cp && Array.isArray(cp.path) && cp.path) || [];
  const last = path[path.length - 1];
  folders.length = 0;
  if (last && last.id === cp.under) {
    for (const f of path) folders.push({ id: String(f.id), name: String(f.name) });
  } else if (cp && cp.under && cp.under !== "1") {
    // A path too long to keep: the folder alone, under the top.
    folders.push({ id: String(cp.under), name: "…" });
  }
  await showList();
}

// showList reads the list of the folder open and shows it; note(v), if
// given, is the words of what was done before, {text, error}, by the list.
async function showList(note) {
  const cur = folders[folders.length - 1];
  show(el("p", msg("loading_list")));
  const v = await call("list", cur ? cur.id : "", JSON.stringify(folders));
  const pend = await call("pending");
  renderList(v, pend, typeof note === "function" ? note(v) : null);
}

function renderList(v, pend, note) {
  back = showList;
  const cur = folders[folders.length - 1];
  const nodes = [el("h2", cur ? cur.name : msg("root"))];
  if (v.error === "pending") {
    nodes.push(el("p", errorText(v.error)), button(msg("check_again"), () => showList()));
    show(...nodes);
    return;
  }
  if (v.error) nodes.push(el("p", errorText(v.error), "error"));
  if (v.cached) nodes.push(el("p", msg("cached", { time: when(v.at) })));
  if (note) nodes.push(el("p", note.text, note.error ? "error" : undefined));
  const status = el("p");
  nodes.push(status, uploadBar(cur ? cur.id : "", pend));
  const bar = el("p");
  if (folders.length > 0) {
    bar.append(
      button(msg("up"), () => {
        folders.pop();
        showList();
      }),
      " ",
    );
  }
  bar.append(button(msg("reload"), () => showList()));
  nodes.push(bar);
  const items = v.items || [];
  if (items.length === 0 && !v.error) nodes.push(el("p", msg("empty")));
  const ul = el("ul", undefined, "items");
  for (const it of items) {
    const li = el("li");
    if (it.kind === "dir") {
      li.append(button(it.name, () => openFolder({ id: it.id, name: it.name })));
    } else if (tapOf(it.name) !== "take") {
      // A photo or a PDF is seen, an Office file says how it is opened; the
      // button beside it takes it out without seeing it.
      const side = el("span");
      side.append(size(it.size), " ", button(msg("hand"), () => takeFile(it, status)));
      const open = tapOf(it.name) === "view" ? viewFile : officeFile;
      li.append(button(it.name, () => open(it, status)), side);
    } else {
      li.append(button(it.name, () => takeFile(it, status)), el("span", size(it.size)));
    }
    ul.append(li);
  }
  nodes.push(ul);
  show(...nodes);
}

let taking = false;

// takeFile takes the file it out to the user's place (D19 4.5), one at a
// time, and says how it went in status.
async function takeFile(it, status) {
  if (taking) return;
  taking = true;
  status.className = "";
  status.replaceChildren(msg("taking", { name: it.name }));
  let r;
  try {
    r = await call("take", it.id, it.name, it.size);
  } finally {
    taking = false;
  }
  if (r.error) {
    status.className = "error";
    status.replaceChildren(errorText(r.error).split("{need}").join(size(r.need || 0)));
    return;
  }
  if (!r.hand) {
    status.replaceChildren(msg("taken", { name: it.name }));
    return;
  }
  // The share sheet needs a tap of its own; the core removes the file after.
  const give = button(msg("hand"), async () => {
    give.disabled = true;
    const how = await handOver();
    await call("handed", how);
    if (how === "cancelled") {
      give.disabled = false;
    } else if (how === "shared" || how === "download") {
      status.replaceChildren(msg("taken", { name: it.name }));
    } else {
      status.className = "error";
      status.replaceChildren(errorText(how === "none" ? "gone" : "internal"));
    }
  });
  status.replaceChildren(msg("hand_note", { name: it.name }), " ", give);
}

// The photos (D19b 2.2) and the PDFs (2.3) seen in the PWA, by the extension
// of the name; the core checks their bytes.
const SEEN = /\.(jpe?g|png|gif|webp|heic|heif|avif|pdf)$/i;
// The Office files (D19b 2.4 (a)): never parsed or drawn in the PWA, handed
// to an app of the phone by the take.
const OFFICE = /\.(docx|xlsx|pptx|doc|xls|ppt)$/i;

// tapOf is what tapping the name of a file does (D19b 6): "view" a photo or
// a PDF, "office" the words of an Office file, "take" any other.
function tapOf(name) {
  if (SEEN.test(name)) return "view";
  if (OFFICE.test(name)) return "office";
  return "take";
}
// The wait for the browser to decode a photo, so the user does not wait on
// (D19b 2.2): it does not stop the decoding.
const DECODE_WAIT = 15000;

let viewer = null; // the view open: {close}
let viewSeq = 0; // the number of the last view, for the core (App.View)

// Leaving the page closes the view, and stops it in the core even if it has
// not reached the place of save.js yet (D19b 5).
addEventListener("pagehide", () => {
  if (viewer) viewer.close(true);
});

// viewFile shows the photo or the PDF it over the list (D19b 6): 「閉じる」,
// the back of the browser and Esc close it; 「保存する・共有する」 takes it
// out the way the list does. The photo goes to an <img> alone, by its address
// of save.js; the PDF's bytes go to pdf.js alone (viewPDF); closing lets go
// of it in the page and in the core.
async function viewFile(it, status) {
  if (viewer) viewer.close(true);
  const seq = ++viewSeq;
  const box = el("div", undefined, "viewer");
  const line = el("p");
  const img = el("img");
  img.alt = it.name;
  let gone = false;
  let timer = null;
  let stop = null; // the end of the PDF (viewPDF): its loading task and worker destroyed
  const esc = (e) => {
    if (e.key === "Escape") close(false);
  };
  const pop = () => close(true);
  // close ends the view; byBack: the history entry is gone already.
  const close = (byBack) => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    if (stop) stop();
    img.removeAttribute("src");
    dropView();
    call("closeView", seq);
    box.remove();
    removeEventListener("keydown", esc);
    removeEventListener("popstate", pop);
    if (viewer === me) viewer = null;
    if (!byBack) history.back();
  };
  const me = { close };
  viewer = me;
  const fail = (text) => {
    if (stop) stop();
    img.removeAttribute("src");
    img.hidden = true;
    dropView();
    call("closeView", seq);
    line.className = "error";
    line.textContent = text;
  };
  const bar = el("p");
  bar.append(
    button(msg("view_close"), () => close(false)),
    " ",
    button(msg("hand"), () => {
      close(false);
      takeFile(it, status);
    }),
  );
  line.textContent = msg("view_loading", { name: it.name, got: size(0), size: size(it.size) });
  box.append(el("h2", it.name), bar, line, img);
  document.body.append(box);
  history.pushState(null, "");
  addEventListener("popstate", pop);
  addEventListener("keydown", esc);

  const r = await call("view", seq, it.id, it.name, it.size, (_, got, all) => {
    if (!gone) line.textContent = msg("view_loading", { name: it.name, got: size(got), size: size(all) });
  });
  if (gone) return;
  if (!r.error && r.mime === PDF_MIME) {
    const data = viewData(r.mime);
    img.remove();
    if (!data) {
      fail(errorText("internal"));
      return;
    }
    stop = viewPDF(box, line, data, fail);
    return;
  }
  const url = r.error ? null : viewURL(r.mime);
  if (!url) {
    fail(errorText(r.error || "internal").split("{size}").join(size(r.size || 0)));
    return;
  }
  img.src = url;
  timer = setTimeout(() => {
    close(false);
    status.className = "error";
    status.replaceChildren(msg("view_broken"));
  }, DECODE_WAIT);
  try {
    await img.decode();
  } catch {
    clearTimeout(timer);
    // HEIC and AVIF are shown where the browser reads them (D19b 2.2).
    if (!gone) fail(msg(r.mime === "image/heic" || r.mime === "image/avif" ? "view_heic" : "view_broken"));
    return;
  }
  clearTimeout(timer);
  if (!gone) line.textContent = "";
}

// officeFile tells, over the list, how the Office file it is opened (D19b
// 2.4 (a), 6): nothing of it is read here; 「保存する・共有する」 takes it out
// the way the list does, to an app of the phone. 「閉じる」, the back of the
// browser and Esc close it, as the view.
function officeFile(it, status) {
  if (viewer) viewer.close(true);
  const box = el("div", undefined, "viewer");
  let gone = false;
  const esc = (e) => {
    if (e.key === "Escape") close(false);
  };
  const pop = () => close(true);
  // close ends the words; byBack: the history entry is gone already.
  const close = (byBack) => {
    if (gone) return;
    gone = true;
    box.remove();
    removeEventListener("keydown", esc);
    removeEventListener("popstate", pop);
    if (viewer === me) viewer = null;
    if (!byBack) history.back();
  };
  const me = { close };
  viewer = me;
  const bar = el("p");
  bar.append(
    button(msg("view_close"), () => close(false)),
    " ",
    button(msg("hand"), () => {
      close(false);
      takeFile(it, status);
    }),
  );
  box.append(
    el("h2", it.name),
    bar,
    el("p", msg("office_note")),
    el("p", msg("office_iphone")),
    el("p", msg("office_android")),
    el("p", msg("office_left")),
  );
  document.body.append(box);
  history.pushState(null, "");
  addEventListener("popstate", pop);
  addEventListener("keydown", esc);
}

// The PDF of the view (D19b 2.3, 4.3): drawn by pdf.js of the version on
// canvases alone (no text layer, no annotation layer, no XFA, no scripting).
const PDF_MIME = "application/pdf";
const PDF_PAGES = 2000; // pages at most: one more is not drawn at all
const PDF_OPEN_WAIT = 20000; // getDocument, in ms
const PDF_PAGE_WAIT = 10000; // the render of a page, in ms
const PDF_CANVASES = 3; // canvases alive: the page seen and the ones beside it
const PDF_PIXELS = 16777216; // pixels of a canvas, and of an image in the PDF
const PDF_ZOOM = [0.5, 4]; // 「小さく」「大きく」, times the width of the screen

// pdf.js is loaded the first time a PDF is seen, from the version (never a
// blob: worker); a browser too old for it is told so, the rest of the app
// stays.
let pdfLib = null;
async function pdfjs() {
  if (!pdfLib) {
    const lib = await import("./pdfjs/build/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = here("pdfjs/build/pdf.worker.min.mjs").href;
    pdfLib = lib;
  }
  return pdfLib;
}

// viewPDF draws the PDF of data in box, the page number in line, and is the
// function that ends it: every way out (close, back, pagehide, another file,
// fail) calls it, and so does a bound passed (too many pages, the waits of
// the opening and of a page, a password, a PDF not read), which then tells
// fail. Ending destroys the loading task, then the worker of this PDF alone
// (which terminates its Web Worker, stopping its parsing), and lets go of
// every canvas.
function viewPDF(box, line, data, fail) {
  let ended = false;
  let worker = null;
  let task = null;
  let doc = null;
  let openTimer = null;
  let pageTimer = null;
  let observer = null;
  let zoom = 1;
  let base = null; // the size of page 1 at the scale 1: that of a page not drawn yet
  const sizes = new Map(); // page number -> its size at the scale 1, once known
  const live = new Map(); // page number -> {canvas, page, render}: at most PDF_CANVASES
  const seen = new Set(); // the page numbers on the screen
  const slots = [];
  const tools = el("p");
  const pages = el("div", undefined, "pages");
  box.append(tools, pages);

  const release = (n) => {
    const c = live.get(n);
    if (!c) return;
    live.delete(n);
    if (c.render) c.render.cancel();
    c.canvas.width = 0;
    c.canvas.height = 0;
    c.canvas.remove();
    if (c.page) c.page.cleanup();
  };
  const stop = () => {
    if (ended) return;
    ended = true;
    clearTimeout(openTimer);
    clearTimeout(pageTimer);
    if (observer) observer.disconnect();
    for (const n of [...live.keys()]) release(n);
    if (task) task.destroy();
    if (worker) worker.destroy();
    task = null;
    worker = null;
    doc = null;
    data = null;
    tools.remove();
    pages.remove();
  };
  const bad = (text) => {
    if (ended) return;
    stop();
    fail(text);
  };

  // The pages wanted: the first one on the screen and the ones beside it.
  const wanted = () => {
    const first = seen.size > 0 ? Math.min(...seen) : 1;
    const w = new Set();
    for (let n = first - 1; n <= first + 1 && w.size < PDF_CANVASES; n++) {
      if (n >= 1 && n <= slots.length) w.add(n);
    }
    return w;
  };
  const width = () => Math.max(100, pages.clientWidth) * zoom;
  const fit = (n) => {
    const s = sizes.get(n) || base;
    const slot = slots[n - 1];
    slot.style.width = Math.floor(width()) + "px";
    slot.style.height = Math.floor((width() * s.height) / s.width) + "px";
  };

  // draw draws the page n on a canvas of its own, within PDF_PIXELS; a page
  // not got, parsed and drawn in PDF_PAGE_WAIT ends the whole PDF (its worker
  // builds the page), so the wait starts before getPage.
  const draw = async (n) => {
    pageTimer = setTimeout(() => bad(msg("view_pdf_heavy")), PDF_PAGE_WAIT);
    try {
      const page = await doc.getPage(n);
      if (ended || !wanted().has(n) || live.has(n)) {
        if (!live.has(n)) page.cleanup();
        return;
      }
      const one = page.getViewport({ scale: 1 });
      sizes.set(n, { width: one.width, height: one.height });
      fit(n);
      const css = width() / one.width;
      let scale = css * (globalThis.devicePixelRatio || 1);
      const px = one.width * one.height * scale * scale;
      if (px > PDF_PIXELS) scale *= Math.sqrt(PDF_PIXELS / px);
      const viewport = page.getViewport({ scale });
      const canvas = el("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const c = { canvas, page, render: null };
      live.set(n, c);
      slots[n - 1].append(canvas);
      c.render = page.render({ canvasContext: canvas.getContext("2d"), canvas, viewport });
      try {
        await c.render.promise;
      } catch (e) {
        // A page let go of while it was drawn is cancelled; anything else ends the PDF.
        if (!(e && e.name === "RenderingCancelledException")) bad(msg("view_pdf_broken"));
        return;
      }
      c.render = null;
    } finally {
      clearTimeout(pageTimer);
    }
  };
  // update lets go of the pages not wanted, then draws the wanted ones, one
  // at a time.
  let busy = false;
  const update = async () => {
    if (ended || busy || !doc) return;
    busy = true;
    try {
      for (;;) {
        const w = wanted();
        for (const n of [...live.keys()]) if (!w.has(n)) release(n);
        const n = [...w].find((m) => !live.has(m));
        if (ended || n === undefined) break;
        await draw(n);
      }
    } catch {
      bad(msg("view_pdf_broken"));
    } finally {
      busy = false;
    }
    if (!ended && seen.size > 0) {
      line.textContent = msg("view_pdf_page", { page: Math.min(...seen), pages: slots.length });
    }
  };
  const rezoom = (by) => {
    const z = Math.min(PDF_ZOOM[1], Math.max(PDF_ZOOM[0], zoom * by));
    if (z === zoom || !doc) return;
    const first = seen.size > 0 ? Math.min(...seen) : 1;
    zoom = z;
    for (const n of [...live.keys()]) release(n);
    for (let n = 1; n <= slots.length; n++) fit(n);
    slots[first - 1].scrollIntoView();
    update();
  };
  tools.append(button(msg("view_pdf_smaller"), () => rezoom(1 / 1.25)), " ", button(msg("view_pdf_larger"), () => rezoom(1.25)));
  tools.hidden = true;

  (async () => {
    // The opening ends in PDF_OPEN_WAIT, the loading of pdf.js (the first
    // time) included; pdf.js loaded after it ends makes no worker.
    openTimer = setTimeout(() => bad(msg("view_pdf_slow")), PDF_OPEN_WAIT);
    let lib;
    try {
      lib = await pdfjs();
    } catch {
      bad(msg("view_pdf_old"));
      return;
    }
    if (ended) return;
    // One worker for each PDF, never used again: destroying it stops all of it.
    worker = new lib.PDFWorker();
    task = lib.getDocument({
      data,
      worker,
      // 6.4.299 compiles no function of a PDF (it has no such option any
      // more); it is said for a version that would.
      isEvalSupported: false,
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      cMapUrl: here("pdfjs/cmaps/").href,
      cMapPacked: true,
      standardFontDataUrl: here("pdfjs/standard_fonts/").href,
      wasmUrl: here("pdfjs/wasm/").href,
      iccUrl: here("pdfjs/iccs/").href,
      maxImageSize: PDF_PIXELS,
      stopAtErrors: false,
    });
    data = null;
    // A password is not asked for (the first version).
    task.onPassword = () => bad(msg("view_pdf_password"));
    let d;
    try {
      d = await task.promise;
    } catch {
      bad(msg("view_pdf_broken"));
      return;
    } finally {
      clearTimeout(openTimer);
    }
    if (ended) return;
    if (d.numPages > PDF_PAGES) {
      bad(msg("view_pdf_pages", { pages: d.numPages }));
      return;
    }
    doc = d;
    // The size of page 1 is a page got and parsed: within PDF_PAGE_WAIT too.
    pageTimer = setTimeout(() => bad(msg("view_pdf_heavy")), PDF_PAGE_WAIT);
    try {
      const one = (await doc.getPage(1)).getViewport({ scale: 1 });
      base = { width: one.width, height: one.height };
    } catch {
      bad(msg("view_pdf_broken"));
      return;
    } finally {
      clearTimeout(pageTimer);
    }
    if (ended) return;
    for (let n = 1; n <= doc.numPages; n++) {
      const slot = el("div", undefined, "page");
      slot.dataset.n = String(n);
      slots.push(slot);
    }
    pages.append(...slots);
    for (let n = 1; n <= slots.length; n++) fit(n);
    tools.hidden = false;
    line.textContent = msg("view_pdf_page", { page: 1, pages: slots.length });
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number(e.target.dataset.n);
          if (e.isIntersecting) seen.add(n);
          else seen.delete(n);
        }
        const w = wanted();
        for (const n of [...live.keys()]) if (!w.has(n)) release(n);
        update();
      },
      { root: box },
    );
    for (const slot of slots) observer.observe(slot);
    update();
  })().catch(() => bad(msg("view_pdf_broken")));
  return stop;
}

// chooser is an <input type="file"> of files (never a folder) that calls
// pick with the files chosen.
function chooser(multiple, pick) {
  const input = el("input");
  input.type = "file";
  input.multiple = multiple;
  input.hidden = true;
  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (files.length > 0) pick(files);
  });
  return input;
}

// uploadBar is the button 「上げる」 into the folder parent ("" the top), or,
// with an upload kept from before (pend), the way to go on with it (the same
// file chosen again) or to cancel it.
function uploadBar(parent, pend) {
  const box = el("div");
  const line = el("p");
  if (pend) {
    const same = chooser(false, (files) => runUploads(box, line, files, true, parent));
    box.append(
      el("p", msg("upload_pending", { name: pend.name, sent: size(pend.sent), size: size(pend.size) })),
      el("p", msg("upload_pending_note")),
      same,
    );
    line.append(
      button(msg("upload_choose_same"), () => same.click()),
      " ",
      button(msg("upload_cancel"), async () => {
        const r = await call("cancelUpload");
        showList(() => (r.error ? { text: errorText(r.error), error: true } : { text: msg("upload_cancelled") }));
      }),
    );
  } else {
    const pick = chooser(true, (files) => runUploads(box, line, files, false, parent));
    line.append(button(msg("upload"), () => pick.click()));
    box.append(pick);
  }
  box.append(line);
  return box;
}

// runUploads sends files one after the other (the one kept, resumed, when
// resume is true) with their progress and a button to cancel, stops at the
// first that fails, then reads the list again and says how it went.
async function runUploads(box, line, files, resume, parent) {
  const bar = el("progress");
  bar.max = 100;
  bar.value = 0;
  const text = el("span");
  let stopping = null;
  const cancel = button(msg("upload_cancel"), () => {
    cancel.disabled = true;
    stopping = call("cancelUpload");
  });
  box.replaceChildren(el("p", undefined), line);
  box.firstChild.append(text, " ", bar);
  line.replaceChildren(cancel);
  const done = [];
  let r = {};
  for (const f of files) {
    // Cancelled: no next file is begun (the cancel ends the one going on).
    if (stopping) break;
    const pct = (d, s) => (s > 0 ? Math.floor((d * 100) / s) : 100);
    const step = (hashing, d, s) => {
      bar.value = pct(d, s);
      text.textContent = msg(hashing ? "hashing" : "uploading", { name: f.name, pct: pct(d, s) });
    };
    step(true, 0, f.size);
    r = resume ? await call("resume", f, step) : await call("upload", parent, f, step);
    if (r.error) break;
    done.push({ id: r.item, name: f.name, conflict: r.conflict });
  }
  const stopped = stopping ? await stopping : null;
  showList((v) => {
    if (stopped && (r.error || stopped.error)) {
      return stopped.error ? { text: errorText(stopped.error), error: true } : { text: msg("upload_cancelled") };
    }
    if (r.error) return { text: errorText(r.error), error: true };
    const last = done[done.length - 1];
    if (done.length === 1 && last.conflict === "name") {
      const it = (v.items || []).find((i) => i.id === last.id);
      return { text: it ? msg("uploaded_as", { name: it.name }) : msg("uploaded_renamed") };
    }
    if (done.some((d) => d.conflict === "name")) return { text: msg("uploaded_some_renamed", { n: done.length }) };
    return { text: done.length === 1 ? msg("uploaded", { name: last.name }) : msg("uploaded_n", { n: done.length }) };
  });
}

// showAbout is 「このアプリについて」 (D19 4.4): whom the app trusts, and the
// files of this version with their hashes.
async function showAbout(back) {
  const nodes = [el("h2", msg("about")), el("p", msg("about_version", { version: hc ? hc.version : "" }))];
  for (const p of words.about_trust || []) nodes.push(el("p", p));
  nodes.push(el("h3", msg("about_files")));
  try {
    const res = await fetch(here("files.json"));
    const files = await res.json();
    const ul = el("ul", undefined, "items");
    for (const f of files) {
      const li = el("li");
      li.append(el("span", f.path), el("span", f.sha256, "hash"));
      ul.append(li);
    }
    nodes.push(ul);
  } catch {
    nodes.push(el("p", msg("about_files_missing"), "error"));
  }
  nodes.push(button(msg("back"), back));
  show(...nodes);
}

async function main() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(here("sw.js"), { scope: "./" }).catch(() => {});
  }
  words = await (await fetch(here("messages.json"))).json();
  document.title = msg("title");
  if (/Windows/.test(navigator.userAgent)) {
    const n = document.getElementById("notice");
    n.textContent = msg("windows");
    n.hidden = false;
  }
  show(el("p", msg("loading")));
  const ready = new Promise((resolve) => {
    globalThis.hcpwaReady = (api, err) => resolve({ api, err });
  });
  globalThis.hcpwaSave = saver;
  const go = new Go();
  const { instance } = await WebAssembly.instantiateStreaming(fetch(here("homecloud.wasm")), go.importObject);
  go.run(instance);
  const { api, err } = await ready;
  if (err) {
    show(el("p", errorText(err), "error"));
    return;
  }
  hc = api;
  const st = await call("start");
  let home;
  if (st.invite) home = () => showInvite(st);
  else if (st.deleted) home = () => show(el("p", msg("deleted"), "error")); // not the first time's words
  else if (st.pending) home = () => showPending(st.code);
  else if (st.registered) home = () => openSaved(st.list); // the copy if the server is not reached
  else home = () => show(el("p", st.invite_error ? errorText(st.invite_error) : msg("not_registered")));
  const about = document.getElementById("about");
  about.textContent = msg("about");
  about.hidden = false;
  about.addEventListener("click", () => showAbout(back || home));
  home();
}

main().catch(() => {
  delete globalThis.hcpwaHref;
  show(el("p", errorText("internal"), "error"));
});
