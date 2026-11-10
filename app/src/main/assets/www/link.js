/* Thunder Gamepad link. Input goes phone page -> WebSocket -> PC with NOTHING in between (the page's own Chromium socket,
   exactly like the old browser version). NativeBridge is only used for LAN discovery, vibration, files, and as an automatic
   fallback transport if a phone refuses the direct socket. */
(function (global) {
  "use strict";
  const nb = global.NativeBridge || null;
  const PREF = "padlink.conn";
  const L = {
    state: "closed", err: "", info: null, rtt: null,
    conn: Object.assign({host: "", port: 8766, pad: "xbox", pcs: {}, pc: ""}, load()),   // pcs: remembered PCs {pcid:{name,host,port,token}}
    newTok: "", autoMode: false,
    /* the key this phone got when the PC said Allow, for the PC at the current address ("" = never paired -> the PC will ask) */
    tokenFor() { const p = L.conn.pcs || {}, h = String(L.conn.host).trim(), pt = parseInt(L.conn.port, 10) || 8766; for (const id in p) if (p[id].host === h && (p[id].port || 8766) === pt) return p[id].token || ""; return ""; },
    forgetPc() { const p = L.conn.pcs || {}, h = String(L.conn.host).trim(); for (const id in p) if (p[id].host === h) delete p[id]; if (!p[L.conn.pc]) L.conn.pc = ""; L.save(); },
    /* app start: reconnect to the remembered PC on its own; if its address changed, discovery (pcid) finds the new one */
    autoStart() { const p = (L.conn.pcs || {})[L.conn.pc]; if (!p) return false; L.conn.host = p.host; L.conn.port = p.port || 8766; L.autoMode = true; L.connect(); L.discover(); return true; },
    rematch() { const p = (L.conn.pcs || {})[L.conn.pc]; if (!p || L.state === "open") return; const f = L.found.find(x => x.pcid === L.conn.pc); if (!f || (f.host === p.host && (f.port || 8766) === (p.port || 8766))) return; p.host = f.host; p.port = f.port || 8766; L.conn.host = p.host; L.conn.port = p.port; L.save(); if (L.want && L.state !== "connecting" && L.state !== "pending") { L.retries = 0; L.connect(true); } },
    found: [], subs: new Set(),
    on(fn) { L.subs.add(fn); return () => L.subs.delete(fn); },
    emit(ev) { L.subs.forEach(f => { try { f(ev, L); } catch (e) { console.error(e); } }); },
    save() { try { localStorage.setItem(PREF, JSON.stringify(L.conn)); } catch (e) {} },
    want: false, retries: 0, timer: null,
    ws: null, gen: 0, mode: "direct", opened: false, pdx: 0, pdy: 0, lastRumble: 0,
    fallbackOn() { try { return (JSON.parse(localStorage.getItem("padlink.settings")) || {}).nativeFallback === true; } catch (e) { return false; } },
    auto() { try { return (JSON.parse(localStorage.getItem("padlink.settings")) || {}).autoReconnect !== false; } catch (e) { return true; } },
    retry() {
      clearTimeout(L.timer);
      if (!L.want || !L.auto() || L.retries >= 15 || L.state === "open" || L.state === "connecting") return;
      L.retries++; L.timer = setTimeout(() => { if (L.want && L.state !== "open" && L.state !== "connecting") L.connect(true); }, Math.min(1000 * L.retries, 5000));
    },
    connect(silent) {
      if (!silent) { L.want = true; L.retries = 0; }
      clearTimeout(L.timer);
      L.save();
      L.direct();
    },
    /* direct page WebSocket */
    direct() {
      L.closeSock(); L.mode = "direct"; L.opened = false;
      const my = ++L.gen, host = L.conn.host.trim(), port = parseInt(L.conn.port, 10) || 8766;
      let sock;
      L.state = "connecting"; L.err = ""; L.emit("link");
      try { sock = new WebSocket("ws://" + host + ":" + port + "/ws"); }
      catch (e) { return L.native("bad address"); }
      L.ws = sock;
      sock.onopen = () => {
        if (my !== L.gen) return; L.opened = true;
        sock.send(JSON.stringify({t: "hello", token: L.tokenFor(), pad: L.conn.pad, name: deviceName()}));
      };
      sock.onmessage = ev => { if (my === L.gen) global.Native.onMessage(ev.data); };
      sock.onerror = () => { if (my === L.gen && !L.opened) L.native("Can't reach the PC"); };
      sock.onclose = () => {
        if (my !== L.gen || !L.opened) return;
        L.ws = null; if (L.state === "denied" || L.state === "pending") { if (L.state === "pending") { L.state = "closed"; L.emit("link"); } return; }
        global.Native.onMessage(JSON.stringify({t: "link", state: "closed"}));
      };
    },
    /* fallback: the old Kotlin/OkHttp route (only when the direct socket could not even open) */
    native(why) {
      L.closeSock();
      if (!nb || !L.fallbackOn()) { L.state = "failed"; L.err = why + (nb ? " (if this keeps happening, turn on Compatibility mode in Settings)" : ""); L.emit("link"); if (L.autoMode) L.retry(); return; }
      L.mode = "native";
      nb.connect(L.conn.host.trim(), parseInt(L.conn.port, 10) || 8766, L.tokenFor(), L.conn.pad);   // Kotlin sends this as the hello "code" field; the PC accepts it as the token
    },
    closeSock() { L.gen++; const w = L.ws; L.ws = null; if (w) { try { w.close(1000); } catch (e) {} } },
    disconnect() {
      L.want = false; L.autoMode = false; clearTimeout(L.timer); L.closeSock(); if (nb) nb.disconnect();
      L.state = "closed"; L.emit("link");
    },
    send(o) {
      if (L.state !== "open") return;
      if (L.mode === "native") { if (nb) nb.send(JSON.stringify(o)); return; }
      const w = L.ws; if (!w || w.readyState !== 1) return;
      w.send(JSON.stringify(o));
    },
    discover() { L.found = []; if (nb) nb.discover(); else L.emit("found"); },
    setPad(kind) { L.conn.pad = kind; L.save(); L.send({t: "setpad", kind}); },
    vibrate(ms, amp) { if (nb) nb.vibrate(ms, amp || 180); else if (navigator.vibrate) navigator.vibrate(ms); },
  };
  function deviceName() { const m = /;\s*([^;)]+?)\s+Build\//.exec(navigator.userAgent || ""); return m ? m[1] : "Phone"; }
  function load() { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; } }

  setInterval(() => { if (L.state === "open") L.send({t: "ping", ts: Date.now()}); }, 2000);

  global.Native = {
    onMessage(raw) {
      let d; try { d = JSON.parse(raw); } catch (e) { return; }
      switch (d.t) {
        case "link": L.state = d.state; L.err = d.err || ""; if (d.state !== "open") L.rtt = null; L.emit("link"); if (d.state === "closed" || d.state === "failed") L.retry(); break;
        case "pending": L.state = "pending"; L.err = ""; L.emit("link"); break;
        case "paired": L.newTok = d.token || ""; break;
        case "welcome": {
          L.retries = 0; L.state = "open"; L.err = ""; L.info = d; L.conn.pad = d.pad === "none" ? L.conn.pad : d.pad;
          if (d.pcid) {                                  // remember this PC + the key it gave us
            const tok = L.newTok || L.tokenFor(); L.newTok = "";
            if (tok) { L.conn.pcs = L.conn.pcs || {}; L.conn.pcs[d.pcid] = {name: d.host || "PC", host: String(L.conn.host).trim(), port: parseInt(L.conn.port, 10) || 8766, token: tok}; L.conn.pc = d.pcid; L.save(); }
          }
          L.emit("link"); break; }
        case "denied": {
          L.want = false; L.autoMode = false; L.state = "denied"; L.newTok = "";
          L.err = d.reason === "blocked" ? "The PC blocked this phone." : d.reason === "timeout" ? "Nobody clicked Allow on the PC in time. Tap Connect to try again." : d.reason === "busy" ? "Another phone is waiting for approval on the PC. Try again in a moment." : d.reason === "locked" || d.locked ? "Too many declined requests. Try again in " + (d.locked || 60) + " s." : "The PC refused the connection.";
          L.emit("link"); break; }
        case "pong": L.rtt = Date.now() - d.ts; L.emit("rtt"); break;
        case "rumble": { const now = Date.now(); if ((d.l || d.s) && now - L.lastRumble < 60) break; L.lastRumble = now; L.emit({type: "rumble", l: d.l, s: d.s}); break; }
        case "found": L.found = d.list || []; L.emit("found"); L.rematch(); break;
        case "imported": case "exported": L.emit(d); break;
      }
    },
    onResume() { if (L.want && L.state !== "open" && L.state !== "connecting") { L.retries = 0; L.connect(true); } },
    onBack() { return typeof global.App !== "undefined" && global.App.back ? global.App.back() : false; },
  };
  global.Link = L;
})(window);
