# Thunder Gamepad - LAYOUT SPEC (give this file to an AI to make a layout)

TASK FOR THE AI: produce ONE valid JSON file `<Game>_layout.json` (no comments, no trailing commas) in the format below.
The user imports it in the app (Layouts -> Import). Output only the JSON in one code block, then 3 lines of notes (what buttons do, what to rebind in-game).
Ask the user (max 3 short questions) only if missing: the game, controller or keyboard+mouse style, and what in-game controls they need.

## 1. File shape
{ "settings": { ...theme... }, "layout": [ ...items... ] }
Settings (all optional, defaults shown): background "#0b0b0d", haptics true, rumble true (game vibration -> phone), opacity 1,
button "#24242a", buttonBorder "#45454f", square "#34343b", squareBorder "#7c7c85", active "#2f8f5b", activeBorder "#5fe39b".

## 2. Screen / coordinates
Landscape. x,y = CENTRE of the item in % of screen (0-100). Button/stick size `s` = diameter, in vmin-style units (typical 9-22; thumbs need >= 10).
Zones (look zone, floating stick, slider) use w,h = width/height in % of the screen instead of s.
Keep thumb areas free: left stick bottom-left (x 5-25,y 55-90), action buttons bottom-right (x 70-95,y 45-90). Never overlap controls (except under big zones).
Every item: "type","x","y", and usually "label","page","id" (id = unique short string, any; optional).

## 3. Item types
### button  {"type":"button","label":"Jump","x":87,"y":49,"s":14,"action":<ACTION>, ...options}
Options: shape "round"(default)|"square"|"pill"|"rect"|"none"; page; group; toggle:true (stays on until tapped again); turbo:ms (auto-repeat while held, e.g. 80);
pulse:ms (one tap of that length instead of hold); long:<ACTION> or {"action":<ACTION>,"ms":350}; double:<ACTION> or {"action":..,"ms":250};
goto:"pageName" (also switch page after press); haptic:ms; aim:"stick"|"drag" (+aimSpeed 22, sens 3: dragging the button aims camera);
group:"name" (radio group: only one button of the group looks selected, e.g. party slots);
look: color,border,textColor (#hex), opacity 0-1, rotate deg, fontSize, hidden:true (invisible but works), ar (aspect ratio).
### stick  {"type":"stick","x":16,"y":70,"s":30,"mode":"left", ...}
mode: "left" (analog left stick) | "right" (analog right stick) | "keys" (WASD etc.) | "dpad" (pad D-pad) | "mouse" (moves cursor).
keys/dpad: "keys":{"up":"w","down":"s","left":"a","right":"d"} - each value is an ACTION or key string (dpad default pad:UP/DOWN/LEFT/RIGHT).
Options: floating:true + w,h zone in % (stick appears where the thumb lands; defaults w45 h80); deadzone 0-1; curve (power, >1 = finer centre);
max 0-1 (limit output); invertX/invertY; sens (mouse mode: cursor speed, default 12; analog modes left/right: stick multiplier 0.3-3, default 1 - also multiplied by the global "Stick sensitivity" slider in the app Settings); outer:<ACTION> + outerAt:0.95 (action when pushed to the rim, e.g. sprint "pad:LS" or "shift");
click:<ACTION> (tap the stick = e.g. pad:LS). 
### look  {"type":"look","x":70,"y":50,"w":50,"h":90,"mode":"mouse","sens":2,"tap":"left","hold":"none","holdMs":280}
Touch-drag area. mode: "mouse" (camera/cursor) | "scroll" | "lstick" | "rstick" (drives that analog stick; use "rstick" for console-style camera). tap/hold = mouse button name or ACTION
("left","right","middle","x1","x2","none"). Options invertX/invertY. Put it BEFORE buttons in the array so buttons sit on top.
(sens for mode "mouse" = camera speed multiplier, about 2-6 for a phone screen; the minimal example below uses 2. Mouse-mode look is sent to the PC on every touch sample for v3-smooth aiming.)

### slider  {"type":"slider","x":50,"y":50,"w":8,"h":60,"target":"RT","spring":true}
target: "RT"|"LT" (analog trigger) | "lx","ly","rx","ry" (stick axis). spring:true returns to rest on release.
### label {"type":"label","label":"HP","x":10,"y":10,"s":12} (text only)

## 4. ACTION  (string shorthand OR object)
String: "pad:A" | "key:space" | "w" (plain string = key) | "mouse:left". Object: {"kind":"...","value":"..."}
- pad      value = A B X Y LB RB LT RT START BACK GUIDE LS RS UP DOWN LEFT RIGHT TOUCHPAD  (aliases: L1 R1 L2 R2 L3 R3 CROSS CIRCLE SQUARE TRIANGLE SELECT VIEW SHARE MENU OPTIONS XBOX PS HOME). LT/RT may take "amount":0-1.
- key      value = key name; combos with + : "ctrl+shift+s". Names: a-z 0-9, f1-f24, space enter esc tab backspace delete insert home end page_up page_down up down left right shift ctrl alt cmd(win) caps_lock print_screen num0-num9 numadd numsub nummul numdiv numdecimal, plus minus equals comma period slash backslash semicolon quote backtick lbracket rbracket, `vk:0x41` raw code.
- mouse    value = left right middle x1 x2 scrollup scrolldown scrollleft scrollright (optional "amount":n for scroll)
- combo    value = "pad:LB+pad:A" or "ctrl+c" (everything pressed together)
- multi    {"kind":"multi","actions":[<ACTION>,...]} pressed together
- macro    {"kind":"macro","steps":[...]} runs once on press (see 5)
- wheel    {"kind":"wheel","value":"90","button":"LB","stick":"right","aim":120,"hold":330}  hold button, flick stick at angle (deg, 0=up,90=right,180=down,270=left), release (weapon/radial wheels)
- stick    {"kind":"stick","side":"left|right","x":0,"y":-1} fixed stick push while held
- trigger  {"kind":"trigger","value":"RT","amount":1}
- text     {"kind":"text","value":"gg"} types text on the PC
- mousemove {"kind":"mousemove","dx":50,"dy":0}   mouseto {"kind":"mouseto","x":0.5,"y":0.5} (0-1 of screen)
- autoclick {"kind":"autoclick","target":<ACTION>,"min":400,"max":900,"holdMin":28,"holdMax":85,"pauses":true}  human-like auto clicker; make the button "toggle":true
- limit    {"kind":"limit","stick":"left|right|both","radius":0.4}  caps the OUTPUT length of that analog stick (0.05-1, 1 = no limit) while the button is ON. The finger still moves the whole stick; the game never sees more than `radius`. Buttons are toggles by default (tap on / tap off, highlighted while on; "toggle":false = limit only while held). Left and right are limited independently, several limits on one stick -> the smallest wins, so a Walk (left 0.4) and a Cinema (right 0.3) button work together. Applies to stick items in mode left/right and to look zones in mode lstick/rstick (not keys/dpad/mouse). Genshin: Walk = limit left ~0.4 (walks instead of runs), Cinema = limit right ~0.3 (slow smooth camera). Radius is editable in the editor (Action = Limit stick).
- page     {"kind":"page","value":"pageName|next|prev|back"} switch button page
- chat     {"kind":"chat"} opens the on-phone text box that types on the PC
            optional: "value":"t" (key that opens game chat, default t), "open":<ACTION> (replaces that key, e.g. "pad:X"), "send":<ACTION> (Send button, default key enter), "close":<ACTION> (X button, default key esc), "keep":true (bar stays open after Send, Exit button on the left), "reopen":<ACTION> (with keep: pressed again after Send for games that close chat on send, e.g. "key:t")
- chatSeq  (field on a BUTTON, not an action) {"chatSeq":{"then":["pad:B","pad:X"],"send":"pad:B","close":"pad:A","keep":true}} - pressing this button starts a sequence; if the next
            BUTTON presses are exactly the "then" list, the phone keyboard popup opens (sticks/look zones ignored; any other button cancels). Genshin: Chat(BACK) -> B -> X. keep:true = bar stays open after Send (clears the box) until the "Exit" button (left of the bar, sends "close") or an on-screen button with the same action as "close" is pressed.
- ui       {"kind":"ui","value":"edit"|"exit"}   - none {"kind":"none"}
Do NOT add ui "release"/"fullscreen" buttons (removed; the in-game pill menu does it).

## 5. Macro steps (array, run in order)
{"wait":700} | 700 (number = wait ms) | {"down":<ACTION>} | {"up":<ACTION>} | {"tap":<ACTION>,"ms":80} | "pad:B" (string = tap)
{"stick":"left|right","x":0,"y":-1} | {"trigger":"RT","amount":1} | {"text":"hi"} | {"move":[dx,dy]} | {"moveto":[0.5,0.5]} | {"scroll":1} | {"hscroll":1}
{"repeat":3,"steps":[...]} (nested max 4). Always end by returning sticks to 0 and releasing anything held (up).
Menu-wheel pattern (Genshin style, hold LB then flick right stick): [{"stick":"right","x":0,"y":0},{"down":"pad:LB"},{"wait":700},{"stick":"right","x":0,"y":-1},{"wait":350},{"stick":"right","x":0,"y":0},{"wait":150},{"up":"pad:LB"}]
Diagonals use 0.7071.

## 6. Pages
"page":"main" is default. Any other name makes a new page (switch with a page action or goto). "page":"*" = show on every page; "page":["main","map"] = several.
Use a second page for rarely used buttons (inventory, emotes) and put a "More" button (action {"kind":"page","value":"extra"}) and a "Back" button on it.

## 7. Design rules that work
- Controller games: left stick (mode left) + right look zone or right stick, ABXY diamond, shoulders/triggers on top corners (x~12 / x~88, y 8-24), START/BACK small top centre.
- PC games (keyboard+mouse): left stick mode "keys" (WASD), look zone mode "mouse" on the right half, buttons with key actions; Shift/Ctrl/Space as big thumb buttons.
- Aim for 12-30 items on the main page. Labels short (<= 8 chars) or an emoji. Use shape "square" for system buttons, round for combat.
- Colour code with "color": red-ish "#5a2a31" attack, blue "#233a5a" skill, grey default. Keep text readable.
- Give every item a unique "id" only if autoclick is used (the id must stay stable); otherwise ids are optional.

## 8. Minimal valid example (Xbox-style)
{"settings":{"haptics":true,"rumble":true},"layout":[
{"type":"stick","x":16,"y":68,"s":32,"mode":"left","outer":"pad:LS","outerAt":0.95},
{"type":"look","x":68,"y":45,"w":50,"h":90,"mode":"rstick","sens":2},
{"type":"button","label":"A","x":88,"y":70,"s":14,"action":"pad:A"},
{"type":"button","label":"B","x":95,"y":52,"s":14,"action":"pad:B"},
{"type":"button","label":"X","x":80,"y":52,"s":14,"action":"pad:X"},
{"type":"button","label":"Y","x":88,"y":34,"s":14,"action":"pad:Y"},
{"type":"button","label":"LB","x":10,"y":10,"s":10,"shape":"square","action":"pad:LB"},
{"type":"button","label":"RT","x":90,"y":10,"s":10,"shape":"square","action":"pad:RT"},
{"type":"button","label":"Menu","x":50,"y":8,"s":9,"shape":"square","action":"pad:START"},
{"type":"button","label":"Auto","x":50,"y":50,"s":12,"toggle":true,"id":"auto1","action":{"kind":"autoclick","target":"pad:B","min":400,"max":900}}
]}


## Chat bar recipes (all opt-in per layout, nothing game-specific lives in the app)
- Minecraft (T/Enter opens chat, Enter sends and stays in chat, Esc twice leaves):
  {"type":"button","label":"Chat","action":{"kind":"chat","keep":true,"close":{"kind":"macro","steps":[{"tap":"key:esc","ms":60},{"wait":150},{"tap":"key:esc","ms":60}]}}}
- Genshin (Chat(BACK) -> B -> X opens the bar, Send = B, Exit = A): put on the Chat(pad:BACK) button
  "chatSeq":{"then":["pad:B","pad:X"],"send":"pad:B","close":"pad:A","keep":true}
- Typing mode for ANY app (no game key is pressed, the phone keyboard just types into whatever is focused on the PC; Send = Enter, Exit only closes the bar):
  {"type":"button","label":"Type","action":{"kind":"chat","keep":true,"open":{"kind":"none"},"send":"key:enter","close":{"kind":"none"}}}  (use "send":{"kind":"none"} + "keep":false for text-only writing)
- Games where chat closes itself after sending: add "reopen":"key:t" next to "keep":true.

## Ready-made examples
The repo folder `layouts/` has `Minecraft.json` (keyboard+mouse, chat recipe, hotbar) and `Windows.json` (desktop navigation: touchpad, shortcuts, typing mode, macros) and `Genshin.json` (controller style with macros, wheel and chatSeq) - good references for the format.
