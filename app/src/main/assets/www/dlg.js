/* Thunder Gamepad in-page dialogs: Dlg.prompt(title, default) -> Promise<string|null>, Dlg.confirm(msg) -> Promise<bool> */
(function (global) {
  "use strict";
  let el = null;
  function ensure() {
    if (el) return el;
    el = document.createElement("div"); el.id = "dlg"; el.hidden = true;
    el.innerHTML = '<div class="box"><p id="dlgT"></p><input id="dlgI" autocomplete="off" autocapitalize="off"><div class="row"><button class="btn" id="dlgNo">Cancel</button><button class="btn primary" id="dlgOk">OK</button></div></div>';
    document.body.appendChild(el); return el;
  }
  function open(title, withInput, def) {
    ensure();
    return new Promise(res => {
      const i = el.querySelector("#dlgI");
      el.querySelector("#dlgT").textContent = title; i.hidden = !withInput; i.value = def || ""; el.hidden = false;
      if (withInput) setTimeout(() => { i.focus(); i.select(); }, 30);
      const done = v => { el.hidden = true; res(v); };
      el.querySelector("#dlgOk").onclick = () => done(withInput ? i.value.trim() : true);
      el.querySelector("#dlgNo").onclick = () => done(withInput ? null : false);
      i.onkeydown = e => { if (e.key === "Enter") done(i.value.trim()); };
    });
  }
  global.Dlg = {prompt: (t, d) => open(t, true, d), confirm: t => open(t, false)};
})(window);
