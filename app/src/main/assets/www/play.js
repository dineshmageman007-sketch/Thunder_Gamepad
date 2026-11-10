/* Thunder Gamepad play screen: renders a layout on a full-screen stage and turns touches into Engine actions.
   Port of the old phone_gamepad_v3.py page script (normalize / render / liveButton / liveStick / liveLook / liveSlider / chat).
   Public: Play.start(rec) Play.stop() Play.back() Play.active, plus Play.util (normalize, pageList, place, ...) for the editor. */
(function (global) {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => Math.random().toString(36).slice(2, 11);
  const vmin = () => Math.min(innerWidth, innerHeight) / 100;
  const TYPES = ["button", "stick", "look", "slider", "label"];
  const KINDS = Engine.KINDS;
  const MOUSEB = ["left", "right", "middle", "x1", "x2", "scrollup", "scrolldown", "scrollleft", "scrollright"];
  const DEF_SET = {background: "#0b0b0d", haptics: true, rumble: true, opacity: 1, button: "#24242a", buttonBorder: "#45454f",
    square: "#34343b", squareBorder: "#7c7c85", active: "#2f8f5b", activeBorder: "#5fe39b"};
  const HKEY = "padlink.hud";

  const root = $("play"), stage = $("stage"), hud = $("hud");
  let H = null;                      // held-input table (shared with app.js via App.H)
  let rec = null, layout = [], cfg = Object.assign({}, DEF_SET), page = "main", pageHist = [];
  const AUTO = {};                   // autoclick buttons that are switched on (survive page changes / re-renders)
  /* Stick limiter ("limit" action, e.g. Walk / Cinema buttons): LIMIT[buttonId] = {side:"left|right|both", r:0.05-1}.
     While an entry exists the stick's output length is capped at r (the finger still moves the full stick, the game just
     never sees more than r). Several active entries on one stick: the smallest wins. Left and right are independent. */
  const LIMIT = {};
  const capSubs = new Set();         // live sticks re-send their output when a cap changes while a thumb is already on them
  const capFor = side => { let c = 1; for (const k in LIMIT) { const e = LIMIT[k]; if (e.side === side || e.side === "both") c = Math.min(c, e.r); } return c; };
  const capVec = (side, x, y) => { const c = capFor(side), n = Math.hypot(x, y); return n > c && n > 0 ? [x / n * c, y / n * c] : [x, y]; };
  const capNotify = () => capSubs.forEach(f => f());
  function setLimit(id, on, a) {
    if (on) {
      const s = String(a.stick || a.side || "left").toLowerCase();
      let r = parseFloat(a.radius != null ? a.radius : a.value); if (!isFinite(r)) r = 0.4;
      LIMIT[id] = {side: s === "right" ? "right" : s === "both" ? "both" : "left", r: clamp(r, 0.05, 1)};
    } else delete LIMIT[id];
    capNotify();
  }
  const lastSel = {};
  const killers = [];
  const onKill = f => killers.push(f);

  /* ---------- helpers ---------- */
  const hapticOn = () => cfg.haptics !== false && !(global.App && global.App.settings().haptics === false);
  const buzz = ms => { if (hapticOn()) Link.vibrate(ms, 120); };
  function toAction(a) {
    if (a == null || a === "") return null;
    if (typeof a === "string") {
      const i = a.indexOf(":");
      if (i > 0 && KINDS.has(a.slice(0, i))) return {kind: a.slice(0, i), value: a.slice(i + 1)};
      return {kind: "key", value: a};
    }
    return typeof a === "object" ? a : null;
  }
  function toClick(v) {
    if (v == null || v === "" || v === "none") return null;
    if (typeof v === "string" && MOUSEB.includes(v)) return {kind: "mouse", value: v};
    return toAction(v);
  }
  const live = a => a && a.kind !== "page" && a.kind !== "none" && a.kind !== "chat" && a.kind !== "ui";
  const sendAct = (a, down, src) => { a = toAction(a); if (a && a.kind === "limit") { setLimit(src, down, a); return; } if (live(a)) Engine.apply(a, down, H, src); };
  const sendTap = (a, ms, src) => { a = toAction(a); if (live(a)) Engine.tap(a, ms || 40, H, src); };
  function release(keep, keepLimit) {
    if (!keep) for (const k in AUTO) delete AUTO[k];
    if (!keep && !keepLimit && Object.keys(LIMIT).length) { for (const k in LIMIT) delete LIMIT[k]; capNotify(); }
    Engine.releaseAll(H, !!keep);
  }

  // mouse-look accumulator (sends whole pixels, keeps the remainder) - used by aim buttons
  let accx = 0, accy = 0, raf = 0;
  function flushMouse() {
    raf = 0;
    const ix = Math.round(accx), iy = Math.round(accy);
    if (ix || iy) { accx -= ix; accy -= iy; Engine.mouseMove(ix, iy); }
  }
  const addMouse = (dx, dy) => { accx += dx; accy += dy; if (!raf) raf = requestAnimationFrame(flushMouse); };

  /* ---------- layout model ---------- */
  const isUi = it => it.type === "button" && it.action && it.action.kind === "ui";
  const isZone = it => it.type === "look" || it.type === "slider" || (it.type === "stick" && it.floating);
  function normalize(raw, seen) {
    const num = v => typeof v === "number" && isFinite(v);
    const it = Object.assign({}, raw);
    if (typeof it.id !== "string" || !it.id || (seen && seen.has(it.id))) it.id = uid();
    if (seen) seen.add(it.id);
    if (it.type === "dpad") { it.type = "stick"; it.mode = "dpad"; }
    if (it.type === "zone") it.type = "look";
    if (!TYPES.includes(it.type)) it.type = "button";
    it.x = num(it.x) ? it.x : 50; it.y = num(it.y) ? it.y : 50;
    it.label = it.label == null ? "" : String(it.label);
    if (Array.isArray(it.page)) it.page = it.page.map(String);
    else it.page = it.page ? String(it.page).trim() || "main" : "main";
    if (it.type === "button") {
      it.s = num(it.s) ? it.s : 14;
      it.action = toAction(it.action) || {kind: "pad", value: "A"};
    } else if (it.type === "stick") {
      it.s = num(it.s) ? it.s : 30;
      it.mode = it.mode || "left";
      if (it.mode === "keys" || it.mode === "dpad") {
        const def = it.mode === "dpad" ? {up: "pad:UP", down: "pad:DOWN", left: "pad:LEFT", right: "pad:RIGHT"} : {up: "w", down: "s", left: "a", right: "d"};
        it.keys = Object.assign(def, it.keys || {});
      }
      if (it.mode === "dpad") it.dpad = true;
      if (it.floating) { it.w = num(it.w) ? it.w : 45; it.h = num(it.h) ? it.h : 80; }
    } else if (it.type === "look") {
      it.w = num(it.w) ? it.w : 60; it.h = num(it.h) ? it.h : 60;
      it.mode = it.mode || "mouse";
      it.sens = num(it.sens) ? it.sens : (it.mode === "mouse" ? 2 : 1);
      if (it.tap == null) it.tap = "left";
      if (it.hold == null) it.hold = "none";
      it.holdMs = num(it.holdMs) ? it.holdMs : 280;
    } else if (it.type === "slider") {
      it.w = num(it.w) ? it.w : 8; it.h = num(it.h) ? it.h : 60;
      it.target = it.target || "RT";
      if (it.spring == null) it.spring = true;
    } else if (it.type === "label") {
      it.s = num(it.s) ? it.s : 12;
    }
    return it;
  }
  /* "release" (reload) and "fullscreen" ui buttons are obsolete: the HUD pill has Release all and the app is always immersive */
  const dead = r => r && r.action && r.action.kind === "ui" && (r.action.value === "release" || r.action.value === "fullscreen");
  function normalizeAll(arr) { const seen = new Set(); return arr.filter(r => !dead(r)).map(r => normalize(r, seen)); }
  const matchPage = it => it.page === "*" || (Array.isArray(it.page) ? it.page.includes(page) : it.page === page);
  function pageList() {
    const set = new Set(["main"]);
    layout.forEach(it => (Array.isArray(it.page) ? it.page : [it.page]).forEach(p => { if (p && p !== "*") set.add(p); }));
    return Array.from(set);
  }
  function place(el, it) {
    el.style.left = it.x + "%"; el.style.top = it.y + "%";
    if (isZone(it)) { el.style.setProperty("--w", it.w); el.style.setProperty("--h", it.h); }
    else { el.style.setProperty("--s", it.s); if (it.ar) el.style.setProperty("--ar", it.ar); }
  }
  function applyCfg(rootEl, c) {
    const r = rootEl.style;
    r.setProperty("--pbg", c.background); r.setProperty("--btn", c.button); r.setProperty("--btn-b", c.buttonBorder);
    r.setProperty("--sq", c.square); r.setProperty("--sq-b", c.squareBorder);
    r.setProperty("--on", c.active); r.setProperty("--on-b", c.activeBorder); r.setProperty("--op", c.opacity);
  }
  const applySettings = () => applyCfg(root, cfg);

  function setPage(p) {
    if (p === "back") p = pageHist.pop() || "main";
    else {
      const list = pageList();
      if (p === "next") p = list[(list.indexOf(page) + 1) % list.length];
      else if (p === "prev") p = list[(list.indexOf(page) - 1 + list.length) % list.length];
      if (p !== page) pageHist.push(page);
    }
    if (!pageList().includes(p)) p = "main";
    page = p; render(); renderHud();
  }

  /* ---------- render ---------- */
  function render() {
    killers.splice(0).forEach(f => { try { f(); } catch (e) {} });
    release(true);
    stage.innerHTML = "";
    layout.filter(matchPage).forEach(makeEl);
  }
  function buildEl(it, edit) {            // builds the visual element only (no touch handling); edit=true for the editor
    const el = document.createElement("div");
    el.className = "el " + it.type;
    place(el, it);
    if (it.color) el.style.setProperty("--bgc", it.color);
    if (it.border) el.style.setProperty("--bc", it.border);
    if (it.textColor) el.style.setProperty("--tc", it.textColor);
    if (typeof it.opacity === "number") el.style.setProperty("--op", it.opacity);
    if (typeof it.rotate === "number") el.style.setProperty("--rot", it.rotate + "deg");
    if (typeof it.fontSize === "number") el.style.setProperty("--fs", it.fontSize);
    if (isZone(it)) el.classList.add("zone");
    if (it.hidden) el.classList.add("ghost");
    if (it.shape === "square") el.classList.add("sq");
    else if (it.shape === "pill") el.classList.add("pill");
    else if (it.shape === "rect") el.classList.add("rect");
    else if (it.shape === "none") el.classList.add("noshape");
    if (isUi(it)) el.classList.add("ui");
    let ctx = {};
    if (it.type === "button") el.textContent = it.label;
    else if (it.type === "label") { el.textContent = it.label; el.classList.add("labelonly"); }
    else if (it.type === "stick") ctx = buildStick(el, it, edit);
    else if (it.type === "look") { el.innerHTML = '<div class="cross">+</div>'; if (it.label) { el.firstChild.textContent = it.label; el.firstChild.style.fontSize = "3.5vmin"; } }
    else if (it.type === "slider") {
      const f = document.createElement("div"); f.className = "fill"; el.appendChild(f); ctx.fill = f;
      if (it.label) { const t = document.createElement("div"); t.textContent = it.label; t.style.cssText = "position:relative;pointer-events:none;font-size:3vmin"; el.appendChild(t); }
    }
    if (edit && ctx.fill) ctx.fill.style.cssText = "left:0;bottom:0;width:100%;height:40%";
    return {el, ctx};
  }
  function makeEl(it) {
    const {el, ctx} = buildEl(it, false);
    stage.appendChild(el);
    if (it.type === "button") liveButton(el, it);
    else if (it.type === "stick") liveStick(el, it, ctx);
    else if (it.type === "look") liveLook(el, it);
    else if (it.type === "slider") liveSlider(el, it, ctx);
  }
  function buildStick(el, it, edit) {
    const ctx = {arrows: {}, knob: null, base: null};
    const keyMode = it.mode === "keys" || it.mode === "dpad";
    if (it.floating) {
      const b = document.createElement("div"); b.className = "fbase";
      const d = it.s * vmin(); b.style.width = b.style.height = d + "px";
      const k = document.createElement("div"); k.className = "knob"; b.appendChild(k);
      el.appendChild(b); ctx.base = b; ctx.knob = k;
      if (edit) el.insertAdjacentHTML("afterbegin", '<div class="cross" style="font-size:3.5vmin">' + esc(it.label || "floating stick") + "</div>");
      return ctx;
    }
    if (it.dpad && keyMode) {
      el.classList.add("dpad");
      [["up", "▲", 50, 15], ["down", "▼", 50, 85], ["left", "◀", 15, 50], ["right", "▶", 85, 50]].forEach(([d, g, l, t]) => {
        const a = document.createElement("div"); a.className = "arr"; a.textContent = g;
        a.style.left = l + "%"; a.style.top = t + "%"; el.appendChild(a); ctx.arrows[d] = a;
      });
    } else {
      const k = document.createElement("div"); k.className = "knob"; el.appendChild(k); ctx.knob = k;
      const lab = it.label || ({left: "L", right: "R", keys: "", mouse: "🖱"}[it.mode] || "");
      if (lab) { const l = document.createElement("div"); l.className = "lbl"; l.textContent = lab; el.appendChild(l); }
    }
    return ctx;
  }

  /* ---------- chat sequence (Genshin): Chat button -> B -> X opens the phone keyboard, strictly in that order ----------
     Put "chatSeq":{"then":["pad:B","pad:X"],"send":"pad:B","close":"pad:A"} on the button that opens the in-game chat.
     Only BUTTON presses count. Sticks / look zones are ignored. Any other button in between cancels the sequence. */
  let seqCfg = null, seqIdx = 0;
  const sameAct = (A, spec) => {
    const B = toAction(spec); if (!A || !B || A.kind !== B.kind) return false;
    if (A.kind === "pad") return Engine.padName(A.value) === Engine.padName(B.value);
    if (A.kind === "key" || A.kind === "mouse") return String(A.value) === String(B.value);
    return JSON.stringify(A) === JSON.stringify(B);
  };
  function seqFeed(it, A) {
    if (!chatbar.hidden && chatCfg.keep && chatCfg.close && sameAct(A, chatCfg.close)) { closeChat(); return; }   // pad A button on screen also exits (A still reaches the game)
    if (it.chatSeq && Array.isArray(it.chatSeq.then) && it.chatSeq.then.length) {   // the trigger button: (re)start
      seqCfg = it.chatSeq; seqIdx = 0; return;
    }
    if (!seqCfg) return;
    if (!sameAct(A, seqCfg.then[seqIdx])) { seqCfg = null; seqIdx = 0; return; }    // wrong button: cancel
    if (++seqIdx >= seqCfg.then.length) {                                              // exact order completed
      chatCfg = {send: seqCfg.send, close: seqCfg.close, keep: seqCfg.keep !== false, reopen: seqCfg.reopen};
      seqCfg = null; seqIdx = 0;
      openChat();                                                                      // popup only; the X press itself still goes to the game
    }
  }

  /* ---------- live: button ---------- */
  function liveButton(el, it) {
    const id = it.id, A = toAction(it.action) || {kind: "none"};
    const L = it.long ? toAction(it.long.action || it.long) : null, LMS = (it.long && it.long.ms) || 350;
    const D = it.double ? toAction(it.double.action || it.double) : null, DMS = (it.double && it.double.ms) || 250;
    const isPage = A.kind === "page", isUiB = A.kind === "ui", isChat = A.kind === "chat", isAuto = A.kind === "autoclick", isLimit = A.kind === "limit";
    const TOG = it.toggle || ((isAuto || isLimit) && it.toggle !== false);
    let pid = null, on = (isAuto && !!AUTO[id]) || (isLimit && !!LIMIT[id]), tLong = 0, longFired = false, tDbl = 0, tTurbo = 0;
    const tap = (a, ms) => sendTap(a, ms, id);

    const aimMode = (it.aim === "stick" || it.aim === "drag") ? it.aim : null;
    const aimSpeed = typeof it.aimSpeed === "number" ? it.aimSpeed : 22, aimSens = typeof it.sens === "number" ? it.sens : 3;
    let aimOn = false, aimC = null, aimR = 1, aimVx = 0, aimVy = 0, aimRaf = 0, aimLast = 0, alx = 0, aly = 0, aimDot = null;
    if (aimMode) {
      if (aimMode === "stick") { const rg = document.createElement("div"); rg.className = "aimring"; el.appendChild(rg); }
      aimDot = document.createElement("div"); aimDot.className = "aimdot"; el.appendChild(aimDot);
    }
    function aimTick(ts) {
      if (!aimOn) return;
      const dt = Math.min(50, ts - aimLast) / 16.67; aimLast = ts;
      accx += aimVx * dt; accy += aimVy * dt; flushMouse();
      aimRaf = requestAnimationFrame(aimTick);
    }
    function startAim(e) {
      const rc = el.getBoundingClientRect();
      aimC = {x: rc.left + rc.width / 2, y: rc.top + rc.height / 2}; aimR = rc.width * 0.9;
      alx = e.clientX; aly = e.clientY; aimVx = aimVy = 0; aimOn = true;
      el.classList.add("aiming");
      if (aimMode === "stick") { aimLast = performance.now(); aimRaf = requestAnimationFrame(aimTick); }
    }
    function aimMove(e) {
      let dx = (e.clientX - aimC.x) / aimR, dy = (e.clientY - aimC.y) / aimR;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      aimDot.style.transform = "translate(-50%,-50%) translate(" + (dx * aimR) + "px," + (dy * aimR) + "px)";
      if (aimMode === "stick") {
        const m = Math.min(1, len), dz = 0.12;
        const k = m <= dz ? 0 : Math.pow((m - dz) / (1 - dz), 1.6);
        aimVx = m > 0 ? dx / m * k * aimSpeed : 0;
        aimVy = m > 0 ? dy / m * k * aimSpeed : 0;
      } else {
        addMouse((e.clientX - alx) * aimSens, (e.clientY - aly) * aimSens);
        alx = e.clientX; aly = e.clientY;
      }
    }
    function stopAim() {
      aimOn = false; cancelAnimationFrame(aimRaf); aimVx = aimVy = 0;
      el.classList.remove("aiming");
      if (aimDot) aimDot.style.transform = "translate(-50%,-50%)";
    }

    if ((isAuto || isLimit) && on) el.classList.add("active");
    onKill(() => { clearTimeout(tLong); clearTimeout(tDbl); clearInterval(tTurbo); stopAim(); });
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); if (pid !== null) return; pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch (_) {}
      buzz(it.haptic || 8);
      seqFeed(it, A);
      if (it.group) { lastSel[it.group] = id; stage.querySelectorAll('[data-g="' + it.group + '"]').forEach(n => n.classList.toggle("sel", n === el)); }
      if (isUiB) { el.classList.add("active"); return; }
      if (isPage) { if (A.value) setPage(A.value); if (it.goto) setPage(it.goto); return; }
      if (isChat) {
        release(false, true);                                        // drop held Ctrl/Shift toggles so typing isn't turned into shortcuts
        chatCfg = A;                                                 // remember optional open/send/close actions
        sendTap(A.open ? A.open : {kind: "key", value: A.value || "t"}, 40, id);   // opens the game's chat box (default: key T)
        openChat();                                                  // phone bar opens right away (release can be lost when the keyboard resizes the page)
        return;
      }
      el.classList.add("active");
      if (L) { longFired = false; tLong = setTimeout(() => { longFired = true; buzz(15); sendAct(L, true, id); }, LMS); }
      else if (D) { if (tDbl) { clearTimeout(tDbl); tDbl = 0; tap(D); } else tDbl = setTimeout(() => { tDbl = 0; tap(A); }, DMS); }
      else if (it.pulse) tap(A, it.pulse);
      else if (it.turbo) { const h = Math.min(40, it.turbo / 2); tap(A, h); tTurbo = setInterval(() => tap(A, h), it.turbo); }
      else if (TOG) { on = !on; if (isAuto) AUTO[id] = on; el.classList.toggle("active", on); sendAct(A, on, id); }
      else sendAct(A, true, id);
      if (aimMode) startAim(e);
      if (it.goto) setPage(it.goto);
    });
    el.addEventListener("pointermove", e => { if (e.pointerId === pid && aimOn) aimMove(e); });
    function end(e) {
      if (e.pointerId !== pid) return; pid = null;
      clearInterval(tTurbo);
      if (aimOn) stopAim();
      if (isUiB) { el.classList.remove("active"); runUi(A.value); return; }
      if (isChat) { el.classList.remove("active"); return; }
      if (L) { clearTimeout(tLong); if (longFired) sendAct(L, false, id); else tap(A); }
      else if (!D && !it.pulse && !it.turbo && !TOG && !isPage) sendAct(A, false, id);
      if (!(TOG && on)) el.classList.remove("active");
    }
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    if (it.group) { el.dataset.g = it.group; if (lastSel[it.group] === id) el.classList.add("sel"); }
  }

  /* ---------- live: stick ---------- */
  function dirActions(it) {
    const out = {};
    ["up", "down", "left", "right"].forEach(d => { out[d] = toAction((it.keys || {})[d]); });
    return out;
  }
  // global stick sensitivity (Settings) x per-stick sensitivity (editor); read live so changes apply instantly
  const gSens = () => { const v = global.App && global.App.settings().stickSens; return typeof v === "number" && v > 0 ? v : 1; };
  function liveStick(el, it, ctx) {
    const id = it.id, mode = it.mode;
    const keyMode = mode === "keys" || mode === "dpad";
    const acts = keyMode ? dirActions(it) : null;
    const outer = toAction(it.outer), outerAt = it.outerAt || 0.95, click = toAction(it.click);
    const DZ = it.deadzone != null ? it.deadzone : (keyMode ? (it.dpad ? 0.3 : 0.4) : 0);
    const side = mode === "right" ? "right" : "left";
    const held = {up: false, down: false, left: false, right: false};
    let pid = null, cx = 0, cy = 0, r = 1, t0 = 0, moved = false, outerOn = false, vx = 0, vy = 0, mt = 0, sx = 0, sy = 0, lastE = null;
    const capSub = () => { if (pid !== null && lastE && !keyMode && mode !== "mouse") update(lastE); };
    capSubs.add(capSub);
    onKill(() => { clearInterval(mt); capSubs.delete(capSub); });

    function geom(e) {
      if (it.floating) {
        r = it.s * vmin() / 2; cx = e.clientX; cy = e.clientY;
        const z = el.getBoundingClientRect();
        ctx.base.style.left = (cx - z.left) + "px"; ctx.base.style.top = (cy - z.top) + "px"; ctx.base.classList.add("on");
      } else {
        const b = el.getBoundingClientRect(); r = b.width / 2; cx = b.left + r; cy = b.top + b.height / 2;
      }
    }
    function update(e) {
      lastE = {clientX: e.clientX, clientY: e.clientY};
      let dx = (e.clientX - cx) / r, dy = (e.clientY - cy) / r;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      const Ln = Math.min(len, 1);
      if (ctx.knob) ctx.knob.style.transform = "translate(calc(-50% + " + (dx * r * 0.54) + "px),calc(-50% + " + (dy * r * 0.54) + "px))";
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) moved = true;
      if (keyMode) {
        const want = {up: dy < -DZ, down: dy > DZ, left: dx < -DZ, right: dx > DZ};
        for (const d in want) {
          if (want[d] !== held[d]) {
            held[d] = want[d]; if (ctx.arrows[d]) ctx.arrows[d].classList.toggle("on", want[d]);
            sendAct(acts[d], want[d], id + ":" + d);
          }
        }
      } else {
        let m = Ln <= DZ ? 0 : (Ln - DZ) / (1 - DZ);
        if (it.curve) m = Math.pow(m, it.curve);
        m = Math.min(1, m * gSens() * (mode === "mouse" ? 1 : (typeof it.sens === "number" && it.sens > 0 ? it.sens : 1)));
        m *= it.max || 1;
        if (mode !== "mouse") m = Math.min(m, capFor(side));          // Walk / Cinema limiter
        const ux = Ln ? dx / Ln : 0, uy = Ln ? dy / Ln : 0;
        const ox = ux * m * (it.invertX ? -1 : 1), oy = -uy * m * (it.invertY ? -1 : 1);
        if (mode === "mouse") { vx = ox; vy = -oy; }
        else Engine.stick(side, ox, oy);
        if (outer) {
          if (!outerOn && Ln >= outerAt) { outerOn = true; sendAct(outer, true, id + ":o"); }
          else if (outerOn && Ln < outerAt - 0.1) { outerOn = false; sendAct(outer, false, id + ":o"); }
        }
      }
    }
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); if (pid !== null) return; pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch (_) {}
      el.classList.add("active"); sx = e.clientX; sy = e.clientY; t0 = Date.now(); moved = false;
      geom(e); update(e);
      if (mode === "mouse") { mt = setInterval(() => { const sp = (it.sens || 12) * gSens(); if (vx || vy) Engine.mouseMove(Math.round(vx * sp), Math.round(vy * sp)); }, 16); }
    });
    el.addEventListener("pointermove", e => { if (e.pointerId === pid) update(e); });
    function end(e) {
      if (e.pointerId !== pid) return; pid = null;
      el.classList.remove("active"); if (ctx.base) ctx.base.classList.remove("on");
      if (ctx.knob) ctx.knob.style.transform = "translate(-50%,-50%)";
      clearInterval(mt); vx = vy = 0;
      if (keyMode) { for (const d in held) { if (held[d]) { held[d] = false; if (ctx.arrows[d]) ctx.arrows[d].classList.remove("on"); sendAct(acts[d], false, id + ":" + d); } } }
      else if (mode !== "mouse") Engine.stick(side, 0, 0);
      if (outerOn) { outerOn = false; sendAct(outer, false, id + ":o"); }
      if (click && !moved && Date.now() - t0 < 250) sendTap(click, 40, id + ":c");
    }
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }

  /* ---------- live: look zone ---------- */
  function liveLook(el, it) {
    const id = it.id, T = toClick(it.tap), Hd = toClick(it.hold), mode = it.mode;
    const side = mode === "lstick" ? "left" : "right";
    let pid = null, sx = 0, sy = 0, lx = 0, ly = 0, moved = false, holding = false, timer = 0, zt = 0, acc = 0;
    let rem0 = 0, rem1 = 0;   // mouse mode: sub-pixel remainder only (every touch event is sent at once, like the old v3)
    onKill(() => { clearTimeout(timer); clearTimeout(zt); });
    const ix = it.invertX ? -1 : 1, iy = it.invertY ? -1 : 1;
    function route(dx, dy) {
      if (mode === "mouse") {
        rem0 += dx * it.sens * ix; rem1 += dy * it.sens * iy;
        const mx = Math.round(rem0), my = Math.round(rem1);
        rem0 -= mx; rem1 -= my;
        if (mx || my) Engine.mouseMove(mx, my);
      }
      else if (mode === "scroll") { acc += -dy * it.sens * iy / 12; const n = Math.trunc(acc); if (n) { acc -= n; Engine.scroll(n, 0); } }
      else {
        const v = capVec(side, clamp(dx * it.sens * ix / 6, -1, 1), clamp(-dy * it.sens * iy / 6, -1, 1));
        Engine.stick(side, v[0], v[1]);
        clearTimeout(zt); zt = setTimeout(() => Engine.stick(side, 0, 0), 55);
      }
    }
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); if (pid !== null) return; pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch (_) {}
      sx = lx = e.clientX; sy = ly = e.clientY; moved = false; holding = false; acc = 0; rem0 = rem1 = 0;
      if (Hd) timer = setTimeout(() => { if (pid !== null && !moved) { holding = true; sendAct(Hd, true, id); } }, it.holdMs);
    });
    // pointerrawupdate = every touch-panel sample the moment it arrives (240+ Hz on many phones), not one per screen frame.
    // Falls back to pointermove where the engine lacks it. Same handler, so behaviour is otherwise identical.
    el.addEventListener("onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove", e => {
      if (e.pointerId !== pid) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) moved = true;
      if (moved || holding) route(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    function end(e) {
      if (e.pointerId !== pid) return; pid = null; clearTimeout(timer);
      if (holding) { holding = false; sendAct(Hd, false, id); }
      else if (!moved && T) sendTap(T, 40, id);
      if (mode === "rstick" || mode === "lstick") { clearTimeout(zt); Engine.stick(side, 0, 0); }
    }
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }

  /* ---------- live: slider ---------- */
  const axisState = {left: {x: 0, y: 0}, right: {x: 0, y: 0}};
  function liveSlider(el, it, ctx) {
    const t = String(it.target), isTrig = t === "LT" || t === "RT";
    let pid = null;
    function draw(v) {
      const b = el.getBoundingClientRect(), vert = b.height > b.width, f = ctx.fill.style;
      if (vert) { f.left = 0; f.width = "100%"; f.bottom = 0; f.top = "auto"; f.height = (v * 100) + "%"; }
      else { f.top = 0; f.height = "100%"; f.left = 0; f.width = (v * 100) + "%"; }
    }
    function out(v) {
      if (isTrig) Engine.trigger(t, v);
      else {
        const a = v * 2 - 1, s = t[0] === "r" ? "right" : "left", axis = t[1] === "y" ? "y" : "x";
        axisState[s][axis] = a; Engine.stick(s, axisState[s].x, axisState[s].y);
      }
    }
    function setv(e) {
      const b = el.getBoundingClientRect(), vert = b.height > b.width;
      const v = clamp(vert ? 1 - (e.clientY - b.top) / b.height : (e.clientX - b.left) / b.width, 0, 1);
      draw(v); out(v);
    }
    const rest = isTrig ? 0 : 0.5;
    draw(rest);
    el.addEventListener("pointerdown", e => { e.preventDefault(); if (pid !== null) return; pid = e.pointerId; try { el.setPointerCapture(pid); } catch (_) {} setv(e); });
    el.addEventListener("pointermove", e => { if (e.pointerId === pid) setv(e); });
    function end(e) { if (e.pointerId !== pid) return; pid = null; if (it.spring !== false) { draw(rest); out(rest); } }
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }

  /* ---------- ui buttons (layout items with action.kind "ui") ---------- */
  function runUi(v) {
    if (v === "release") { release(false); buzz(30); render(); }
    else if (v === "edit") {
      if (global.Editor && rec && rec.id) { const id = rec.id; stop(); global.Editor.open(global.App.recOf(id), {then: "play"}); }
      else toast("Layout editor not available");
    }
    else if (v === "fullscreen") { const nb = global.NativeBridge; if (nb) nb.immersive(true); }
    else if (v === "exit") stop();
  }
  function toast(m) { global.App && global.App.toast ? global.App.toast(m) : 0; }

  /* ---------- chat: phone keyboard -> game chat ---------- */
  const chatbar = $("chatbar"), chatin = $("chatin");
  let chatReopen = 0;
  let chatCfg = {};   // set by the chat button: optional "open" / "send" / "close" actions (default: key T / Enter / Esc)
  let chatSent = "", chatArmed = false, chatTimer = 0;
  function chatSync() {                // send only what changed since last time: N backspaces + the new tail
    if (!chatArmed) return;
    const v = chatin.value;
    let i = 0; const m = Math.min(v.length, chatSent.length);
    while (i < m && v[i] === chatSent[i]) i++;
    const back = chatSent.length - i, add = v.slice(i);
    if (back || add) Engine.typed(back, add);
    chatSent = v;
  }
  function openChat() {
    chatbar.hidden = false; chatin.value = ""; chatSent = ""; chatArmed = false;
    chatbar.classList.toggle("keep", !!chatCfg.keep); $("chatx").textContent = chatCfg.keep ? "Exit" : "\u2715";
    chatin.focus();
    const nb = window.NativeBridge; if (nb && nb.showKeyboard) { try { nb.showKeyboard(); setTimeout(() => { chatin.focus(); nb.showKeyboard(); }, 120); } catch (_) {} }
    clearTimeout(chatTimer);
    chatTimer = setTimeout(() => { chatArmed = true; chatSync(); }, 350);   // give the game a moment to open its chat box
  }
  function closeChat() { seqCfg = null; seqIdx = 0; clearTimeout(chatTimer); clearTimeout(chatReopen); chatArmed = false; chatbar.hidden = true; chatin.blur();
    const nb = window.NativeBridge; if (nb && nb.hideKeyboard) { try { nb.hideKeyboard(); } catch (_) {} } }
  function sendChat() { chatArmed = true; chatSync(); sendTap(chatCfg.send || {kind: "key", value: "enter"}, 40, "chat");
    if (chatCfg.keep) {                                                    // keep mode: stay open for the next message until Exit / A
      chatin.value = ""; chatSent = ""; chatin.focus();
      if (chatCfg.reopen) {                                                // games that close chat on send (Minecraft): press the open key again
        chatArmed = false; clearTimeout(chatTimer); clearTimeout(chatReopen);
        chatReopen = setTimeout(() => sendTap(chatCfg.reopen, 40, "chat"), 200);
        chatTimer = setTimeout(() => { chatArmed = true; chatSync(); }, 550);
      }
    } else closeChat(); }
  chatin.addEventListener("input", chatSync);
  chatin.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } });
  $("chatsend").onclick = sendChat;
  $("chatx").onclick = () => { sendTap(chatCfg.close || {kind: "key", value: "esc"}, 40, "chat"); closeChat(); };

  /* ---------- HUD: small draggable pill (connection, pages, release, edit, exit) ---------- */
  const hudPos = (() => { try { return Object.assign({x: 0.5, y: 0}, JSON.parse(localStorage.getItem(HKEY)) || {}); } catch (e) { return {x: 0.5, y: 0}; } })();
  let hudOpen = false;
  function placeHud() {
    const w = hud.offsetWidth || 120, h = hud.offsetHeight || 32;
    hud.style.left = clamp(hudPos.x, 0, 1) * Math.max(0, innerWidth - w) + "px";
    hud.style.top = clamp(hudPos.y, 0, 1) * Math.max(0, innerHeight - h) + "px";
  }
  function pillText() {
    const s = Link.state;
    if (s === "open") return (Link.rtt != null ? Link.rtt + " ms" : "live") + (Link.mode === "native" ? " · COMPAT (slow)" : " · direct");
    return s === "connecting" ? "connecting" : "offline";
  }
  function updatePill() { const sp = hud.querySelector("#hudGrip span"); if (sp) sp.textContent = pillText(); }
  function renderHud() {
    const s = Link.state, cls = s === "open" ? "on" : s === "connecting" ? "busy" : "bad";
    const pages = pageList();
    hud.className = (hudOpen ? "open " : "") + cls;
    hud.innerHTML = '<div class="grip" id="hudGrip"><i></i><span>' + pillText() + '</span></div>' +
      (hudOpen ? '<div class="menu">' +
        (pages.length > 1 ? '<div class="pg"><button data-h="prev">‹</button><b>' + esc(page) + '</b><button data-h="next">›</button></div>' : '') +
        (s === "open" ? '' : '<button data-h="reconnect" class="warn">Reconnect</button>') +
        '<button data-h="release">Release all</button><button data-h="edit">Edit layout</button><button data-h="exit" class="danger">Exit</button></div>' : '');
    placeHud();
    hud.querySelectorAll("[data-h]").forEach(b => b.onclick = e => { e.stopPropagation(); hudAct(b.dataset.h); });
    bindGrip();
  }
  function hudAct(a) {
    if (a === "prev" || a === "next") setPage(a);
    else if (a === "release") { release(false); render(); buzz(30); }
    else if (a === "edit") runUi("edit");
    else if (a === "exit") stop();
    else if (a === "reconnect") Link.connect();
  }
  function bindGrip() {           // tap toggles menu, drag moves the pill
    const g = $("hudGrip"); if (!g) return;
    let pid = null, sx = 0, sy = 0, bx = 0, by = 0, moved = false;
    g.addEventListener("pointerdown", e => {
      e.preventDefault(); if (pid !== null) return; pid = e.pointerId; try { g.setPointerCapture(pid); } catch (_) {}
      const r = hud.getBoundingClientRect(); bx = r.left; by = r.top; sx = e.clientX; sy = e.clientY; moved = false;
    });
    g.addEventListener("pointermove", e => {
      if (e.pointerId !== pid) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 6) moved = true;
      if (moved) {
        const w = hud.offsetWidth, h = hud.offsetHeight;
        hud.style.left = clamp(bx + e.clientX - sx, 0, Math.max(0, innerWidth - w)) + "px";
        hud.style.top = clamp(by + e.clientY - sy, 0, Math.max(0, innerHeight - h)) + "px";
      }
    });
    const end = e => {
      if (e.pointerId !== pid) return; pid = null;
      if (moved) {
        const w = hud.offsetWidth, h = hud.offsetHeight;
        hudPos.x = parseFloat(hud.style.left) / Math.max(1, innerWidth - w); hudPos.y = parseFloat(hud.style.top) / Math.max(1, innerHeight - h);
        try { localStorage.setItem(HKEY, JSON.stringify(hudPos)); } catch (_) {}
      } else { hudOpen = !hudOpen; renderHud(); }
    };
    g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
  }
  Link.on(ev => { if (!active) return; if (ev === "link") renderHud(); else if (ev === "rtt") updatePill(); });

  /* ---------- lifecycle ---------- */
  let active = false;
  function start(r) {
    H = global.App.H; rec = r;
    const data = r.data || {};
    cfg = Object.assign({}, DEF_SET, data.settings || {});
    layout = normalizeAll(data.layout || data.items || []);
    page = "main"; pageHist = []; hudOpen = false;
    applySettings();
    root.hidden = false; active = true;
    document.body.classList.add("playing");
    closeChat(); render(); renderHud();
    requestAnimationFrame(keepFrames);
    if (Link.state !== "open") toast("Not connected yet — open the pill at the top to reconnect");
  }
  /* While playing, keep one empty animation-frame callback running. It costs nothing, but it keeps the WebView drawing and
     delivering touch events at the full display rate (without it the page can idle at a lower rate = choppy camera). */
  function keepFrames() { if (active) requestAnimationFrame(keepFrames); }
  function stop() {
    if (!active) return;
    killers.splice(0).forEach(f => { try { f(); } catch (e) {} });
    release(false); closeChat();
    stage.innerHTML = ""; root.hidden = true; active = false;
    document.body.classList.remove("playing");
    if (global.App && global.App.afterPlay) global.App.afterPlay();
  }
  function back() {                      // Android back: close chat, else collapse/open menu, else exit via menu
    if (!chatbar.hidden) { closeChat(); return true; }
    if (hudOpen) { hudOpen = false; renderHud(); return true; }
    hudOpen = true; renderHud(); return true;
  }
  document.addEventListener("visibilitychange", () => { if (active && document.hidden) release(false); });
  addEventListener("resize", () => { if (active) { placeHud(); render(); } });
  document.addEventListener("contextmenu", e => e.preventDefault());

  global.Play = {
    start, stop, back,
    get active() { return active; },
    get page() { return page; },
    util: {normalize, normalizeAll, pageList: () => pageList(), place, toAction, DEF_SET, buildEl, applyCfg, isZone, isUi, uid, vmin, esc, clamp},
  };
})(window);
