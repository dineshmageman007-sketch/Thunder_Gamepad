/* Thunder Gamepad engine: the input logic that used to run on the laptop (actions, combos, macros, wheel, autoclick,
   held-input bookkeeping). Everything here produces LOW-LEVEL events through Engine.setOutput(fn):
   {t:"pad",n,d} {t:"trig",side,v} {t:"stick",side,x,y} {t:"key",k,d} {t:"mbtn",n,d}
   {t:"mmove",dx,dy} {t:"mto",x,y} {t:"scroll",v,h} {t:"type",s,back} {t:"axes0"} {t:"reset"}            */
(function (global) {
  "use strict";
  const PAD_NAMES = new Set(["A","B","X","Y","LB","RB","LT","RT","START","BACK","GUIDE","LS","RS","UP","DOWN","LEFT","RIGHT","TOUCHPAD"]);
  const PAD_ALIAS = {SELECT:"BACK",VIEW:"BACK",SHARE:"BACK",MENU:"START",OPTIONS:"START",XBOX:"GUIDE",PS:"GUIDE",HOME:"GUIDE",
    L1:"LB",R1:"RB",L2:"LT",R2:"RT",L3:"LS",R3:"RS",LSB:"LS",RSB:"RS",CROSS:"A",CIRCLE:"B",SQUARE:"X",TRIANGLE:"Y",
    DPAD_UP:"UP",DPAD_DOWN:"DOWN",DPAD_LEFT:"LEFT",DPAD_RIGHT:"RIGHT"};
  const KINDS = new Set(["pad","key","mouse","page","combo","wheel","macro","multi","stick","trigger","text",
    "mousemove","mouseto","autoclick","limit","chat","ui","none"]);
  const MOUSE_BTNS = new Set(["left","right","middle","x1","x2"]);
  const CANCEL = Symbol("cancel");
  let out = () => {};

  const padName = v => { const n = String(v).trim().toUpperCase(); return PAD_ALIAS[n] || n; };
  const clamp = (v, lo = -1, hi = 1) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
  const uniform = (a, b) => a + Math.random() * (b - a);
  function gauss(mu, sigma) {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ---- cancellable task: every macro / autoclick runs in one so "release all" can stop it ---- */
  class Task {
    constructor() { this.dead = false; this.timer = null; this.rej = null; }
    sleep(ms) {
      ms = Math.max(0, Math.min(Number(ms) || 0, 60000));
      return new Promise((res, rej) => {
        if (this.dead) return rej(CANCEL);
        this.rej = rej;
        this.timer = setTimeout(() => { this.timer = null; this.rej = null; res(); }, ms);
      });
    }
    cancel() {
      this.dead = true;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.rej) { const r = this.rej; this.rej = null; r(CANCEL); }
    }
  }

  /* ---- held-input bookkeeping: idempotent per source, so two buttons can share a key safely ---- */
  class Held {
    constructor() { this.keys = new Map(); this.mouse = new Map(); this.pad = new Map(); this.tasks = new Set(); this.autos = new Map(); }
    spawn(fn) {
      const task = new Task();
      this.tasks.add(task);
      (async () => {
        try { await fn(task); }
        catch (e) { if (e !== CANCEL) console.error(e); }
        finally { this.tasks.delete(task); }
      })();
      return task;
    }
  }

  function hold(table, key, src, down, press, release) {
    let s = table.get(key);
    if (!s) { s = new Set(); table.set(key, s); }
    if (down) { const first = s.size === 0; s.add(src); if (first) press(key); }
    else { s.delete(src); if (s.size === 0) { table.delete(key); release(key); } }
  }

  const sendPad = (n, d) => out({t: "pad", n, d: d ? 1 : 0});
  const sendKey = (k, d) => out({t: "key", k, d: d ? 1 : 0});
  const sendMb = (n, d) => out({t: "mbtn", n, d: d ? 1 : 0});
  const trig = (side, v) => out({t: "trig", side: String(side).toUpperCase().startsWith("L") ? "L" : "R", v: clamp(v, 0, 1)});
  const stick = (side, x, y) => out({t: "stick", side: String(side).toLowerCase().startsWith("r") ? "r" : "l", x: clamp(x), y: clamp(y)});

  function normAction(a) {
    if (typeof a === "string") {
      const i = a.indexOf(":");
      if (i > 0 && KINDS.has(a.slice(0, i))) return {kind: a.slice(0, i), value: a.slice(i + 1)};
      return {kind: "key", value: a};
    }
    return a && typeof a === "object" ? a : null;
  }
  function splitKeys(value) {
    const s = String(value).trim();
    if (s === "+") return ["plus"];
    return s.split("+").map(x => x.trim()).filter(Boolean);
  }
  function comboToken(tok) {
    const i = tok.indexOf(":");
    if (i > 0 && KINDS.has(tok.slice(0, i))) return {kind: tok.slice(0, i), value: tok.slice(i + 1)};
    if (tok === tok.toUpperCase() && tok !== tok.toLowerCase() && PAD_NAMES.has(padName(tok))) return {kind: "pad", value: tok};
    return {kind: "key", value: tok};
  }

  function apply(a, down, H, src = "") {
    a = normAction(a);
    if (!a) return;
    const k = a.kind, v = a.value;
    if (k === "pad") {
      const n = padName(v);
      if (a.amount != null && (n === "LT" || n === "RT")) trig(n, down ? a.amount : 0);
      else hold(H.pad, n, src, down, x => sendPad(x, 1), x => sendPad(x, 0));
    } else if (k === "key") {
      const keys = splitKeys(v).map(s => s.toLowerCase());
      for (const x of (down ? keys : keys.slice().reverse())) hold(H.keys, x, src, down, y => sendKey(y, 1), y => sendKey(y, 0));
    } else if (k === "mouse") {
      const name = String(v).trim().toLowerCase();
      const amt = parseInt(a.amount || 1, 10) || 1;
      if (name.startsWith("scroll")) {
        if (down) out({t: "scroll",
          v: name === "scrollup" ? amt : name === "scrolldown" ? -amt : 0,
          h: name === "scrollright" ? amt : name === "scrollleft" ? -amt : 0});
      } else if (MOUSE_BTNS.has(name)) hold(H.mouse, name, src, down, x => sendMb(x, 1), x => sendMb(x, 0));
    } else if (k === "combo") {
      splitKeys(v).forEach((tok, i) => apply(comboToken(tok), down, H, src + "+" + i));
    } else if (k === "multi") {
      (a.actions || []).forEach((sub, i) => apply(sub, down, H, src + "#" + i));
    } else if (k === "stick") {
      stick(a.side || "right", down ? (a.x || 0) : 0, down ? (a.y || 0) : 0);
    } else if (k === "trigger") {
      trig(v || a.side || "RT", down ? (a.amount == null ? 1 : a.amount) : 0);
    } else if (k === "text") {
      if (down && v) out({t: "type", s: String(v), back: 0});
    } else if (k === "mousemove") {
      if (down) out({t: "mmove", dx: a.dx || 0, dy: a.dy || 0});
    } else if (k === "mouseto") {
      if (down) out({t: "mto", x: a.x == null ? 0.5 : a.x, y: a.y == null ? 0.5 : a.y});
    } else if (k === "macro") {
      if (down) H.spawn(t => runMacro(a.steps || [], H, src + "~m", t));
    } else if (k === "autoclick") {
      // press = start clicking the target, release = stop (UI sends press+release as a toggle)
      const key = src + "~a";
      const old = H.autos.get(key);
      if (old) { old.cancel(); H.autos.delete(key); }
      if (down) H.autos.set(key, H.spawn(t => runAutoclick(a, H, key, t)));
    } else if (k === "wheel") {
      if (down) H.spawn(t => runMacro(wheelSteps(a), H, src + "~w", t));
    }
    // page / chat / ui / none are handled by the UI layer
  }

  function wheelSteps(a) {
    const ang = (parseFloat(a.value) || 0) * Math.PI / 180;
    const btn = a.button || "LB", st = a.stick || "right";
    const x = +Math.sin(ang).toFixed(4), y = +Math.cos(ang).toFixed(4);
    return [{down: "pad:" + btn}, {wait: a.aim == null ? 120 : a.aim}, {stick: st, x, y},
      {wait: a.hold == null ? 330 : a.hold}, {up: "pad:" + btn}, {wait: 80}, {stick: st, x: 0, y: 0}];
  }

  async function runMacro(steps, H, src, task, depth = 0) {
    if (depth > 4 || !Array.isArray(steps)) return;
    for (let st of steps) {
      if (task.dead) throw CANCEL;
      if (typeof st === "number") { await task.sleep(st); continue; }
      if (typeof st === "string") st = {tap: st};
      if (!st || typeof st !== "object") continue;
      if ("wait" in st) await task.sleep(st.wait);
      else if ("down" in st) apply(st.down, true, H, src);
      else if ("up" in st) apply(st.up, false, H, src);
      else if ("tap" in st) {
        apply(st.tap, true, H, src + ".t");
        try { await task.sleep(st.ms == null ? 40 : st.ms); } finally { apply(st.tap, false, H, src + ".t"); }
      }
      else if ("stick" in st) stick(st.stick, st.x || 0, st.y || 0);
      else if ("trigger" in st) trig(st.trigger, st.amount == null ? 1 : st.amount);
      else if ("text" in st) out({t: "type", s: String(st.text), back: 0});
      else if ("move" in st) out({t: "mmove", dx: st.move[0], dy: st.move[1]});
      else if ("moveto" in st) out({t: "mto", x: st.moveto[0], y: st.moveto[1]});
      else if ("scroll" in st) out({t: "scroll", v: st.scroll, h: 0});
      else if ("hscroll" in st) out({t: "scroll", v: 0, h: st.hscroll});
      else if ("repeat" in st) {
        const n = Math.max(0, Math.min(parseInt(st.repeat, 10) || 0, 1000));
        for (let i = 0; i < n; i++) await runMacro(st.steps || [], H, src, task, depth + 1);
      }
    }
  }

  function humanGap(lo, hi, mid) {   // bell-shaped around a slowly wandering centre, never at the range edges
    for (let i = 0; i < 8; i++) { const g = gauss(mid, (hi - lo) * 0.2); if (g >= lo && g <= hi) return g; }
    return uniform(lo, hi);
  }

  async function runAutoclick(a, H, src, task) {
    const target = a.target || {kind: "pad", value: "B"};
    let lo = Math.max(25, parseFloat(a.min == null ? 400 : a.min)), hi, hlo, hhi;
    if (!isFinite(lo)) lo = 400;
    hi = Math.max(lo + 10, parseFloat(a.max == null ? 900 : a.max)); if (!isFinite(hi)) hi = lo + 500;
    hlo = Math.max(10, parseFloat(a.holdMin == null ? 28 : a.holdMin)); if (!isFinite(hlo)) hlo = 28;
    hhi = Math.max(hlo + 4, parseFloat(a.holdMax == null ? 85 : a.holdMax)); if (!isFinite(hhi)) hhi = hlo + 57;
    const pauses = !(a.pauses === false || a.pauses === 0 || a.pauses === "false" || a.pauses === "0");
    const span = hi - lo, centre = lo + span / 2;
    let mid = lo + span * uniform(0.3, 0.7), lastGap = 0, burst = 0, pressed = false;
    const cs = src + ".c";
    try {
      await task.sleep(uniform(0, Math.min(180, span)));              // don't start on an exact beat
      for (;;) {
        let hold = null;
        for (let i = 0; i < 8; i++) { const h = gauss((hlo + hhi) / 2, (hhi - hlo) / 4.5); if (h >= hlo && h <= hhi) { hold = h; break; } }
        if (hold == null) hold = uniform(hlo, hhi);
        apply(target, true, H, cs); pressed = true;
        await task.sleep(hold);
        apply(target, false, H, cs); pressed = false;
        mid += gauss(0, span * 0.05) + (centre - mid) * 0.05;          // tempo wanders, pulled gently to the middle
        mid = Math.min(hi - span * 0.1, Math.max(lo + span * 0.1, mid));
        let gap;
        if (burst > 0) { burst--; gap = uniform(lo, lo + span * 0.3); }
        else {
          gap = humanGap(lo, hi, mid);
          const r = Math.random();
          if (pauses && r < 0.004) gap += uniform(1500, 3800);          // looked away for a moment
          else if (pauses && r < 0.035) gap += uniform(hi * 0.8, hi * 2.6); // short hesitation
          else if (r < 0.09) burst = Math.floor(uniform(2, 7));
        }
        if (Math.abs(gap - lastGap) < 4) gap += uniform(5, Math.max(8, span * 0.15));
        lastGap = gap;
        await task.sleep(Math.max(12, gap - hold));
      }
    } finally {
      if (pressed) apply(target, false, H, cs);
      if (H.autos.get(src) && H.autos.get(src) === task) H.autos.delete(src);
    }
  }

  function tap(a, ms, H, src) {
    const s = src + "~t";
    apply(a, true, H, s);
    setTimeout(() => apply(a, false, H, s), Math.max(0, ms || 40));
  }

  function releaseAll(H, keepMacros) {
    const keep = keepMacros ? s => s.includes("~") : () => false;
    let held = false;   // true only if something was really down: an idle release must send NOTHING that other apps can see
    const tables = [[H.keys, k => sendKey(k, 0)], [H.mouse, n => sendMb(n, 0)], [H.pad, n => sendPad(n, 0)]];
    for (const [table, rel] of tables) {
      for (const key of Array.from(table.keys())) {
        const left = new Set(Array.from(table.get(key)).filter(keep));
        if (left.size) table.set(key, left);
        else { table.delete(key); held = true; try { rel(key); } catch (e) {} }
      }
    }
    if (!keepMacros) {
      if (H.tasks.size || H.autos.size) held = true;
      H.tasks.forEach(t => t.cancel());
      H.tasks.clear(); H.autos.clear();
      out({t: held ? "reset" : "axes0"});
    } else if (!H.tasks.size) out({t: "axes0"});
  }

  global.Engine = {
    create: () => new Held(),
    setOutput: fn => { out = fn || (() => {}); },
    apply, tap, releaseAll, normAction, padName, KINDS, PAD_NAMES,
    macro: (steps, H, src) => H.spawn(t => runMacro(steps, H, (src || "") + "~m", t)),
    stick, trigger: trig,
    mouseMove: (dx, dy) => out({t: "mmove", dx, dy}),
    scroll: (v, h) => out({t: "scroll", v: v || 0, h: h || 0}),
    typed: (back, s) => out({t: "type", back, s}),
  };
})(window);
