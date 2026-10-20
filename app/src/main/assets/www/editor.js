/* Thunder Gamepad layout editor: full-viewport canvas (so sizes match the play screen exactly), top bar, right-hand inspector drawer.
   Editor.open(rec, {then:"play"|"library"})  rec = {id,name,data:{settings,layout},edited}
   Everything the old laptop window could edit is reachable here: quick fields, macro text editor, appearance, and a raw JSON box. */
(function (global) {
  "use strict";
  const $ = id => document.getElementById(id);
  const U = global.Play.util;
  const {normalize, normalizeAll, buildEl, applyCfg, isZone, isUi, toAction, DEF_SET, place, vmin, esc, clamp, uid} = U;
  const PAD = ["A","B","X","Y","LB","RB","LT","RT","START","BACK","GUIDE","LS","RS","UP","DOWN","LEFT","RIGHT","TOUCHPAD"];
  const MOUSEB = ["left","right","middle","x1","x2","scrollup","scrolldown","scrollleft","scrollright"];
  const SIMPLE_KINDS = ["pad","key","mouse","page","combo","wheel","text","chat","macro","multi","stick","trigger","mousemove","mouseto","autoclick","limit","none"];
  const KIND_DEFAULT = {pad:{value:"A"}, key:{value:""}, mouse:{value:"left"}, page:{value:"main"}, combo:{value:"LB+RS"}, wheel:{value:"0"}, text:{value:""}, chat:{value:"t"},
    macro:{steps:[{tap:"key:space"},{wait:100}]}, multi:{actions:["pad:LB","pad:A"]}, stick:{side:"right", x:0, y:1}, trigger:{value:"RT", amount:1},
    mousemove:{dx:100, dy:0}, mouseto:{x:0.5, y:0.5}, autoclick:{target:{kind:"pad", value:"B"}, min:400, max:900, holdMin:28, holdMax:85, pauses:true}, limit:{stick:"left", radius:0.4}, none:{}};
  const SNAPS = [0, 1, 2.5, 5];
  const clone = o => JSON.parse(JSON.stringify(o));

  const root = $("editor"), stage = $("edStage"), drawer = $("edDrawer"), handle = $("edHandle"), addMenu = $("edAddMenu");
  let rec = null, then = "library", cfg = {}, items = [], page = "main", selId = null, snapIx = 0, drawerOpen = false, active = false;
  let undoS = [], redoS = [], lastKey = "", lastT = 0, saveT = 0;

  /* ---------- default layout (old Xbox-style template) ---------- */
  const btn = (label, x, y, s, value, extra) => Object.assign({type: "button", label, x, y, s, action: {kind: "pad", value}}, extra || {});
  const stickItem = (x, y, s, mode) => ({type: "stick", label: "", x, y, s, mode, keys: {up: "w", down: "s", left: "a", right: "d"}});
  function defaultLayout() {
    return normalizeAll([
      btn("LT", 9, 12, 13, "LT"), btn("LB", 9, 30, 13, "LB"), btn("RT", 91, 12, 13, "RT"), btn("RB", 91, 30, 13, "RB"),
      btn("BACK", 41, 10, 10, "BACK"), btn("G", 50, 10, 10, "GUIDE"), btn("START", 59, 10, 10, "START"),
      stickItem(15, 68, 34, "left"),
      btn("▲", 36, 50, 12, "UP"), btn("▼", 36, 78, 12, "DOWN"), btn("◀", 28, 64, 12, "LEFT"), btn("▶", 44, 64, 12, "RIGHT"),
      btn("Y", 84, 36, 14, "Y"), btn("A", 84, 68, 14, "A"), btn("X", 74, 52, 14, "X"), btn("B", 94, 52, 14, "B"),
      stickItem(63, 74, 28, "right"), btn("L3", 27, 92, 9, "LS"), btn("R3", 72, 92, 9, "RS"),
    ]);
  }

  /* ---------- state, history, saving ---------- */
  const matchPage = it => it.page === "*" || (Array.isArray(it.page) ? it.page.includes(page) : it.page === page);
  function pageList() {
    const set = new Set(["main"]);
    items.forEach(it => (Array.isArray(it.page) ? it.page : [it.page]).forEach(p => { if (p && p !== "*") set.add(p); }));
    return Array.from(set);
  }
  const cur = () => items.find(i => i.id === selId) || null;
  const snapshot = () => JSON.stringify({items, cfg});
  function pushUndo(key) {
    const now = Date.now();
    if (key && key === lastKey && now - lastT < 700) { lastT = now; return; }
    lastKey = key || ""; lastT = now;
    undoS.push(snapshot()); if (undoS.length > 80) undoS.shift();
    redoS = [];
  }
  function restore(str) {
    const d = JSON.parse(str); items = d.items.map(r => normalize(r)); cfg = d.cfg;
    applyCfg(root, cfg);
    if (!items.some(i => i.id === selId)) selId = null;
    if (!pageList().includes(page)) page = "main";
    save(); render(); drawerRefresh();
  }
  function undo() { if (!undoS.length) return; redoS.push(snapshot()); restore(undoS.pop()); lastKey = ""; }
  function redo() { if (!redoS.length) return; undoS.push(snapshot()); restore(redoS.pop()); lastKey = ""; }
  function save(now) {
    clearTimeout(saveT);
    const go = () => { if (rec) global.App.saveLayout(rec.id, {settings: clone(cfg), layout: clone(items)}); };
    if (now) go(); else saveT = setTimeout(go, 150);
  }
  function mutate(fn, key) { pushUndo(key); fn(); save(); render(); }

  /* ---------- canvas ---------- */
  function render() {
    stage.innerHTML = "";
    items.filter(matchPage).forEach(it => {
      const {el} = buildEl(it, true);
      el.dataset.id = it.id;
      if (it.id === selId) el.classList.add("selected");
      bindDrag(el, it);
      stage.appendChild(el);
    });
    placeHandle(); renderBar();
  }
  const elOf = () => stage.querySelector('[data-id="' + selId + '"]');
  function placeHandle() {
    const el = selId && elOf();
    if (!el) { handle.hidden = true; return; }
    const r = el.getBoundingClientRect();
    handle.hidden = false;
    handle.style.left = Math.min(r.right, innerWidth - 16) + "px"; handle.style.top = Math.min(r.bottom, innerHeight - 16) + "px";
  }
  function select(id) {
    selId = id;
    stage.querySelectorAll(".el").forEach(e => e.classList.toggle("selected", e.dataset.id === id));
    placeHandle();
  }
  function bindDrag(el, it) {
    let pid = null, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); e.stopPropagation(); if (pid !== null) return; pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch (_) {}
      moved = false; sx = e.clientX; sy = e.clientY; ox = it.x; oy = it.y; closeMenu();
      select(it.id);
    });
    el.addEventListener("pointermove", e => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > 5) { moved = true; pushUndo(null); drawer.classList.add("dim"); }
      if (!moved) return;
      const sn = SNAPS[snapIx];
      let nx = ox + dx / innerWidth * 100, ny = oy + dy / innerHeight * 100;
      if (sn) { nx = Math.round(nx / sn) * sn; ny = Math.round(ny / sn) * sn; }
      it.x = clamp(+nx.toFixed(2), 0, 100); it.y = clamp(+ny.toFixed(2), 0, 100);
      place(el, it); placeHandle();
    });
    const end = e => {
      if (e.pointerId !== pid) return; pid = null; drawer.classList.remove("dim");
      if (moved) save();
      drawerOpen = true; drawerMode = "item"; drawerRefresh();
    };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }
  stage.addEventListener("pointerdown", e => {          // empty canvas: deselect
    if (e.target !== stage) return;
    closeMenu(); select(null); drawerMode = "layout"; drawerRefresh();
  });
  /* resize handle */
  (function () {
    let hp = null, hc = null;
    handle.addEventListener("pointerdown", e => {
      const it = cur(), el = elOf(); if (!it || !el) return;
      e.preventDefault(); e.stopPropagation(); hp = e.pointerId; try { handle.setPointerCapture(hp); } catch (_) {}
      const r = el.getBoundingClientRect(); hc = {x: r.left + r.width / 2, y: r.top + r.height / 2};
      pushUndo(null); drawer.classList.add("dim");
    });
    handle.addEventListener("pointermove", e => {
      if (e.pointerId !== hp) return;
      const it = cur(), el = elOf(); if (!it || !el) return;
      const dx = Math.abs(e.clientX - hc.x), dy = Math.abs(e.clientY - hc.y);
      if (isZone(it)) { it.w = clamp(Math.round(2 * dx / innerWidth * 100), 4, 100); it.h = clamp(Math.round(2 * dy / innerHeight * 100), 4, 100); }
      else it.s = clamp(Math.round(2 * Math.max(dx, dy) / vmin() * 2) / 2, 4, 80);
      place(el, it); placeHandle();
    });
    const end = e => { if (e.pointerId !== hp) return; hp = null; drawer.classList.remove("dim"); save(); drawerRefresh(); };
    handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  })();

  /* ---------- top bar ---------- */
  function renderBar() {
    $("edTabs").innerHTML = pageList().map(p => '<button class="tab' + (p === page ? " on" : "") + '" data-p="' + esc(p) + '">' + esc(p) + '</button>').join("") + '<button class="tab" id="edNewPage">＋</button>';
    $("edTabs").querySelectorAll("[data-p]").forEach(b => b.onclick = () => { page = b.dataset.p; select(null); render(); drawerMode = "layout"; drawerRefresh(); });
    $("edNewPage").onclick = async () => {
      const n = await Dlg.prompt("Name for the new page", ""); if (!n) return;
      page = n; select(null); render();          // a page exists once an item is on it: show it as a tab right away
      const tab = document.createElement("button"); tab.className = "tab on"; tab.textContent = n; $("edTabs").insertBefore(tab, $("edNewPage"));
    };
    $("edUndo").disabled = !undoS.length; $("edRedo").disabled = !redoS.length;
    $("edSnap").textContent = SNAPS[snapIx] ? "Snap " + SNAPS[snapIx] + "%" : "Snap off";
  }
  $("edUndo").onclick = undo; $("edRedo").onclick = redo;
  $("edSnap").onclick = () => { snapIx = (snapIx + 1) % SNAPS.length; renderBar(); };
  $("edPanel").onclick = () => { if (drawerOpen && drawerMode === "layout") drawerOpen = false; else { drawerOpen = true; drawerMode = "layout"; } drawerRefresh(); };
  $("edDone").onclick = () => close(then);
  $("edPlay").onclick = () => close("play");
  function closeMenu() { addMenu.hidden = true; }
  $("edAdd").onclick = () => {
    if (!addMenu.hidden) return closeMenu();
    addMenu.innerHTML = [["button", "Button"], ["stick", "Joystick"], ["look", "Look zone"], ["slider", "Slider"], ["label", "Label"]].map(a => '<button data-add="' + a[0] + '">' + a[1] + '</button>').join("");
    addMenu.hidden = false;
    { const r = $("edAdd").getBoundingClientRect(); addMenu.style.top = Math.round(r.bottom + 4) + "px"; addMenu.style.left = Math.max(4, Math.min(innerWidth - 150, Math.round(r.left))) + "px"; }
    addMenu.querySelectorAll("[data-add]").forEach(b => b.onclick = () => { closeMenu(); addItem(b.dataset.add); });
  };
  function addItem(kind) {
    const base = {
      button: btn("?", 50, 50, 14, "A"), stick: stickItem(50, 50, 30, "left"),
      look: {type: "look", x: 50, y: 50, w: 60, h: 60}, slider: {type: "slider", x: 50, y: 50, w: 8, h: 60, target: "RT"},
      label: {type: "label", label: "Label", x: 50, y: 50, s: 14},
    }[kind];
    const it = normalize(Object.assign({}, base, {page: page === "*" ? "main" : page}));
    mutate(() => items.push(it)); select(it.id); drawerOpen = true; drawerMode = "item"; drawerRefresh();
  }

  /* ---------- macro / multi text format (one step per line) ---------- */
  const num = (v, line) => { const n = Number(v); if (!isFinite(n)) throw new Error("line " + line + ": '" + v + "' is not a number"); return n; };
  function parseMacro(text) {
    const steps = [];
    text.split("\n").forEach((raw, i) => {
      const ln = raw.trim(), n = i + 1; if (!ln || ln[0] === "#") return;
      const t = ln.split(/\s+/), c = t[0].toLowerCase();
      if (c === "wait") steps.push({wait: num(t[1], n)});
      else if (c === "down" || c === "up") { if (!t[1]) throw new Error("line " + n + ": " + c + " needs an input, e.g. pad:LB"); steps.push({[c]: t[1]}); }
      else if (c === "tap") { if (!t[1]) throw new Error("line " + n + ": tap needs an input"); const s = {tap: t[1]}; if (t[2] != null) s.ms = num(t[2], n); steps.push(s); }
      else if (c === "stick") steps.push({stick: t[1] || "right", x: num(t[2] == null ? 0 : t[2], n), y: num(t[3] == null ? 0 : t[3], n)});
      else if (c === "trigger") steps.push({trigger: t[1] || "RT", amount: t[2] == null ? 1 : num(t[2], n)});
      else if (c === "text") steps.push({text: ln.slice(4).trim()});
      else if (c === "move") steps.push({move: [num(t[1], n), num(t[2], n)]});
      else if (c === "moveto") steps.push({moveto: [num(t[1], n), num(t[2], n)]});
      else if (c === "scroll") steps.push({scroll: num(t[1], n)});
      else if (c === "hscroll") steps.push({hscroll: num(t[1], n)});
      else throw new Error("line " + n + ": unknown step '" + t[0] + "'");
    });
    return steps;
  }
  function formatMacro(steps) {
    const out = [];
    for (let st of steps || []) {
      if (typeof st === "number") st = {wait: st};
      if (typeof st === "string") st = {tap: st};
      if (!st || typeof st !== "object") return null;
      if ("wait" in st) out.push("wait " + st.wait);
      else if ("down" in st) out.push("down " + (typeof st.down === "string" ? st.down : null));
      else if ("up" in st) out.push("up " + (typeof st.up === "string" ? st.up : null));
      else if ("tap" in st) out.push("tap " + st.tap + (st.ms != null ? " " + st.ms : ""));
      else if ("stick" in st) out.push("stick " + st.stick + " " + (st.x || 0) + " " + (st.y || 0));
      else if ("trigger" in st) out.push("trigger " + st.trigger + (st.amount != null ? " " + st.amount : ""));
      else if ("text" in st) out.push("text " + st.text);
      else if ("move" in st) out.push("move " + st.move[0] + " " + st.move[1]);
      else if ("moveto" in st) out.push("moveto " + st.moveto[0] + " " + st.moveto[1]);
      else if ("scroll" in st) out.push("scroll " + st.scroll);
      else if ("hscroll" in st) out.push("hscroll " + st.hscroll);
      else return null;                                    // e.g. "repeat": only editable in the JSON box
    }
    const s = out.join("\n");
    return s.includes("null") ? null : s;
  }

  /* ---------- drawer ---------- */
  let drawerMode = "layout";
  const opt = (list, c) => list.map(v => '<option value="' + esc(v) + '"' + (String(v) === String(c) ? " selected" : "") + '>' + esc(v) + '</option>').join("");
  const F = (label, inner) => '<div class="f"><label>' + label + '</label>' + inner + '</div>';
  const I = (path, val, o) => { o = o || {}; return '<input data-f="' + path + '" data-t="' + (o.t || "str") + '"' + (o.sp ? ' data-sp="' + o.sp + '"' : "") + (o.re ? ' data-re="1"' : "") + ' type="' + (o.type || "text") + '" value="' + esc(val == null ? "" : val) + '" ' + (o.attrs || 'autocapitalize="off" autocomplete="off"') + '>'; };
  const R = (path, val, min, max, step, o) => I(path, val, Object.assign({type: "range", t: "num", attrs: 'min="' + min + '" max="' + max + '" step="' + step + '"'}, o || {}));
  const N = (path, val, min, step) => I(path, val, {type: "number", t: "num", attrs: 'step="' + step + '" data-min="' + min + '"'});
  const S = (path, list, c, o) => '<select data-f="' + path + '"' + (o && o.sp ? ' data-sp="' + o.sp + '"' : "") + (o && o.re ? ' data-re="1"' : "") + '>' + opt(list, c) + '</select>';
  const C = (path, val, label, o) => '<label class="chk"><input data-f="' + path + '" data-t="bool"' + (o && o.sp ? ' data-sp="' + o.sp + '"' : "") + (o && o.re ? ' data-re="1"' : "") + ' type="checkbox"' + (val ? " checked" : "") + '>' + label + '</label>';

  function drawerRefresh() {
    drawer.hidden = !drawerOpen;
    if (!drawerOpen) return;
    if (drawerMode === "item" && cur()) inspector(); else { drawerMode = "layout"; layoutPanel(); }
  }
  function head(title) { return '<div class="dh"><b>' + title + '</b><button id="edDrawerX" class="eb">✕</button></div>'; }
  function wireHead() { const x = $("edDrawerX"); if (x) x.onclick = () => { drawerOpen = false; drawerRefresh(); }; }

  function actionFields(a) {
    let h = F("Action", S("action.kind", SIMPLE_KINDS, a.kind, {sp: "kind", re: 1}));
    const k = a.kind;
    if (k === "pad") h += F("Pad button", S("action.value", PAD, String(a.value).toUpperCase()));
    else if (k === "mouse") h += F("Mouse", S("action.value", MOUSEB, a.value));
    else if (["key", "page", "combo", "text", "chat", "wheel"].includes(k)) {
      const lab = {key: "Key(s): w, space, ctrl+shift+s, f5, num1", page: "Page name (or next / prev / back)", combo: "Held together: LB+RS or ctrl+c", text: "Text to type", chat: "Key that opens chat (t, or /)", wheel: "Angle in degrees (0 up, 90 right, 180 down, 270 left)"}[k];
      h += F(lab, I("action.value", a.value));
    } else if (k === "autoclick") {
      const T = toAction(a.target) || {kind: "pad", value: "B"}, tk = ["pad", "key", "mouse"].includes(T.kind) ? T.kind : "pad";
      h += F("Button to auto-click", S("action.target.kind", ["pad", "key", "mouse"], tk, {sp: "tkind", re: 1}) +
        (tk === "pad" ? S("action.target.value", PAD, String(T.value).toUpperCase()) : tk === "mouse" ? S("action.target.value", ["left", "right", "middle", "x1", "x2"], T.value) : I("action.target.value", T.value)));
      h += F("Gap between clicks, ms (random in range)", '<div class="two">' + N("action.min", a.min != null ? a.min : 400, 25, 5) + N("action.max", a.max != null ? a.max : 900, 30, 5) + '</div>');
      h += F("Press length, ms (random in range)", '<div class="two">' + N("action.holdMin", a.holdMin != null ? a.holdMin : 28, 10, 1) + N("action.holdMax", a.holdMax != null ? a.holdMax : 85, 14, 1) + '</div>');
      h += C("action.pauses", a.pauses !== false, "Occasional pauses (more human)");
    } else if (k === "macro") {
      const t = formatMacro(a.steps);
      h += t == null ? '<div class="note">This macro uses steps (like repeat) the text editor can\'t show. Edit it in Advanced (JSON) below.</div>'
        : F("Steps, one per line", '<textarea data-sp="macro" rows="8" spellcheck="false">' + esc(t) + '</textarea><div class="err" id="edMacroErr"></div><div class="note">wait 700 · down pad:LB · up pad:LB · tap pad:B 80 · stick right 0 -1 · trigger RT 1 · text hello · move 60 0 · moveto 0.5 0.5 · scroll 1 · hscroll 1</div>');
    } else if (k === "multi") {
      h += F("Actions pressed together, one per line", '<textarea data-sp="multi" rows="4" spellcheck="false">' + esc((a.actions || []).map(x => typeof x === "string" ? x : JSON.stringify(x)).join("\n")) + '</textarea>');
    } else if (k === "stick") {
      h += F("Stick", S("action.side", ["left", "right"], a.side || "right")) + F("Push x / y (-1 … 1)", '<div class="two">' + N("action.x", a.x || 0, -1, 0.1) + N("action.y", a.y || 0, -1, 0.1) + '</div>');
    } else if (k === "limit") {
      h += F("Stick to limit", S("action.stick", ["left", "right", "both"], a.stick || "left"));
      h += F("Radius (0.05 … 1, 1 = no limit)", N("action.radius", a.radius == null ? 0.4 : a.radius, 0.05, 0.05));
      h += '<div class="note">While this button is on, that stick never goes past this radius (the finger still moves freely). Left and right sticks are limited independently, so a Walk and a Cinema button can both be on. Smaller = slower/gentler.</div>';
    } else if (k === "trigger") {
      h += F("Trigger", S("action.value", ["LT", "RT"], a.value || "RT")) + F("Amount (0 … 1)", N("action.amount", a.amount == null ? 1 : a.amount, 0, 0.1));
    } else if (k === "mousemove") h += F("Move mouse by dx / dy (px)", '<div class="two">' + N("action.dx", a.dx || 0, -9999, 5) + N("action.dy", a.dy || 0, -9999, 5) + '</div>');
    else if (k === "mouseto") h += F("Mouse to x / y (0 … 1 of screen)", '<div class="two">' + N("action.x", a.x == null ? 0.5 : a.x, 0, 0.05) + N("action.y", a.y == null ? 0.5 : a.y, 0, 0.05) + '</div>');
    return h;
  }

  function inspector() {
    const it = cur();
    let h = head(esc(it.type) + (it.label ? ' · ' + esc(it.label) : ""));
    h += '<div class="db">';
    if (it.type !== "slider" && it.type !== "look" || it.label) h += F("Label", I("label", it.label));
    h += isZone(it) ? F("Width / height %", '<div class="two">' + N("w", it.w, 4, 1) + N("h", it.h, 4, 1) + '</div>') : F("Size", R("s", it.s, 4, 80, 0.5));
    h += F("Position x / y %", '<div class="two">' + N("x", it.x, 0, 0.5) + N("y", it.y, 0, 0.5) + '</div>');
    if (it.type === "button") {
      h += F("Shape", S("shape", ["circle", "square", "pill", "rect", "none"], it.shape || "circle", {sp: "shape"}));
      if (isUi(it)) h += F("UI button", S("action.value", ["edit", "exit"], it.action.value)) + '<div class="note">Release-all, edit and exit are also in the pill at the top while playing.</div>';
      else {
        h += actionFields(it.action);
        h += C("toggle", (it.action.kind === "autoclick" || it.action.kind === "limit") ? it.toggle !== false : it.toggle, "Toggle (tap on / tap off)");
        h += F("Go to page after press (optional)", I("goto", it.goto || "", {sp: "goto"}));
        h += F("Group (only one highlighted at a time)", I("group", it.group || "", {sp: "goto"}));
        if (it.action.kind === "mouse" && !String(it.action.value).startsWith("scroll")) {
          const am = it.aim === "stick" || it.aim === "drag" ? it.aim : "none";
          h += F("Aim by moving the finger while held", S("aim", ["none", "stick", "drag"], am, {sp: "aim", re: 1}));
          if (am === "stick") h += F("Aim speed", R("aimSpeed", typeof it.aimSpeed === "number" ? it.aimSpeed : 22, 4, 80, 1));
          if (am === "drag") h += F("Aim sensitivity", R("sens", typeof it.sens === "number" ? it.sens : 3, 0.5, 8, 0.1));
        }
        h += F("Turbo: repeat every ms (0 = off)", N("turbo", it.turbo || 0, 0, 10)) + F("Pulse: tap length ms (0 = off)", N("pulse", it.pulse || 0, 0, 10));
      }
    } else if (it.type === "stick") {
      h += F("Mode", S("mode", ["left", "right", "keys", "dpad", "mouse"], it.mode, {sp: "smode", re: 1}));
      h += C("floating", it.floating, "Floating (appears where you touch)", {sp: "float", re: 1});
      if (it.mode === "keys") h += C("dpad", it.dpad, "Plus-shaped D-pad look");
      if (it.mode === "keys" || it.mode === "dpad") ["up", "down", "left", "right"].forEach(d => {
        const v = it.keys[d]; h += F(d + " action (key, or e.g. pad:UP)", I("keys." + d, typeof v === "string" ? v : JSON.stringify(v), {sp: "keyact"}));
      });
      if (it.mode === "mouse") h += F("Mouse speed", R("sens", it.sens || 12, 2, 40, 1));
      else if (it.mode === "left" || it.mode === "right") h += F("Sensitivity (1 = normal, higher = full speed with a smaller push)", R("sens", it.sens > 0 ? it.sens : 1, 0.3, 3, 0.05));
      if (it.mode !== "keys" && it.mode !== "dpad") h += F("Deadzone", R("deadzone", it.deadzone || 0, 0, 0.6, 0.02));
    } else if (it.type === "look") {
      h += F("Mode", S("mode", ["mouse", "rstick", "lstick", "scroll"], it.mode)) + F("Sensitivity", R("sens", it.sens, 0.2, 8, 0.1));
      h += F("Tap", S("tap", ["none", "left", "right", "middle"], typeof it.tap === "string" ? it.tap : "none")) + F("Hold", S("hold", ["none", "left", "right", "middle"], typeof it.hold === "string" ? it.hold : "none"));
      h += F("Hold time (ms)", R("holdMs", it.holdMs, 150, 700, 10)) + C("invertY", it.invertY, "Invert vertical");
    } else if (it.type === "slider") {
      h += F("Target", S("target", ["LT", "RT", "lx", "ly", "rx", "ry"], it.target)) + C("spring", it.spring !== false, "Spring back to rest on release");
    }
    h += F("Shown on page(s) (name, comma-separated, or * for all)", I("page", Array.isArray(it.page) ? it.page.join(",") : it.page, {sp: "page"}));
    h += '<details><summary>Appearance</summary>' +
      F("Fill colour", '<div class="clr"><input type="color" data-f="color" data-t="str" value="' + esc(it.color || "#24242a") + '"><button data-clear="color" class="eb">reset</button></div>') +
      F("Border colour", '<div class="clr"><input type="color" data-f="border" data-t="str" value="' + esc(it.border || "#45454f") + '"><button data-clear="border" class="eb">reset</button></div>') +
      F("Text colour", '<div class="clr"><input type="color" data-f="textColor" data-t="str" value="' + esc(it.textColor || "#eeeeee") + '"><button data-clear="textColor" class="eb">reset</button></div>') +
      F("Opacity", '<div class="clr">' + R("opacity", typeof it.opacity === "number" ? it.opacity : 1, 0.1, 1, 0.05) + '<button data-clear="opacity" class="eb">reset</button></div>') +
      F("Rotate °", '<div class="clr">' + R("rotate", it.rotate || 0, -180, 180, 5) + '<button data-clear="rotate" class="eb">reset</button></div>') +
      F("Text size ×", '<div class="clr">' + R("fontSize", it.fontSize || 1, 0.5, 2.5, 0.05) + '<button data-clear="fontSize" class="eb">reset</button></div>') +
      C("hidden", it.hidden, "Invisible while playing (still works)") + '</details>';
    const json = clone(it); delete json.id;
    h += '<details><summary>Advanced (JSON)</summary><textarea id="edJson" rows="10" spellcheck="false">' + esc(JSON.stringify(json, null, 1)) + '</textarea>' +
      '<div class="row"><button id="edJsonApply" class="eb">Apply</button><span class="err" id="edJsonErr"></span></div>' +
      '<div class="note">Everything the old laptop editor could do lives here too: long / double press, outer ring, click, colours, macros with repeat…</div></details>';
    h += '<div class="row end"><button id="edDup" class="eb">Duplicate</button><button id="edDel" class="eb danger">Delete</button></div></div>';
    drawer.classList.toggle("left", it.x > 50);        // open on the side away from the control so it can still be dragged
    drawer.innerHTML = h; wireHead(); wireFields(it);
    $("edDup").onclick = () => { const c = normalize(Object.assign(clone(it), {id: uid(), x: clamp(it.x + 4, 0, 100), y: clamp(it.y + 4, 0, 100)})); mutate(() => items.push(c)); select(c.id); drawerRefresh(); };
    $("edDel").onclick = () => { mutate(() => { items = items.filter(i => i.id !== it.id); }); select(null); drawerMode = "layout"; drawerRefresh(); };
    $("edJsonApply").onclick = () => {
      try {
        const o = JSON.parse($("edJson").value); if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("must be one JSON object");
        const n = normalize(Object.assign({}, o, {id: it.id}));
        mutate(() => { items[items.findIndex(i => i.id === it.id)] = n; }); inspector();
      } catch (e) { $("edJsonErr").textContent = String(e.message || e); }
    };
  }

  const setPath = (o, path, v) => { const p = path.split("."); let t = o; for (let i = 0; i < p.length - 1; i++) { if (t[p[i]] == null || typeof t[p[i]] !== "object") t[p[i]] = {}; t = t[p[i]]; } t[p[p.length - 1]] = v; };
  function wireFields(it) {
    drawer.querySelectorAll("[data-f]").forEach(e => {
      const fire = () => applyField(e);
      e.addEventListener("input", fire); e.addEventListener("change", fire);
    });
    drawer.querySelectorAll("[data-clear]").forEach(b => b.onclick = () => { mutate(() => { delete cur()[b.dataset.clear]; }); inspector(); });
    drawer.querySelectorAll("textarea[data-sp]").forEach(t => t.addEventListener("input", () => {
      const it2 = cur(); if (!it2) return;
      if (t.dataset.sp === "macro") {
        try { const steps = parseMacro(t.value); $("edMacroErr").textContent = ""; mutate(() => { it2.action.steps = steps; }, it2.id + "macro"); }
        catch (e) { $("edMacroErr").textContent = e.message; }
      } else {
        const acts = t.value.split("\n").map(s => s.trim()).filter(Boolean).map(s => { if (s[0] === "{") { try { return JSON.parse(s); } catch (_) {} } return s; });
        mutate(() => { it2.action.actions = acts; }, it2.id + "multi");
      }
    }));
  }
  function applyField(e) {
    const it = cur(); if (!it) return;
    const path = e.dataset.f, t = e.dataset.t;
    let v = e.type === "checkbox" ? e.checked : e.value;
    if (t === "num") { v = parseFloat(v); if (!isFinite(v)) return; const mn = e.getAttribute("data-min"); if (mn != null && v < parseFloat(mn)) return; }
    const sp = e.dataset.sp;
    mutate(() => {
      if (sp === "kind") it.action = Object.assign({kind: v}, clone(KIND_DEFAULT[v] || {}));
      else if (sp === "tkind") it.action.target = Object.assign({kind: v}, clone(KIND_DEFAULT[v] || {}));
      else if (sp === "shape") it.shape = v === "circle" ? undefined : v;
      else if (sp === "goto") it[path] = String(v).trim() || undefined;
      else if (sp === "aim") it.aim = v === "none" ? undefined : v;
      else if (sp === "page") { const l = String(v).split(",").map(s => s.trim()).filter(Boolean); it.page = l.length > 1 ? l : (l[0] || "main"); }
      else if (sp === "keyact") { let x = String(v).trim(); if (x[0] === "{") { try { x = JSON.parse(x); } catch (_) {} } it.keys[path.split(".")[1]] = x; }
      else if (sp === "smode") {
        it.mode = v;
        if (v === "keys" && !it.keys) it.keys = {up: "w", down: "s", left: "a", right: "d"};
        if (v === "dpad") { it.dpad = true; it.keys = {up: "pad:UP", down: "pad:DOWN", left: "pad:LEFT", right: "pad:RIGHT"}; }
        else if (v !== "keys") it.dpad = false;
      } else if (sp === "float") { it.floating = v; if (v) { it.w = it.w || 45; it.h = it.h || 80; } }
      else if (path === "toggle" && it.action && (it.action.kind === "autoclick" || it.action.kind === "limit")) it.toggle = v;
      else setPath(it, path, v);
    }, it.id + path);
    if (e.dataset.re) inspector(); else if (path === "label") { /* keep drawer title stable while typing */ }
  }

  /* ---------- layout panel (nothing selected) ---------- */
  function layoutPanel() {
    let h = head("Layout") + '<div class="db">';
    h += F("Name", '<input id="edName" value="' + esc(rec.name) + '" autocomplete="off">');
    h += '<div class="sec">Pages</div>' + pageList().map(p => '<div class="prow"><span>' + esc(p) + (p === page ? ' · <small>current</small>' : "") + '</span>' +
      (p === "main" ? "" : '<button class="eb" data-pr="' + esc(p) + '">Rename</button><button class="eb danger" data-pd="' + esc(p) + '">Delete</button>') + '</div>').join("");
    const here = items.filter(matchPage);
    h += '<div class="sec">On this page (' + here.length + ')</div><div class="ilist">' + here.map(i => '<button class="eb" data-sel="' + i.id + '">' + esc(i.type) + (i.label ? " · " + esc(i.label) : "") + '</button>').join("") + '</div>';
    h += '<details><summary>Theme</summary>' + [["background", "Background"], ["button", "Button"], ["buttonBorder", "Button border"], ["square", "Square button"], ["squareBorder", "Square border"], ["active", "Pressed"], ["activeBorder", "Pressed border"]]
      .map(c => F(c[1], '<input type="color" data-c="' + c[0] + '" value="' + esc(cfg[c[0]]) + '">')).join("") +
      F("Button opacity", '<input type="range" data-c="opacity" min="0.2" max="1" step="0.05" value="' + cfg.opacity + '">') +
      '<label class="chk"><input type="checkbox" data-c="haptics"' + (cfg.haptics !== false ? " checked" : "") + '>Vibrate on tap (this layout)</label>' +
      '<label class="chk"><input type="checkbox" data-c="rumble"' + (cfg.rumble !== false ? " checked" : "") + '>Game rumble (this layout)</label>' +
      '<div class="row"><button id="edThemeReset" class="eb">Reset theme</button></div></details>';
    h += '<div class="row end"><button id="edTpl" class="eb">Load Xbox template…</button></div></div>';
    drawer.classList.remove("left");
    drawer.innerHTML = h; wireHead();
    $("edName").onchange = () => { const v = $("edName").value.trim(); if (v) { rec.name = v; global.App.rename(rec.id, v); } };
    drawer.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => { select(b.dataset.sel); drawerMode = "item"; drawerRefresh(); });
    drawer.querySelectorAll("[data-pr]").forEach(b => b.onclick = async () => {
      const old = b.dataset.pr, n = await Dlg.prompt("Rename page", old); if (!n || n === old) return;
      mutate(() => items.forEach(i => { i.page = Array.isArray(i.page) ? i.page.map(p => p === old ? n : p) : (i.page === old ? n : i.page); }));
      if (page === old) page = n; drawerRefresh();
    });
    drawer.querySelectorAll("[data-pd]").forEach(b => b.onclick = async () => {
      const old = b.dataset.pd; if (!await Dlg.confirm('Delete page "' + old + '" and the controls only on it?')) return;
      mutate(() => {
        items = items.filter(i => !(i.page === old));
        items.forEach(i => { if (Array.isArray(i.page)) { i.page = i.page.filter(p => p !== old); if (i.page.length === 1) i.page = i.page[0]; } });
        items = items.filter(i => !(Array.isArray(i.page) && !i.page.length));
      });
      if (page === old) page = "main"; select(null); render(); drawerRefresh();
    });
    drawer.querySelectorAll("[data-c]").forEach(e => {
      const fire = () => { const k = e.dataset.c; mutate(() => { cfg[k] = e.type === "checkbox" ? e.checked : e.type === "range" ? parseFloat(e.value) : e.value; }, "cfg" + k); applyCfg(root, cfg); };
      e.addEventListener("input", fire); e.addEventListener("change", fire);
    });
    $("edThemeReset").onclick = () => { mutate(() => { cfg = Object.assign({}, DEF_SET); }); applyCfg(root, cfg); layoutPanel(); };
    $("edTpl").onclick = async () => { if (await Dlg.confirm("Replace everything in this layout with the Xbox template?")) { mutate(() => { items = defaultLayout(); }); page = "main"; select(null); render(); drawerRefresh(); } };
  }

  /* ---------- lifecycle ---------- */
  /* ---------- draggable toolbar ---------- */
  const bar = $("edBar"), grip = $("edGrip"), BKEY = "padlink.edbar";
  function placeBar(x, y) {
    const w = bar.offsetWidth || 300, h = bar.offsetHeight || 70;
    x = Math.max(0, Math.min(innerWidth - w, x)); y = Math.max(0, Math.min(innerHeight - h, y));
    bar.style.left = x + "px"; bar.style.top = y + "px"; return [x, y];
  }
  function restoreBar() {
    let p = null; try { p = JSON.parse(localStorage.getItem(BKEY)); } catch (e) {}
    if (p && isFinite(p.x) && isFinite(p.y)) placeBar(p.x, p.y); else { bar.style.left = "8px"; bar.style.top = ""; }
  }
  let gp = null;
  grip.addEventListener("pointerdown", e => { gp = {id: e.pointerId, dx: e.clientX - bar.offsetLeft, dy: e.clientY - bar.offsetTop}; grip.setPointerCapture(e.pointerId); closeMenu(); e.preventDefault(); });
  grip.addEventListener("pointermove", e => { if (gp && e.pointerId === gp.id) placeBar(e.clientX - gp.dx, e.clientY - gp.dy); });
  const gEnd = e => { if (!gp || e.pointerId !== gp.id) return; gp = null; try { localStorage.setItem(BKEY, JSON.stringify({x: bar.offsetLeft, y: bar.offsetTop})); } catch (er) {} };
  grip.addEventListener("pointerup", gEnd); grip.addEventListener("pointercancel", gEnd);
  window.addEventListener("resize", () => { if (active) placeBar(bar.offsetLeft, bar.offsetTop); });

  function open(r, opts) {
    rec = r; then = (opts && opts.then) || "library";
    const d = r.data || {};
    cfg = Object.assign({}, DEF_SET, d.settings || {});
    items = normalizeAll(d.layout || d.items || []);
    page = "main"; selId = null; undoS = []; redoS = []; drawerOpen = false; drawerMode = "layout"; snapIx = 0;
    applyCfg(root, cfg); root.hidden = false; active = true; closeMenu(); restoreBar();
    render(); drawerRefresh();
  }
  function close(next) {
    if (!active) return;
    save(true); active = false; root.hidden = true; stage.innerHTML = ""; drawer.hidden = true; closeMenu();
    const id = rec.id; global.App.afterEdit(id, next);
  }
  function back() {
    if (!addMenu.hidden) { closeMenu(); return true; }
    if (drawerOpen) { drawerOpen = false; drawerRefresh(); return true; }
    close(then); return true;
  }
  addEventListener("resize", () => { if (active) render(); });
  global.Editor = {open, close, back, defaultLayout, get active() { return active; }, _dsl: {parseMacro, formatMacro}};
})(window);
