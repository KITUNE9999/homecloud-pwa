// The screens of the PWA (D19 4.1, 4.4, 5.1; D17b 2.1): an ES module with no
// build tool, the words of messages.json, and textContent alone. The core is
// the WebAssembly of cmd/homecloud-pwa: it takes the invitation of the
// address (and wipes it), registers, reads the lists, takes the files out
// to the places of save.js (D19 4.5) and uploads the files chosen, reading
// them a part at a time (D9 4.8).

import { saver, handOver } from "./save.js";

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
