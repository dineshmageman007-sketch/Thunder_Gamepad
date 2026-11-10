/* Thunder Gamepad ready-made layouts: Xbox 360 and PlayStation. Plain data, same format as any imported layout. */
(function (global) {
  "use strict";
  const tint = (bg, bd) => ({color: bg, border: bd});
  const B = (label, x, y, s, value, extra) => Object.assign({type: "button", label, x, y, s, action: {kind: "pad", value}}, extra || {});
  const stick = (x, y, s, mode) => ({type: "stick", label: "", x, y, s, mode, keys: {up: "w", down: "s", left: "a", right: "d"}, click: {kind: "pad", value: mode === "left" ? "LS" : "RS"}});
  const SQ = {shape: "square"};

  function common(l) {   // identical geometry for both pads: triggers/bumpers, sticks, d-pad, face diamond, L3/R3
    return [
      B(l.lt, 7, 12, 12, "LT", SQ), B(l.lb, 7, 28, 12, "LB", SQ), B(l.rt, 93, 12, 12, "RT", SQ), B(l.rb, 93, 28, 12, "RB", SQ),
      stick(15, 66, 34, "left"), stick(63, 74, 28, "right"),
      B("▲", 36, 50, 12, "UP", SQ), B("▼", 36, 78, 12, "DOWN", SQ), B("◀", 28, 64, 12, "LEFT", SQ), B("▶", 44, 64, 12, "RIGHT", SQ),
      B("L3", 27, 92, 9, "LS"), B("R3", 72, 92, 9, "RS"),
    ];
  }
  const xbox = () => ({
    settings: {pad: "xbox"},
    layout: common({lt: "LT", lb: "LB", rt: "RT", rb: "RB"}).concat([
      B("BACK", 39, 15, 11, "BACK", {shape: "rect"}), B("⊞", 50, 15, 10, "GUIDE", SQ), B("START", 61, 15, 11, "START", {shape: "rect"}),
      B("Y", 84, 36, 14, "Y", tint("#5a4a1e", "#ffd24a")), B("A", 84, 68, 14, "A", tint("#1e4d33", "#3ddc84")),
      B("X", 74, 52, 14, "X", tint("#233a5a", "#5ca8ff")), B("B", 94, 52, 14, "B", tint("#5a2a31", "#ff5c6c")),
    ]),
  });
  const ps = () => ({
    settings: {pad: "ds4"},
    layout: common({lt: "L2", lb: "L1", rt: "R2", rb: "R1"}).concat([
      B("Share", 31, 15, 12, "BACK", {shape: "rect"}), B("Pad", 50, 15, 14, "TOUCHPAD", {shape: "rect"}), B("Options", 70, 15, 14, "START", {shape: "rect"}),
      B("PS", 50, 31, 9, "GUIDE"),
      B("△", 84, 36, 14, "Y", tint("#1e4d44", "#4cd6a0")), B("✕", 84, 68, 14, "A", tint("#233a5a", "#5ca8ff")),
      B("□", 74, 52, 14, "X", tint("#5a2a4a", "#ff7ac6")), B("○", 94, 52, 14, "B", tint("#5a2a31", "#ff5c6c")),
    ]),
  });
  global.Presets = {list: [{key: "xbox", name: "Xbox 360", make: xbox}, {key: "ps", name: "PlayStation", make: ps}]};
})(window);
