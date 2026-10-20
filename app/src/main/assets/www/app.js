/* Thunder Gamepad app shell: Connect / Layouts / Settings. Play screen = play.js; Editor = TODO (docs/progress.md) */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const LKEY = "padlink.layouts", SKEY = "padlink.settings";
  const DEF_SETTINGS = {haptics: true, rumble: true, keepAwake: true, immersive: true, autoReconnect: true, nativeFallback: false, stickSens: 1};
  const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let layouts = jget(LKEY, {});                     // id -> {name, data:{settings,layout}, edited}
  let settings = Object.assign({}, DEF_SETTINGS, jget(SKEY, {}));
  let screen = "connect";
  const H = Engine.create();
  Engine.setOutput(o => Link.send(o));

  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2200); }

  /* ---------- navigation ---------- */
  function go(name) {
    screen = name;
    document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === name));
    document.querySelectorAll(".nav").forEach(n => n.classList.toggle("on", n.dataset.go === name));
    if (name === "connect") renderContinue();
    if (name === "library") renderLibrary();
    if (name === "settings") renderSettings();
  }
  document.querySelectorAll(".nav").forEach(n => n.onclick = () => go(n.dataset.go));

  /* ---------- connect ---------- */
  const C = Link.conn;
  $("host").value = C.host; $("port").value = C.port;
  ["host", "port"].forEach(k => $(k).oninput = () => { C[k] = $(k).value; Link.save(); });

  function renderPadSeg() { document.querySelectorAll("#padseg button").forEach(b => b.classList.toggle("on", b.dataset.pad === C.pad)); }
  document.querySelectorAll("#padseg button").forEach(b => b.onclick = () => { Link.setPad(b.dataset.pad); renderPadSeg(); });

  $("find").onclick = () => { $("findNote").textContent = "Searching…"; Link.discover(); };
  $("go").onclick = () => { if (Link.state === "open" || Link.state === "connecting" || Link.state === "pending") Link.disconnect(); else { $("err").textContent = ""; Link.connect(); } };

  function renderFound() {
    const box = $("found");
    $("findNote").textContent = Link.found.length ? "" : ($("findNote").textContent === "Searching…" ? "No receiver found. Is it running? Same Wi-Fi?" : "");
    box.innerHTML = Link.found.map((f, i) => '<div class="found' + (f.host === C.host ? " pick" : "") + '" data-i="' + i + '"><div><b>' + esc(f.name || f.host) + '</b><br><small>' + esc(f.host) + ":" + esc(f.port) + '</small></div><span class="muted">Use</span></div>').join("");
    box.querySelectorAll(".found").forEach(el => el.onclick = () => { const f = Link.found[+el.dataset.i]; C.host = f.host; C.port = f.port; $("host").value = f.host; $("port").value = f.port; Link.save(); renderFound(); if (f.pcid) Link.conn.pc = Link.conn.pcs && Link.conn.pcs[f.pcid] ? f.pcid : Link.conn.pc; $("err").textContent = ""; Link.connect(); });
  }

  function renderLink() {
    const chip = $("chip"), s = Link.state;
    const map = {open: ["on", "Connected"], connecting: ["busy", "Connecting"], pending: ["busy", "Waiting for PC"], failed: ["bad", "Failed"], denied: ["bad", "Not allowed"], closed: ["off", "Offline"]};
    const m = map[s] || map.closed;
    chip.className = "chip " + m[0]; chip.querySelector("b").textContent = m[1];
    $("go").textContent = s === "open" ? "Disconnect" : (s === "connecting" || s === "pending") ? "Cancel" : "Connect";
    $("go").classList.toggle("primary", s !== "open");
    $("err").textContent = (s === "failed" || s === "denied") ? (Link.err || "Could not connect") : s === "pending" ? "Click Allow in the Thunder Gamepad window on your PC…" : "";
    if ($("hint")) $("hint").style.display = (Link.conn.pc && Link.conn.pcs && Link.conn.pcs[Link.conn.pc]) ? "none" : "";
    renderPadSeg();
    const i = Link.info;
    $("stat").textContent = s === "open" && i ? (i.host + " · " + (i.pad === "none" ? "keys + mouse" : i.pad) + (Link.rtt != null ? " · " + Link.rtt + " ms" : "") + (i.padError ? " · pad driver missing" : "")) : "";
  }

  document.querySelectorAll(".test").forEach(b => b.onclick = () => {
    if (Link.state !== "open") return toast("Connect first");
    const t = b.dataset.test;
    if (t === "a") Engine.tap("pad:A", 120, H, "test");
    if (t === "space") Engine.tap("key:space", 80, H, "test");
    if (t === "mouse") Engine.macro([{move: [60, 0]}, {wait: 120}, {move: [-60, 0]}], H, "test");
  });

  Link.on((ev) => {
    if (ev === "link" || ev === "rtt") renderLink();
    if (ev === "link") renderContinue();
    if (ev === "found") renderFound();
    if (ev && ev.type === "rumble" && settings.rumble) Link.vibrate(Math.max(15, Math.min(200, Math.round(Math.max(ev.l, ev.s) / 255 * 200))), Math.max(40, Math.max(ev.l, ev.s)));
    if (ev && ev.t === "imported") importDone(ev);
    if (ev && ev.t === "exported") toast(ev.ok ? "Saved" : "Could not save");
    if (ev === "link" && Link.state !== "open") Engine.releaseAll(H, false);
  });

  /* ---------- layouts ---------- */
  const uid = () => Math.random().toString(36).slice(2, 10);
  function saveLayouts() { jset(LKEY, layouts); }
  /* ready-made Xbox 360 / PlayStation layouts: added once on first start, and again on demand with the buttons in Layouts */
  function addPreset(key, id, edited) {
    const P = (window.Presets ? Presets.list : []).find(p => p.key === key); if (!P) return;
    layouts[id] = {name: P.name, data: P.make(), edited: edited || Date.now()};
  }
  try {
    if (!localStorage.getItem("padlink.seeded")) {
      const t = Date.now(); addPreset("xbox", "preset_xbox", t); addPreset("ps", "preset_ps", t - 1);
      localStorage.setItem("padlink.seeded", "1"); saveLayouts();
    }
  } catch (e) {}
  /* layouts shipped inside the APK (the repo's layouts/ folder is bundled at build time, with a generated layouts/index.json):
     added automatically on first start / when a new file appears; updated on app update ONLY if you never edited that copy;
     a layout you deleted stays deleted. Bookkeeping in localStorage "padlink.bundled" = {id: {h: content hash, e: edited stamp we wrote}} */
  const hashStr = t => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return String(h); };
  async function loadBundled() {
    let names; try { const r = await fetch("../layouts/index.json", {cache: "no-store"}); if (!r.ok) return; names = await r.json(); } catch (e) { return; }
    if (!Array.isArray(names)) return;
    const rec = jget("padlink.bundled", {}); let changed = false;
    for (const fn of names) {
      try {
        const r = await fetch("../layouts/" + encodeURIComponent(fn), {cache: "no-store"}); if (!r.ok) continue;
        const text = await r.text(); let data = JSON.parse(text);
        if (Array.isArray(data)) data = {settings: {}, layout: data};
        if (!data || !Array.isArray(data.layout)) continue;
        const name = String(fn).replace(/\.json$/i, "").trim() || "Layout", id = "bundled_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), h = hashStr(text), b = rec[id];
        if (!b) { const e = Date.now(); layouts[id] = {name, data, edited: e}; rec[id] = {h, e}; changed = true; }
        else if (layouts[id] && b.h !== h && layouts[id].edited === b.e) { layouts[id].data = data; rec[id] = {h, e: b.e}; changed = true; }
      } catch (e) {}
    }
    if (changed) { saveLayouts(); jset("padlink.bundled", rec); renderLibrary(); renderContinue(); }
  }
  function preview(data) {
    const items = (data && data.layout || []).filter(i => i.type === "button" || i.type === "stick").slice(0, 40);
    return items.map(i => '<i style="left:' + (+i.x || 0) + '%;top:' + (+i.y || 0) + '%;width:' + Math.max(6, (+i.s || 10) * 0.6) + 'px;height:' + Math.max(6, (+i.s || 10) * 0.6) + 'px;transform:translate(-50%,-50%)"></i>').join("");
  }
  function renderLibrary() {
    const ids = Object.keys(layouts).sort((a, b) => (layouts[b].edited || 0) - (layouts[a].edited || 0));
    $("cards").innerHTML = ids.length ? ids.map(id => {
      const l = layouts[id], n = (l.data.layout || []).length;
      return '<div class="lay" data-id="' + id + '"><div class="pv">' + preview(l.data) + '</div><div class="bd"><b>' + esc(l.name) + '</b><small>' + n + ' controls' + (l.played ? ' · played ' + ago(l.played) : '') + '</small>' +
        '<div class="acts"><button class="btn primary" data-a="play">Play</button><button class="btn" data-a="edit">Edit</button></div>' +
        '<div class="acts sub"><button class="btn" data-a="rename">Rename</button><button class="btn" data-a="dup">Duplicate</button><button class="btn" data-a="export">Export</button><button class="btn danger" data-a="del">Delete</button></div></div></div>';
    }).join("") : '<div class="empty">No layouts yet.<br>Tap <b>Import</b> to bring in an existing layout .json, or <b>New</b> to start fresh.</div>';
    $("cards").querySelectorAll("[data-a]").forEach(b => b.onclick = () => layoutAction(b.closest(".lay").dataset.id, b.dataset.a));
  }
  function layoutAction(id, a) {
    const l = layouts[id];
    if (a === "del") { Dlg.confirm('Delete "' + l.name + '"?').then(ok => { if (ok) { delete layouts[id]; saveLayouts(); renderLibrary(); } }); }
    else if (a === "export") { const nb = window.NativeBridge; if (nb) nb.exportFile(l.name.replace(/[^\w\- ]+/g, "") + ".json", JSON.stringify(l.data, null, 1)); }
    else if (a === "play") playLayout(id);
    else if (a === "rename") Dlg.prompt("Rename layout", l.name).then(n => { if (n) { rename(id, n); renderLibrary(); } });
    else if (a === "dup") { const nid = uid(); layouts[nid] = {name: l.name + " copy", data: JSON.parse(JSON.stringify(l.data)), edited: Date.now()}; saveLayouts(); renderLibrary(); toast("Duplicated"); }
    else if (a === "edit") Editor.open(recOf(id), {then: "library"});
  }
  document.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => { addPreset(b.dataset.preset, uid()); saveLayouts(); renderLibrary(); toast("Layout added"); });
  $("newLayout").onclick = async () => {
    const name = await Dlg.prompt("Layout name", "New layout"); if (!name) return;
    layouts[uid()] = {name, data: {settings: {}, layout: window.Editor ? Editor.defaultLayout() : []}, edited: Date.now()}; saveLayouts(); renderLibrary();
  };
  function ago(t) { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + " h ago"; const d = Math.round(h / 24); return d + (d === 1 ? " day ago" : " days ago"); }
  function playLayout(id) {
    if (!layouts[id]) return;
    const k = layouts[id].data && layouts[id].data.settings && layouts[id].data.settings.pad;   // PlayStation layout -> PC pretends to be a DualShock 4
    if ((k === "xbox" || k === "ds4") && Link.conn.pad !== k) Link.setPad(k);
    layouts[id].played = Date.now(); saveLayouts(); Play.start(recOf(id)); }
  function lastPlayed() { const ids = Object.keys(layouts).filter(i => layouts[i].played).sort((a, b) => layouts[b].played - layouts[a].played); return ids[0] || null; }
  function renderContinue() {
    const id = lastPlayed() || Object.keys(layouts).sort((a, b) => (layouts[b].edited || 0) - (layouts[a].edited || 0))[0], box = $("cont");
    if (!id) { box.innerHTML = '<div class="hint">No layouts yet. Open <b>Layouts</b> to import one or create a new one.</div>'; return; }
    const l = layouts[id], on = Link.state === "open";
    box.innerHTML = '<div class="card cont"><div><small class="muted">' + (l.played ? "Continue playing" : "Ready to play") + '</small><b>' + esc(l.name) + '</b><small class="muted">' + (on ? "Connected - controls go straight to the PC" : "Not connected yet") + '</small></div><button class="btn primary" id="contGo">▶ Play</button></div>';
    $("contGo").onclick = () => { if (!on) toast("Not connected - inputs won't reach the PC"); playLayout(id); };
  }
  /* editor / play hooks */
  const recOf = id => Object.assign({id}, layouts[id]);
  function saveLayout(id, data) { if (!layouts[id]) return; layouts[id].data = data; layouts[id].edited = Date.now(); saveLayouts(); }
  function rename(id, name) { if (layouts[id] && name) { layouts[id].name = name; saveLayouts(); } }
  function afterEdit(id, then) { if (then === "play" && layouts[id]) playLayout(id); else { go("library"); } }
  $("importLayout").onclick = () => { if (window.NativeBridge) window.NativeBridge.importFile(); else toast("Import works inside the app"); };
  function importDone(ev) {
    if (ev.error) return toast("Import failed: " + ev.error);
    try {
      let data = JSON.parse(ev.text);
      if (Array.isArray(data)) data = {settings: {}, layout: data};   // older/simple files are just the list of controls
      if (!data || !Array.isArray(data.layout)) throw new Error("not a layout file");
      layouts[uid()] = {name: String(ev.name || "").split(/[\\/:]/).pop().replace(/\.json$/i, "").trim() || "Imported", data, edited: Date.now()};
      saveLayouts(); renderLibrary(); toast("Imported");
    } catch (e) { toast("Not a valid layout file"); }
  }

  /* ---------- settings ---------- */
  const SET_ROWS = [
    ["haptics", "Touch vibration", "Short buzz when you press a control"],
    ["rumble", "Game rumble", "Vibrate the phone when the game rumbles"],
    ["keepAwake", "Keep screen on", "Stops the screen sleeping while you play"],
    ["immersive", "Hide system bars", "Full-screen while using the app"],
    ["autoReconnect", "Auto-reconnect", "Reconnect to the PC if Wi-Fi drops or you switch apps"],
    ["nativeFallback", "Compatibility mode", "Off = fastest (direct link). Turn on ONLY if the app cannot connect; it then uses a slower route through Android"],
  ];
  function applySettings() {
    jset(SKEY, settings);
    const nb = window.NativeBridge;
    if (nb) { nb.keepAwake(!!settings.keepAwake); nb.immersive(!!settings.immersive); }
  }
  function renderSettings() {
    $("setList").innerHTML = SET_ROWS.map(r => '<div class="set"><div><b>' + r[1] + '</b><small>' + r[2] + '</small></div><div class="sw' + (settings[r[0]] ? " on" : "") + '" data-k="' + r[0] + '"></div></div>').join("");
    $("setList").querySelectorAll(".sw").forEach(el => el.onclick = () => { settings[el.dataset.k] = !settings[el.dataset.k]; applySettings(); renderSettings(); });
    const ss = Math.round((settings.stickSens || 1) * 100) / 100;
    $("setList").insertAdjacentHTML("afterbegin", '<div class="set" style="display:block"><div style="display:flex;justify-content:space-between"><b>Joystick sensitivity</b><b id="ssVal">' + ss.toFixed(2) + 'x</b></div>' +
      '<small>All sticks. 1.00x = normal. Higher = full speed with a smaller push, lower = gentler. Applies instantly, also while playing.</small>' +
      '<input id="ssRange" type="range" min="0.3" max="3" step="0.05" value="' + ss + '" style="width:100%;margin-top:8px"> <button id="ssReset" class="btn">Reset to 1.00x</button></div>');
    $("ssRange").oninput = e => { settings.stickSens = parseFloat(e.target.value); $("ssVal").textContent = settings.stickSens.toFixed(2) + "x"; jset(SKEY, settings); };
    $("ssReset").onclick = () => { settings.stickSens = 1; jset(SKEY, settings); renderSettings(); };
  }

  window.App = {
    back() { if (window.Editor && Editor.active) return Editor.back(); if (window.Play && Play.active) return Play.back(); if (screen !== "connect") { go("connect"); return true; } return false; },
    settings: () => settings, H, toast, recOf, saveLayout, rename, afterEdit, afterPlay() { if (screen === "library") renderLibrary(); renderContinue(); },
  };
  renderPadSeg(); renderLink(); renderFound(); applySettings(); renderContinue(); loadBundled();
  if (!Link.autoStart()) { $("findNote").textContent = "Searching…"; Link.discover(); }   // remembered PC -> connect on its own; otherwise look for one
})();
