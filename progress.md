# Thunder Gamepad (formerly PadLink) — progress log (READ THIS FIRST when resuming)

Last updated: 2026-10-20 (milestone 20). Everything below the "HISTORY" line is chronological notes; this top part is the truth about the CURRENT state and wins on any conflict.

## CURRENT STATE
- **Two products from one `git push`** (GitHub Actions workflow "Build Thunder Gamepad"): the Android APK (artifact `ThunderGamepad-apk`) and the Windows exe (artifact `ThunderGamepad-exe`; tags `v*` attach both to a Release).
- **Architecture: the PHONE is the brain, the PC is a pure receiver.** The APK (Kotlin shell + WebView with all UI/engine/editor in `app/src/main/assets/www`) owns layouts, macros, timing, the editor. The PC program (`receiver/`) only turns low-level frames (`docs/PROTOCOL.md`) into virtual-controller (ViGEmBus Xbox 360 / DS4), keyboard and mouse input. DO NOT move UI/logic to the PC (user decision, repeated).
- **Verified on the user's real devices:** APK + exe build and run; the phone connects and plays; **the look zone is now as smooth as the old v3 ("worked like a charm", 144 fps feel)** after milestones 7i, 13, 14.
- **m20 (bundled layouts) — JS tested headless over http, gradle/Kotlin DSL NOT run (CI is the compiler):** everything in the repo's `layouts/*.json` is packed into the APK and auto-added to the Layouts library. `app/build.gradle.kts`: Copy task `bundleLayouts` (runs before `preBuild`) copies `layouts/*.json` to `build/generated/layoutAssets/layouts/` and writes `index.json`; that dir is an extra assets srcDir. `app.js loadBundled()` (called at start) fetches `../layouts/index.json` + files; ids `bundled_<name>`; bookkeeping `localStorage padlink.bundled` {id:{h hash,e edited stamp}}. Rules: new file -> added; same id never re-added after the user deletes it; an app update replaces the data ONLY if the user never edited that copy (layouts[id].edited === recorded e); the name is never overwritten. To ship a layout: just drop the .json into `layouts/` and push. Test: `python3 tools/smoke_bundled.py`.
- **m19 (import name) — JS tested headless, Kotlin NOT compiled (CI is the compiler):** imported layouts are named after the file ("Windows.json" -> "Windows"). Cause: Kotlin sent `uri.lastPathSegment` (e.g. `primary:Download/Windows.json`). Fix: `MainActivity.displayName(uri)` reads the real file name (OpenableColumns.DISPLAY_NAME, fallback = last path part) AND `app.js importDone` strips any path/`:` and `.json`. Test: `python3 tools/smoke_import_name.py`.
- **m18 (Windows desktop layout) — headless-tested, NOT yet seen on a device:** `layouts/Windows.json` (keyboard+mouse, 150 items over 5 pages: main = touchpad + scroll strip + clicks/drag/modifier toggles; keys, apps, media, magic = button palettes with a mini touchpad). Global top row (Start, Tasks, Desk, Alt-Tab, Close(long=Alt+F4), Find, page tabs, Type, Esc). Typing mode = `chat` action with `"open":{"kind":"none"}` (no 't' key; works with the existing code, no app change): "Type" keeps the bar open and Send = Enter, "Write" sends text only. Magic page: cursor-teleport 3x3 grid (`mouseto`), taskbar clock/show-desktop click macros, Alt-hold switcher, "Awake" (autoclick F15 every 45-70 s), select/delete line/word macros, Terminal/CMD/IP macros, Sleep (long-press). Test: `python3 tools/smoke_windows.py` (9 checks PASS). Snippet buttons (mail/phone on Apps page) hold placeholder text.
- **m17 (HUD pill / Edit / Exit must not disturb other apps) — in code + tested headless, NOT yet tried on a device:** bug: opening the Play menu and pressing Edit layout / Exit sent `{"t":"reset"}` and the receiver's `panic(H)` blindly released Ctrl/Shift/Alt/Win and EVERY mouse button (incl. X1/X2 = back/forward -> Claude/Chrome jumped between chats). Fix: `engine.js releaseAll` sends `reset` only if something was really held, else just `axes0` (pad only, invisible to apps); `core.py panic(H)` releases ONLY what that phone held (blanket release kept only for receiver shutdown, `panic()` with no H). Test: `python3 tools/smoke_bundled.py`, `python3 tools/smoke_import_name.py`, `python3 tools/smoke_windows.py`, `python3 tools/test_idle_release.py`. Tapping the pill itself never sent anything.
- **m16 (Walk / Cinema stick limiter) — in code + headless-tested, NOT yet tried on a device:** new action `limit` (see docs/LAYOUT_SPEC.md). `layouts/Genshin.json` now has a Walk button (left stick, radius 0.4) and a Cinema button (right stick, radius 0.3).
- **In code + unit-tested, NOT yet reported on by the user:** no-code Allow pairing (m10), one-click ViGEmBus install + firewall rules (m11), exe icon (m12), stick sensitivity (m9), Windows typed-text via scan codes (m13). Chat bar features (chatSeq/keep/reopen) were tested by the user in an earlier chat.
- Kotlin has never been compiled locally; CI is the compiler. Receiver was only run with stubs in the sandbox.

## HOT-PATH RULES (hard-won over milestones 7e-7i, 13, 14 — DO NOT BREAK; the look zone must stay as fast as v3)
1. **Look zone (mouse mode): ONE `mmove` per touch event, sent immediately.** Listen to `pointerrawupdate` (fallback `pointermove`). Only the sub-pixel remainder is carried. NO requestAnimationFrame batching, NO merging, NO throttling (batching/merging caused the "zap" shutters every 0.5-1.2 s).
2. `link.js send()` = plain `ws.send(JSON.stringify(o))`. The phone page opens the WebSocket itself (direct, like v3). The OkHttp "Compatibility mode" is an OFF-by-default fallback, never on the hot path. No JS->Kotlin bridge calls from touch-move handlers (haptics only on press).
3. **Receiver:** `boost.py` is a deliberate no-op (no HIGH priority / timer tweaks), no stall monitor, no extra work in `ws_handler` before `handle()`. Anything slow (driver install, firewall, status, autostart) runs on background threads or is cached.
4. **Phone speed settings (keep):** `MainActivity.requestMaxRefresh()` (highest display mode, called in onCreate + onResume), `play.js keepFrames()` (ONE EMPTY rAF loop while playing — it fixed the lower-fps feeling; do not add per-frame measuring/work), unbuffered touch dispatch (`requestUnbufferedDispatch`), `RENDERER_PRIORITY_IMPORTANT`, `android:hardwareAccelerated="true"`.
5. Do not add periodic timers/DOM work during play (the HUD pill only refreshes on ping answers every 2 s).
6. If it ever feels slower than v3 again: bisect against these rules first. Further ideas (not built): native Kotlin look-zone touch + native socket; UDP for mouse moves; ADPF/sustained performance.

## MAP OF THE PROJECT (`padlink/`)
- `app/src/main/java/com/padlink/app/MainActivity.kt` — Kotlin shell + `NativeBridge` (discovery, vibrate, keep-awake, immersive, import/export, keyboard show/hide, WifiLock, OkHttp fallback).
- `app/src/main/assets/www/` — `index.html`, `app.js` (Connect/Layouts/Settings), `link.js` (connection, pairing tokens, ping), `engine.js` (actions/macros/Held), `play.js`+`play.css` (Play screen, look/stick/button/slider, chat, HUD pill), `editor.js`+`editor.css`, `presets.js` (Xbox/PlayStation), `dlg.js`.
- `receiver/` — `core.py` (server, pairing, ViGEm pad, input, driver/firewall installer, status API), `gui.py` (exe launcher: opens the Edge/Chrome app window, `--selftest`, `--background`, admin relaunch), `ui/index.html` (PC window), `boost.py` (no-op), `thunder_receiver.py` (dev console), `ThunderGamepad.ico`.
- `.github/workflows/build.yml` — apk + exe (+release on tags). `layouts/` — Minecraft.json, Genshin.json. `docs/` — `PROTOCOL.md`, `LAYOUT_SPEC.md`, `progress.md`. `tools/` — headless tests.
- Package id `com.padlink.app`, localStorage keys `padlink.*`, discovery magic `PADLINK?` are DELIBERATELY unchanged (renaming would break installs/data). Visible name: **Thunder Gamepad**, exe `ThunderGamepad.exe`.

## TESTS (run from `padlink/`, each under `timeout 55`; sandbox Playwright)
`python3 tools/test_idle_release.py` (idle release sends no reset; needs node), `python3 tools/smoke_limit.py` (Walk/Cinema limiter, 15 checks) + `python3 tools/smoke_limit_editor.py` (radius editable + saved), `python3 tools/smoke_link.py`, `LAYOUT=layouts/Minecraft.json python3 tools/smoke_look.py`, `python3 tools/smoke_home.py`, `python3 tools/smoke_presets.py`, `python3 tools/smoke_import.py`, `python3 tools/test_receiver.py` (stubbed aiohttp/pynput/vgamepad). `smoke_play.py`, `smoke_editor.py`, `smoke_sens.py` need a layout with the old Genshin button names (e.g. "Jump", "Map", "Auto") — e.g. `LAYOUT=Genshin_layout.json`; `smoke_sens` works with `layouts/Genshin.json`. Sandbox gotcha: keep each command < 300 s and verify patches with grep.

## USER'S WORKFLOW + PREFERENCES
- Windows (cmd, not PowerShell). Repo `dineshmageman007-sketch/Thunder_Gamepad`. Pushes, downloads artifacts from Actions, installs the APK over the old one, double-clicks the exe.
- **ALWAYS deliver the FULL push-ready project zip (builds APK + EXE) + `progress.md` (+ every changed file) in the same reply.** Complete replacement files, never "edit line X". Short replies, plain language, ready-to-use.
- **The user also attaches a generic `Read_this_before_starting.txt` (same for all projects). Project-specific rules live HERE, not there.**
- **Free-account pacing (CHECKPOINT RULE):** stop each reply after ~10 tool commands (or ~5 min) and hand over progress.zip + progress.md + changed files.
- **Docs to keep in sync with the code:** `README.md`, `docs/PROTOCOL.md`, `docs/LAYOUT_SPEC.md`, this file (`progress.md` at the repo root AND `docs/progress.md` — they must be byte-identical; copy after every edit), (the generic `Read_this_before_starting.txt` is NOT part of this repo: the user attaches it to every project; it holds only general rules).
- Lesson (milestone 15): never overwrite progress.md from an older copy — an earlier merge lost milestones 9-12 and the chat notes because root `progress.md` and `docs/progress.md` had diverged.

## REMAINING WORK (ordered)
1. Real-device verification of m10/m11/m12 (first-time Allow pairing, driver install + UAC, firewall button, exe icon in build) — report back any CI/exe errors.
2. Settings extras: haptic strength, "reset all data", clearer import errors (global + per-stick sensitivity is DONE).
3. Hardening: multi-touch, rotation, rumble in a real game, export/import round trip, old v3 layouts with look/slider.
4. Release polish: fixed signing keystore (secrets) so APK updates install over each other, shared version number, README screenshots, SmartScreen note.
5. Optional: tray icon / auto-quit for the PC program; phone icon/splash polish; sensitivity slider inside the in-play menu.
Known limits: no multi-select/copy-paste in the editor; full-screen zones leave no empty canvas to tap in the editor (use the layout panel).

---------------------------------------------------------------------------------------------------------------------
# HISTORY (chronological; older statements may be superseded by CURRENT STATE above)

### milestone 20 — bundled layouts
See CURRENT STATE m20. Files: `app/build.gradle.kts`, `app.js`, `tools/smoke_bundled.py`. Tests: smoke_bundled 8/8 PASS (mimics the gradle output with a temp folder).

### milestone 19 — import name
See CURRENT STATE m19. Files: `MainActivity.kt`, `app.js`, `tools/smoke_import_name.py`. Tests: smoke_import_name PASS, smoke_import PASS.

### milestone 18 — Windows layout
See CURRENT STATE m18. Files: `layouts/Windows.json`, `tools/smoke_windows.py`, docs/LAYOUT_SPEC.md (typing-mode recipe).

### milestone 17 — pill/menu no longer sends visible input
See CURRENT STATE m17. Files: `app/src/main/assets/www/engine.js`, `receiver/core.py`, `tools/test_idle_release.py`. Tests: test_receiver ALL PASS, smoke_look (Minecraft) PASS, smoke_link ALL PASS, test_idle_release PASS.

## Goal (from user, stated)
Personal project. Old `phone_gamepad_v3.py` (2282 lines, aiohttp+pynput+vgamepad on the laptop, HTML/JS UI served to the phone,
all logic on the laptop) must be inverted: **everything runs in an Android app; laptop = minimal receiver** that exposes a virtual
controller whose type (Xbox 360 / DS4 / none) is chosen from the phone. No functionality loss. Full UI redesign: well-organised,
easy to navigate. Deliverable: GitHub-pushable Gradle project that builds an APK (CI workflow included).
Work style: long task -> stop each reply at ~5 min / ~10 tool commands and hand over progress.zip + progress.md.

## Architecture (ORIGINAL plan; superseded by CURRENT STATE where different: link is now a direct page WebSocket, pairing is the Allow prompt, receiver is core.py/gui.py)
- Android app = Kotlin shell (`MainActivity.kt`) hosting a WebView that loads `assets/www/index.html` through WebViewAssetLoader.
  Kotlin only does: OkHttp WebSocket to laptop, UDP LAN discovery, vibration, immersive, keep-awake, file import/export.
  JS->Kotlin: `NativeBridge.{connect,disconnect,send,vibrate,keepAwake,immersive,importFile,exportFile,exitApp,discover}`.
  Kotlin->JS: `window.Native.onMessage(jsonString)`; back button -> `window.Native.onBack()` (true = handled).
- `engine.js` = port of the Python logic (apply/combo/multi/macro/wheel/autoclick/Held bookkeeping/release_all) emitting low-level events.
- `link.js` = connection state + prefs (`localStorage padlink.conn`), ping/rtt, rumble->vibrate, discovery results.
- `app.js` = shell: Connect, Layouts (library), Settings. Layout store: `localStorage padlink.layouts` = {id:{name,data:{settings,layout},edited}}.
- Laptop `receiver/padlink_receiver.py`: ~400 lines, pairing code (saved in ~/.padlink_code), single phone, releases held inputs on disconnect.
- Wire protocol: `docs/PROTOCOL.md`. Layout JSON format is UNCHANGED from the old project (old files import as-is).
- CI: `.github/workflows/build-apk.yml` (JDK17, setup-gradle 8.9, `gradle :app:assembleDebug`, uploads APK). No gradle wrapper jar (no network when generated).

## DONE

### milestone 1
- [x] Gradle project (AGP 8.5.2, Kotlin 1.9.24, compileSdk 34, minSdk 26, okhttp 4.12, androidx.webkit) + manifest + icon + theme
- [x] MainActivity.kt bridge (written carefully, NOT yet compiled — first CI run may show a compile error to fix)
- [x] Receiver (py_compile OK, not run against real vgamepad)
- [x] engine.js, link.js, app.js, index.html, app.css (shell with side rail nav); Connect / Layouts (import/export/delete/new) / Settings screens

### milestone 2 (this session) — Play screen
- [x] `play.js` + `play.css`: full port of old normalize/matchPage/pageList/setPage/place/makeEl/buildStick/liveButton (tap/hold/toggle/long/double/turbo/pulse/aim/autoclick/group-select)/liveStick (analog, keys, dpad, floating, mouse, outer, click)/liveLook/liveSlider/chat bar/ui buttons (release, edit, fullscreen)
- [x] Wiring: `index.html` has `#play` overlay (stage + #hud + #chatbar), loads play.css/play.js after app.js; `app.js` Play button -> `Play.start(rec)`; `App.back()` defers to `Play.back()`; `App` exposes `{settings,H,toast,afterPlay}`
- [x] In-play chrome: draggable HUD pill (conn dot + rtt; tap = menu: page prev/next, reconnect, release all, edit layout, exit; position saved in `localStorage padlink.hud`). Android Back while playing = open/close HUD menu (never exits directly). Chat bar sits at TOP so the keyboard can't cover it.
- [x] Item ids from layout files are kept (deduped); `normalize` no longer rewrites ids (old app did) so autoclick `AUTO` map keys stay stable.
- [x] TESTED headless (Playwright chromium, mocked NativeBridge, Genshin_layout.json): 36 elements render; Jump -> pad A down/up; Map macro -> 5 ordered events; Auto toggles on (events) and off (silent); floating left stick -> stick events then 0 on release. 0 JS errors. Script: `tools/smoke_play.py` (`LAYOUT=file.json python3 tools/smoke_play.py`).
- Play.util exports `{normalize, normalizeAll, pageList, place, toAction, DEF_SET}` for the editor. `runUi("edit")` calls `Editor.open(rec)` if `window.Editor` exists, else shows a toast.

### milestone 3 (this session) — Editor
- [x] `editor.js` + `editor.css`: full-viewport canvas (same vmin sizing as Play, so WYSIWYG) + top bar (Done, page tabs + new page, Add menu, undo/redo, Snap off/1/2.5/5 %, ☰ layout panel, ▶ Play) + right/left inspector drawer (opens on the side AWAY from the selected control so it can still be dragged; dims during drag/resize).
  Drag to move, yellow corner handle to resize (zones: w/h %, others: size s). Autosave (150 ms debounce) via `App.saveLayout(id,{settings,layout})`; undo/redo snapshots (80 deep, typing/slider edits coalesced).
- [x] Inspector ports ALL old phone-panel fields + what used to need the laptop window: action editor for every kind (pad/key/mouse/page/combo/wheel/text/chat/macro/multi/stick/trigger/mousemove/mouseto/autoclick/none), toggle, goto, group, aim (stick/drag), turbo, pulse, stick modes (left/right/keys/dpad/mouse, floating, per-direction actions, deadzone), look zone, slider, pages, Appearance (fill/border/text colour, opacity, rotate, text size, hidden), duplicate/delete.
  **Macro text editor**: one step per line (`wait 700`, `down pad:LB`, `tap pad:B 80`, `stick right 0 -1`, `trigger RT 1`, `text hi`, `move 60 0`, `moveto .5 .5`, `scroll 1`, `hscroll 1`); lossless for all 12 Genshin macros. Macros with `repeat` -> JSON box. `multi` = one action per line.
  **Advanced (JSON)** box per control for anything else (long/double press, outer ring, click, nested macros...).
- [x] Layout panel (☰ or nothing selected): rename layout, pages (rename/delete), list of controls on this page (to select hidden/overlapped ones), Theme (7 colours + opacity + haptics/rumble per layout), "Load Xbox template".
- [x] `dlg.js`: in-page `Dlg.prompt/Dlg.confirm` (promises). MainActivity has NO WebChromeClient, so native `prompt()/confirm()` would silently fail in the app -> app.js now uses Dlg everywhere.
- [x] Wiring: Layouts-screen "Edit", HUD "Edit layout" (Play -> Editor -> back into Play automatically), `App.{recOf,saveLayout,rename,afterEdit}`, Android Back closes menu -> drawer -> editor. New layouts start from the Xbox template (19 controls, no in-layout ui buttons; HUD pill replaces them).
- [x] play.js refactor: `buildEl(it, edit)` split from `makeEl`; `Play.util` now also exports `buildEl, applyCfg, isZone, isUi, uid, vmin, esc, clamp`. play.css element rules are scoped `:is(#play,#editor)`.
- [x] TESTED headless: `LAYOUT=file.json python3 tools/smoke_editor.py` -> 18 checks ALL PASS (render 36 items, select/inspector, label save, drag, resize, undo/redo, kind change, macro text<->steps + error, add slider, layout panel, theme save, JSON apply, Done->library, Play->Edit->Play, New layout template, 0 JS errors). Bug found+fixed by the test: drawer used to cover right-side controls.
- Known limits: layouts whose zones fill the screen (Genshin) have no empty canvas to tap, so use ☰ for the layout panel; no multi-select / copy-paste between pages; no on-canvas guides beyond the 10 % grid.

### milestone 4 (this session) — Home polish + connection resilience
- [x] Connect screen: **Continue card** (`#cont`) = last-played (or newest) layout with one-tap Play; shows Connected/Not connected, refreshes on link events; hint when no layouts exist.
- [x] Layouts cards: Play/Edit row + Rename / Duplicate (deep copy) / Export / Delete row; "played N min ago" stamp (`played` field on layout record; all Play paths go through `playLayout(id)`).
- [x] Auto-reconnect: `link.js` `want/retries/retry()` (backoff 1-5 s, max 15 tries, never after manual Disconnect or wrong code); `Native.onResume()` (Kotlin `onResume` calls it) reconnects when app returns to foreground; new setting `autoReconnect` (default on) in Settings.
- [x] Reviewed `MainActivity.kt` by eye for compile problems (none found; imports/APIs OK, manifest has cleartext + permissions, theme is framework Material so ComponentActivity is fine). STILL never compiled: no network/gradle here.
- [x] Tests: `tools/smoke_home.py` (10 checks), `tools/smoke_link.py` (5 checks), plus smoke_play / smoke_editor re-run -> all pass, 0 JS errors.

### milestone 5 (this session) — Receiver verified + hardened
- [x] `tools/test_receiver.py` (18 checks, ALL PASS): runs the real `padlink_receiver.py` with stubbed aiohttp/pynput/vgamepad (no network/driver in sandbox): auth, wrong-code, lockout, pong, pad/trigger/stick/key(F5->vk)/mouse/scroll/type dispatch, takeover by a new connection, held-input release, setpad xbox->ds4->none, ds4 dpad diagonals, CUR cleanup. NOT yet run with real aiohttp/ViGEmBus on Windows (user to try: `pip install aiohttp vgamepad pynput`, `python padlink_receiver.py`).
- [x] Receiver fix: pairing-code brute-force guard (5 wrong codes per IP -> 60 s lock, reply `denied+locked`; app shows "Too many wrong codes - try again in N s"); 0.4 s delay on wrong code.
- [x] Receiver fix: a stale (replaced) connection's cleanup no longer zeroes the new connection's sticks (matters with the new auto-reconnect). `Held.release(zero_axes)`.
- Sandbox gotcha: a command that hits the 300 s limit can lose its file edits -> keep tests under `timeout 40`, verify patches with grep.

### milestone 6 — first real-device test fixes (APK builds + installs; receiver works on user's Windows PC via cmd: `cd /d <...>\padlink\receiver` then `python padlink_receiver.py`)
- [x] CI is GREEN (fixes: removed setup-android step; renamed `setImmersive` -> `applyImmersive`).
- [x] User bug report: (1) two useless in-play buttons (fullscreen, reload/release) -> `normalizeAll` in play.js now FILTERS OUT ui items with value `release`/`fullscreen` (existing saved layouts too; they disappear from the file on the next edit-save); editor UI-button dropdown now only offers `edit`, `exit`. (2) Editor top bar was a full-width straight bar that couldn't move and covered controls -> now a FLOATING 2-row panel (row 1: grip, Done, Add, undo, redo, Snap, ☰, Play; row 2: page tabs), width min(50vw,440px), drag by the ⠿ grip, position saved in `localStorage padlink.edbar`, clamped on screen, z-index above the inspector drawer; Add menu opens right under the Add button; drawer now starts at top:0.
- [x] Tests updated: `tools/smoke_editor.py` ALL PASS (adds 6 toolbar checks); smoke_play: 34 elements (was 36).
- Files touched: index.html (#edBar markup), editor.css, editor.js, play.js, tools/smoke_editor.py.

## APP NAME (user decision, this session): **Thunder Gamepad**
Visible name everywhere (Android label, WebView title, README, docs, CI artifacts, exe = `ThunderGamepad.exe`, gradle rootProject).
DELIBERATELY UNCHANGED (renaming would break saved data / installs): Android package `com.padlink.app`, theme `Theme.PadLink`,
localStorage keys `padlink.*`, discovery magic `PADLINK?`, layout JSON format. Remaining TODO for the name: custom app icon/splash text, exe icon (.ico), window title in HUD if any.

### milestone 7 (this session) — NEW REQUIREMENT step 1 + 3 + rename (user said "continue"; Allow-prompt chosen as default, user never answered Allow vs QR)
- [x] Receiver split: `receiver/core.py` (all logic, no argparse; `log()`, `HOOK`, `status()`, `check_driver()`, `serve()`, `start_thread()`, `stop()`, `PHONE`), `receiver/thunder_receiver.py` (console CLI, dev only), `receiver/gui.py` (tkinter window: status dot + phone name, PC address, pairing code (TEMPORARY), controller type, driver check + "Install controller driver" button -> opens ViGEmBus releases page, Start-with-Windows (HKCU Run), log box, Quit, `--selftest` flag for CI). `padlink_receiver.py` deleted; `start_receiver.bat` now runs thunder_receiver.py. Code file moved to `~/.thunder_gamepad_code`.
- [x] CI: `.github/workflows/build.yml` replaces build-apk.yml: jobs `apk` (ThunderGamepad.apk), `exe` (windows-latest, py3.11, PyInstaller `--onefile --noconsole --collect-all vgamepad --name ThunderGamepad --paths receiver receiver/gui.py`, then runs `ThunderGamepad.exe --selftest` and fails if the port does not open), `release` (tags v*: attaches APK + EXE). Artifacts: `ThunderGamepad-apk`, `ThunderGamepad-exe`.
- [x] README rewritten (end-user). Tests: test_receiver (18) now imports `core`, ALL PASS; smoke_play/home/link/editor ALL PASS.
- NOT VERIFIED: gui.py (no tkinter in sandbox; only py_compile), the exe job (never ran on GitHub), PyInstaller + vgamepad bundling, selftest on windows. First CI run may need a fix (watch: vgamepad DLL collection, `--paths receiver`, tkinter in the windows python).

### milestone 7b (this session, after first real CI runs) — exe CI fixed, GUI redesigned, rumble + crash fixes
- [x] **CI exe job FIXED (green path)**: `pip install vgamepad` HUNG on the runner (its setup.py tries to install the ViGEmBus driver). Now: `pip install aiohttp pynput pyinstaller`, download `vgamepad-0.1.0.tar.gz` from files.pythonhosted.org, copy its `vgamepad` folder into site-packages, check `ViGEmClient.dll` exists (do NOT `import vgamepad` in CI: it raises VIGEM_ERROR_BUS_NOT_FOUND because the driver is absent on runners). `timeout-minutes: 15`. Final file: `.github/workflows/build.yml` (apk job was already green). Exe built, self-test passed, user ran it: window opens, phone connects, driver OK.
- [x] **GUI redesign** (`receiver/gui.py`): status card (green/amber/red dot + plain sentence), DETAILS card (PC address, Controller in plain words, Controller driver with red X + install button, Pairing code), autostart checkbox, technical log HIDDEN behind a "Show technical log" toggle, Quit. Not run-tested in sandbox (no tkinter), user saw it work in v1 layout.
- [x] **Rumble bug fixed** (`core.py`): vgamepad checks callback PARAMETER NAMES. Now `_rumble_cb_xbox(client,target,large_motor,small_motor,led_number,user_data)` and `_rumble_cb_ds4(..., lightbar_color, user_data)`; init_pad tries the right one first. NOT yet verified in a real game.
- [x] **Crash fix** (`core.py`/`gui.py`): user reported window frozen + closing after ~5 s. Suspected cause: `check_driver()` created a virtual pad twice while a native rumble callback was registered -> use-after-free. Now `check_driver()` only does `import vgamepad` (no pad created), `init_pad` calls `pad.unregister_notification()` before replacing a pad, and gui.py enables `faulthandler` + writes tracebacks to `~/ThunderGamepad_crash.log`. UNCONFIRMED: waiting for user to test the new exe; if it still dies ask for that log file and whether it died before/after the phone connected.
- APK unchanged by milestone 7/7b (only receiver + CI files changed).

### milestone 7c (this session) — PC window redesigned to match the APK (replaces tkinter)
- User complaint: tkinter window "looks like a 2000s program". NOW: the PC window is `receiver/ui/index.html` (same CSS tokens/rail/cards as the app's app.css) served by the receiver itself at `http://127.0.0.1:8766/ui` and opened as a borderless Edge/Chrome **app window** (`--app=URL --window-size=980,640 --user-data-dir=~/.thunder_gamepad_window`; fallback = default browser). NO tkinter any more, no new pip deps.
- `core.py` new: loopback-only routes `GET /ui`, `GET /api/status` (phone, pad, ips, code, driver{checked,ok}, autostart, version, log, error), `POST /api/{quit|autostart|driver}`; `QUIT` event, `DRIVER` probe thread, autostart (HKCU Run, now with `--background`), `SERVER_ERROR`, `_res()` (finds `ui/` also inside PyInstaller `_MEIPASS`).
- `gui.py` is now a launcher: `--selftest` (CI: fetches /ui + /api/status, exit code), `--background` (autostart: no window), if port already open -> just reopens the window (single instance; also how to bring the window back after closing it), else starts core thread, opens window, waits for `core.QUIT` (Quit button in Settings), crash log `~/ThunderGamepad_crash.log` kept.
- Closing the window does NOT stop the receiver (no tray icon yet); Quit is in the window's Settings. TODO maybe: tray icon (pystray) or auto-quit option.
- CI: PyInstaller now has `--add-data "receiver/ui;ui"`; selftest checks UI + status content. Tests: `tools/test_receiver.py` ALL PASS; `tools/shot_pcui.py` renders the UI with a mocked API (0 JS errors, screenshots looked right). NOT tested: aiohttp routes (no aiohttp in sandbox), Edge launching, PyInstaller bundling of `ui/` — first CI run may need a fix.
- Pairing code still displayed (temporary, removed by the Allow-prompt milestone).

### milestone 7d — layout authoring spec
- [x] `docs/LAYOUT_SPEC.md`: ONE compact file (~4k tokens) with everything an AI needs to write a layout JSON (file shape, coordinates, all item types + options, every action kind, macro steps, pad/key names, pages, design rules, valid example). User gives only this file to a fresh chat to get a game layout instead of the whole project. Keep it in sync when item fields/actions change (source of truth: play.js `normalize`, engine.js `apply/runMacro`).
- [x] `tools/check_layout.py`: `LAYOUT=file.json python3 tools/check_layout.py` renders any layout headlessly (element count, JS errors, tap test). Spec example: 10/10 rendered, 0 errors; Genshin: 34/36 (2 obsolete release/fullscreen buttons are dropped on purpose).

### milestone 7e — look-zone lag + old layout import (user: old program "phone_gamepad_v3_1.py" was perfectly smooth, new look zone laggy)
- COMPARISON old vs new: PC-side `mouse_move` (SendInput) is IDENTICAL; look-zone JS identical (per-event send, Math.round). Difference is the TRANSPORT: old = phone Chrome page -> browser WebSocket straight to the PC (Chromium: TCP_NODELAY, no bridge). New = WebView JS -> `NativeBridge.send` (sync JS->Kotlin call) -> OkHttp WebSocket (Nagle/delayed-ACK possible, Wi-Fi power-save, unbounded send queue), and PC->phone rumble messages each did `runOnUiThread + evaluateJavascript`.
- FIXES (all in APK, UNVERIFIED on a device, Kotlin never compiled locally -> CI will tell): `MainActivity.kt`: `NoDelayFactory` (TCP_NODELAY on every socket), `WifiLock` (LOW_LATENCY on API 29+, else HIGH_PERF) held while connected, mmove merge when `queueSize()>4096`, rumble throttle (60 ms, zeros always forwarded); `AndroidManifest.xml`: WAKE_LOCK; `play.js` liveLook mouse mode: one `Engine.mouseMove` per animation frame with sub-pixel remainder carried.
- IF STILL LAGGY (ask user for the RTT ms shown in the HUD first): PLAN B = make link.js open the WebSocket directly from the WebView page (`new WebSocket("ws://host:8766/ws")`, identical to the old app; needs `settings.mixedContentMode = MIXED_CONTENT_ALWAYS_ALLOW` because the page is https://appassets...), keeping NativeBridge only for discovery/vibrate/files. Also check phone on 5 GHz / PC on Ethernet, no VPN.
- [x] Import fixed: `app.js importDone` now accepts a bare array of controls (old format) as well as `{settings,layout}`. Test: `tools/smoke_import.py`. Converted user's `minecraft_refreshed_layout.json` -> `Minecraft_layout.json` (wrapped; 45 items, 2 pages main+menu, renders, 0 errors).
- [x] LAYOUT_SPEC.md fix: look-zone stick modes are `lstick`/`rstick` (NOT left/right).

### milestone 7f — DIRECT socket (user: "make it as fast as latency can get, just like the old one")
- `link.js` rewritten transport: the page itself opens `new WebSocket("ws://host:port/ws")` (Chromium socket, TCP_NODELAY, no JS->Kotlin bridge, no OkHttp) = same path as the old browser app. mmove merged when `ws.bufferedAmount>4096`; rumble throttled 60 ms in JS; device name from UA.
- `MainActivity.kt`: `settings.mixedContentMode = MIXED_CONTENT_ALWAYS_ALLOW` (page is https://appassets..., socket is ws://) + bridge `keepWifi(on)` (WifiLock low-latency while connected). OkHttp/`Bridge.connect/send` kept ONLY as automatic fallback: if the direct socket errors before it ever opened, link.js calls `nb.connect` once (`L.mode="native"`).
- Tests: `tools/smoke_link.py` rewritten with a FakeWS (12 checks ALL PASS: direct URL, hello, welcome, merge, rumble throttle, retry, manual disconnect, denied, native fallback). smoke_play/check_layout now force `Link.mode='native'` so they can capture sent events via the mocked bridge. All other tests pass.
- UNVERIFIED ON DEVICE: whether the WebView allows ws:// from the https asset origin on the user's phone (if not, the fallback silently uses the old Kotlin route -> same lag as before; tell user to check the HUD rtt). If lag persists, Plan C: serve the whole UI from the PC (like the old app) or load the assets over http via a local scheme.

### milestone 7g — fallback is now OPTIONAL (user request)
- New setting `nativeFallback` (default OFF), shown in Settings as "Compatibility mode". `link.js native(why)` only uses the Kotlin/OkHttp route when it is ON; when OFF a failed direct socket shows "Can't reach the PC (if this keeps happening, turn on Compatibility mode in Settings)". `smoke_link.py` covers both cases (14 checks).
- Answers given to user: intermediates existed because the page is served from https://appassets (ws:// blocked as mixed content by default) so Kotlin did the socket (my mistake: should have allowed mixed content + measured); Kotlin still owns what a web page cannot: UDP discovery, vibration amplitude, keep-awake, immersive, file import/export, WifiLock. No feature lost by direct socket. PC side unchanged: virtual Xbox 360/DS4 via ViGEmBus appears as a real controller to Windows/games; keyboard/mouse via SendInput.

### milestone 7h — ready-made Xbox 360 + PlayStation layouts (user request)
- `www/presets.js` (`Presets.list`, plain layout data, loaded before app.js in index.html): **Xbox 360** (19 controls: LT/LB/RT/RB, left+right stick with click=L3/R3, d-pad, A/B/X/Y coloured green/red/blue/yellow, BACK/⊞/START, L3/R3; `settings.pad="xbox"`) and **PlayStation** (20 controls: L2/L1/R2/R1, sticks, d-pad, ✕○□△ coloured blue/red/pink/green, Share/Pad(touchpad)/Options, PS, L3/R3; `settings.pad="ds4"`). Top row sits at y=15 so it doesn't hide under the in-game pill.
- `app.js`: seeds both into the library ONCE (flag `padlink.seeded`; existing users get them too), buttons "+ Xbox 360 layout" / "+ PlayStation layout" in Layouts add fresh copies any time (`[data-preset]`), and `playLayout` switches the PC controller (`Link.setPad`) when the layout has `settings.pad` of xbox/ds4.
- Tests: `tools/smoke_presets.py` (9 checks ALL PASS: seeded, render counts, face button sends pad A, PS switches to ds4, add buttons, no re-seed); smoke_home/import/editor/link updated to set `padlink.seeded=1` so seeding doesn't disturb them; all ALL PASS. Screenshots viewed: layouts look right.

### milestone 9 — joystick sensitivity (user: "make the sensitivity of joystick changeable")
- [x] **Global setting** `stickSens` (default 1, range 0.3-3) in Settings screen: slider at top of the list + "Reset to 1.00x"; saved instantly (`padlink.settings`), read LIVE by play.js (`gSens()`), so it applies while playing without restart. Affects analog sticks (left/right) and mouse-mode sticks (speed). Not key/dpad sticks (no analog).
- [x] **Per-stick** sensitivity: editor inspector shows "Sensitivity" (0.3-3, default 1) for stick modes left/right (uses item `sens`, normalised default 1); mouse-mode stick keeps its "Mouse speed". Final output = clamp(curve(deadzone-adjusted push) x global x per-stick, 0..1) x `max`. So >1 reaches full tilt with a smaller push, <1 is gentler/limits top speed.
- Files: `play.js` (gSens + liveStick), `app.js` (DEF_SETTINGS + renderSettings slider), `editor.js` (stick inspector), `tools/smoke_sens.py` (new: 1x/2x/0.5x -> 0.18/0.36/0.09), `tools/smoke_play.py` (now sets `padlink.seeded=1`; it previously played the seeded Xbox preset and failed at "Jump" - a test-harness bug, not an app bug). smoke_play/editor/home + smoke_sens pass, 0 JS errors.
- IDEAS NOT DONE: quick sensitivity slider inside the in-play HUD menu; separate left/right global values.

### milestone 10 — NO-CODE PAIRING (REMAINING WORK item 1) — DONE in code, untested on real devices/GitHub CI
- **Receiver** (`receiver/core.py`): pairing code REMOVED. Phone sends `hello{token,pad,name}`. Known token -> silent welcome. Unknown/empty -> `pending` + PC window shows **Allow / Block** (30 s, `ASK_SECS`); Allow -> new 32-hex token saved in `~/.thunder_gamepad_devices.json` (`{"pcid","phones":{token:{name,ip,added,last}}}`), `paired{token}` then `welcome{..,pcid}`. Denied reasons: blocked/timeout/busy/locked/gone; 3 declines from an IP -> ignored 60 s. `pcid` = random id of the PC, also in the UDP discovery reply (phone re-finds a PC whose IP changed). New: `pair_request/add_phone/decide/forget/phones_list`, `PENDING`, `LAST_UI_POLL`. API: `POST /api/decide {allow}`, `POST /api/forget {id|"all"}`; `/api/status` now has `pending{name,ip,left}` + `phones[]` (no `code`). Dev CLI flags: `--allow-all`, `--code X` (accepted as token).
- **PC window** (`receiver/ui/index.html`): full-screen "Allow this phone?" dialog (Allow/Block), "Paired phones" row on Status + list with Remove in Settings, pairing code gone, steps text updated. `gui.py`: hook opens the window when a phone asks and nobody has the window open (also for `--background` autostart).
- **Phone** (`link.js`, `app.js`, `index.html`): `conn.pcs {pcid:{name,host,port,token}}` + `conn.pc`; `tokenFor()`, `autoStart()` (app start: reconnect to remembered PC + discover), `rematch()` (found list with same pcid but new IP -> update + reconnect), states `pending`/`denied` with plain messages, auto-retry also after a failed first try in auto mode. Connect screen: no code field; tapping a found PC connects at once; host/port inside "Type the PC address yourself"; hint line hides once a PC is remembered. Kotlin fallback sends the token in the hello `code` field (no Kotlin change; PC accepts token or code).
- Tests: `tools/test_receiver.py` rewritten for the Allow flow (28 checks ALL PASS: pending, block, 3-decline lock, busy, allow->pending/paired/welcome, file saved, known token silent + takeover, stale token re-asks, timeout, forget kicks phone, --allow-all, plus the old input/rumble/setpad checks), `tools/smoke_link.py` (token hello, pending, paired+pcid stored, autoStart, IP change by pcid, denied messages: ALL PASS), smoke_home/presets/import/play pass. smoke_editor failed at first, and after the summary rename it re-ran ALL PASS (checked in milestone 11), because the new Connect-screen summary said "Advanced", which the test selector `details:has-text("Advanced")` matched first; summary renamed).
- `docs/PROTOCOL.md` updated. README still mentions the code? (grep found nothing; check wording once).
- NOT VERIFIED: real aiohttp routes (`/api/decide`, `/api/forget`), the PC window dialog in Edge, GUI auto-open on `ask`, Kotlin fallback route with token, real-device first-time pairing. If the first CI/exe run fails, look at core.py `ws_handler`/`pair_request` first.
- NEXT: REMAINING WORK items 2-6 (driver installer + firewall rule; exe icon = APK icon; settings extras; device hardening; release polish).

### milestone 11 — one-click driver install + firewall (REMAINING WORK item 2) — in code + unit-tested with fakes; NOT run on real Windows/CI
- **Direct-link rule check:** compared the AST of every top-level function in `core.py` before/after: only `api_action`, `api_status`, `serve` changed (loopback-only API + startup thread). `handle`, `Held`, `ws_handler`, `mouse_move`, `init_pad` are IDENTICAL. No phone-side file changed (play.js/link.js/engine.js untouched). New code runs only on background daemon threads started by a button click, plus ONE `netsh` check at startup. Connection is still phone page `new WebSocket` -> PC `ws_handler`, nothing in between.
- `core.py`: `install_driver()` -> thread: download ViGEmBus **v1.22.0** (`ViGEmBus_1.22.0_x64_x86_arm64.exe`, 6,278,576 bytes) from the official GitHub release to %TEMP%, verify pinned SHA-256 `89220a78...fd014c6a` (hash of the file GitHub served on 2026-10-18; installer is NEVER run if it differs), run it elevated with `/passive /norestart` (one UAC prompt), poll `sc query ViGEmBus` (max 3 min), re-probe `import vgamepad`. Errors shown in the window (`SETUP["driver"]="error: ..."`), "Open the download page instead" link = fallback. `setup_firewall()` -> writes `%TEMP%\thunder_gamepad_firewall.cmd` and runs it elevated: two inbound rules "Thunder Gamepad TCP" (port 8766) / "Thunder Gamepad UDP" (8767), `profile=any remoteip=localsubnet` (LAN only). Rule presence checked once at start (`netsh ... show rule`, `FIREWALL`). API: `POST /api/driver` (installs), `/api/firewall`, `/api/driverpage` (opens releases page); `/api/status` has `setup{driver,fw}` + `firewall{checked,ok}`.
- PC window (`receiver/ui/index.html`): driver row shows Downloading / Installing (accept Windows prompt) / error text; new Firewall row with "Allow phone connections" button (hidden once rules exist).
- Tests: `tools/test_receiver.py` now 33 checks ALL PASS (+5: tampered download not run, good download -> elevated passive install + driver ok, declined UAC -> error, firewall script ports/LAN-only, firewall setup flow) using fakes for download/UAC/sc/netsh.
- NOT VERIFIED: real download + UAC + ViGEmBus `/passive` switch on Windows, `sc query`/`netsh` output on the user's PC, PyInstaller exe. Licence: ViGEmBus is BSD-3 (from memory, the page fetch did not show it) and we download it at run time, we do not bundle it. ViGEmBus is archived/EOL upstream but v1.22.0 is the last release and still works.
- NEXT: item 3 (exe icon = APK icon, `.ico` via PyInstaller `--icon`, window favicon), then 4 (settings: haptic strength, reset all data, import errors; stick sens already done), 5 (device hardening), 6 (release polish: signing keystore, version).

### milestone 12 — exe icon = APK icon (REMAINING WORK item 3, exe/window part) — DONE, build step not yet run on GitHub
- **Direct-link rule check:** `core.py` and ALL phone-side files untouched this milestone (only icon files, the PC window HTML, build.yml, tools). Hot path unchanged.
- `tools/make_icon.py` (reproducible): reads the APK's `ic_launcher_foreground.xml` paths + `pl_bg` colour (#0E1014 dark, NOT green) from `res/`, zooms the pad to ~80 % of a rounded square, renders with Chromium, writes `receiver/ui/icon.svg` and a 7-size `receiver/ThunderGamepad.ico` (16-256 px). The .ico is committed; CI does not run the script. Re-run it if the APK icon ever changes.
- `build.yml`: PyInstaller now has `--icon receiver/ThunderGamepad.ico` (exe file icon + taskbar). PC window: same icon as favicon (data URI, so no extra route) and as the rail logo.
- PC window fixes: tolerant of a missing `phones` list; step 3 text ("Tap this PC in the list. Click Allow here the first time."). `tools/shot_pcui.py` mock updated (phones, pending, firewall, new "asking" state): 0 JS errors; screenshots looked right (Allow dialog, driver + firewall buttons).
- NOT DONE from item 3: phone-side icon polish and splash/title polish (the APK launcher icon already is the same artwork). NOT VERIFIED: that PyInstaller on the runner accepts the .ico (Pillow is not needed because the file is already .ico).
- NEXT: item 4 (settings: haptic strength, reset all data, clearer import errors), 5 (real-device hardening), 6 (release polish: signing keystore, shared version, README screenshots, SmartScreen note).

### milestone 8 (this session) — first real run of the exe + fixes (user's PC + GitHub Actions repo `Thunder_Gamepad`)
- [x] CI exe job was hanging 14+ min: `pip install vgamepad` runs a setup.py that tries to install the ViGEmBus driver. FIX (in build.yml, user already pasted): install aiohttp/pynput/pyinstaller via pip, download the vgamepad 0.1.0 sdist from files.pythonhosted.org, copy its `vgamepad` folder into site-packages, check `ViGEmClient.dll` exists (do NOT `import vgamepad` on the runner: it raises VIGEM_ERROR_BUS_NOT_FOUND there). `timeout-minutes: 15`. Exe builds + user ran it: window works, phone connected, Xbox 360 pad OK.
- [x] GUI redesigned (clear, no clipped text): status card (green/amber/red dot + plain sentence), DETAILS card (PC address, Controller, Controller driver, Pairing code), driver-missing button, Start-with-Windows checkbox, technical log hidden behind a "Show technical log" link, Quit. Still tkinter, only py_compile-checked in sandbox (no tkinter); user saw the old layout, NOT yet the new one.
- [x] Rumble bug: vgamepad checks callback PARAMETER NAMES. Now `_rumble_cb_xbox(client,target,large_motor,small_motor,led_number,user_data)` and `_rumble_cb_ds4(..., lightbar_color, user_data)`, tried in order; log message "vibration forwarding unavailable" if both fail. Not yet verified with a game.
- [x] Crash fix (user report: new window opens, can't be moved, closes after ~5 s): suspected cause = `check_driver()` created a virtual pad twice at startup while the (now correctly registered) rumble notification still pointed at the discarded pad. Now `check_driver()` only does `import vgamepad` (creates no pad), and `init_pad` calls `pad.unregister_notification()` before dropping a pad. gui.py enables `faulthandler` + writes tracebacks to `~/ThunderGamepad_crash.log`. UNVERIFIED on the user's PC: if it still dies, ask for that log file.
- Rule from user: when giving a file change, ALWAYS hand over the complete replacement file (no "edit line X" instructions). Files the user pastes into the repo: `.github/workflows/build.yml`, `receiver/core.py`, `receiver/gui.py`.
- The APK is unchanged by milestone 8 (all receiver-side).

## Notes / gotchas
- Old action kinds handled by UI layer (not engine): `page`, `chat`, `ui`, `none`. Engine ignores them.
- Autoclick toggles: UI sends press then release as a toggle with the same src; engine cancels/restarts by src+"~a".
- Macro `src` strings contain "~" so `releaseAll(H, keepMacros=true)` can spare running macros (used by page switches in the old app).
- Timing now runs in JS timers on the phone (+network latency per event); no code needed on the laptop for macros.
- User's uploaded Genshin_layout.json is a good import test (macros with stick/LB wheel, autoclick button id `autoclk01`).
- Playing: `Engine.releaseAll(H,true)` runs on every re-render (page switch) so held inputs never stick; macros/autoclick survive via the "~" src rule.
- Old file line map for the editor: script line N = file line 967+N. Editor code lives roughly at 1653-1900+ (panel, actionEditor, macro editor).
- Editor test hook: `Editor._dsl.parseMacro/formatMacro` (exposed for tests). Layout JSON written by the editor is `{settings, layout:[normalized items]}`: still importable by the old v3 format.
- Android WebView: no prompt()/confirm()/alert() (no WebChromeClient) — always use `Dlg`.

## Chat update 1 (chatSeq, keyboard bridge)
- play.js: chat action accepts open/send/close actions; new `chatSeq` button field = strict button-order trigger for the chat popup (Genshin: Chat -> B -> X); openChat now also calls NativeBridge.showKeyboard.
- MainActivity.kt: new `showKeyboard()` JS bridge (WebView will not raise the IME for focus() outside a click) - fixes Minecraft chat popup not showing the keyboard.
- layouts/Genshin.json: Chat button has chatSeq. layouts/Minecraft.json unchanged.
- Needs an APK rebuild (GitHub workflow) for any of this to take effect.

## Chat update 2
- Chat bar now opens on press (not release). chatSeq.keep keeps the bar open after Send until Exit/A. receiver/core.py: on Windows, typed text is sent as virtual-key + scan-code events (VkKeyScanW), Unicode fallback for other chars.

## Chat update 3
- chat action: keep + reopen (Minecraft: Send = Enter, then T again; bar stays until Exit = Esc).

### milestone 7i — "make it as simple as v3" (user: look zone had zap-shutters every 0.5-1.2 s, v3 was silky; user said skip testing/ping, just simplify)
Root-cause hunt (code comparison only, nothing measured on device): PC `mouse_move` + look-zone maths were identical to v3; what differed was everything AROUND the look path. Removed all of it:
- `play.js` liveLook (mouse mode): back to v3 behaviour = ONE `Engine.mouseMove` per touch event, sent immediately (only the sub-pixel remainder is carried; `Math.round`). No requestAnimationFrame batching. (Aim-button accumulator at top of play.js untouched.)
- `play.js`: removed the per-frame `hitchLoop` meter + "phone stall" pill text (pill now: `NN ms · direct`).
- `link.js`: removed the "merge mmove while `bufferedAmount>4096`" logic (`send` = straight `ws.send`), removed `keepWifi` calls (no low-latency Wi-Fi lock; Kotlin still has it, JS just never asks).
- `receiver/boost.py`: now a no-op (no HIGH_PRIORITY, no power-throttle opt-out, no `timeBeginPeriod`) like v3. `core.py`: `_stall_monitor` no longer started (function left in file, unused).
- KEPT on purpose (function/looks): UI, editor, presets, chat, Edge app window (`gui.py`), admin relaunch for Genshin, rumble, discovery, OkHttp compat fallback (OFF by default).
- Tests: new `tools/smoke_look.py` (17 mmove messages for a 20-step drag, sums match sens 5.8, 0 errors) PASS; `smoke_link` updated (no-merge assertion) ALL PASS; `test_receiver` ALL PASS; smoke_home/presets PASS. smoke_play/smoke_editor still assume Genshin_layout.json (button "Jump") - run them with that file.
- STILL UNVERIFIED on a real phone/PC. If zaps persist after this build, next suspects in order: (1) WebView vs Chrome touch/frame-rate handling (try serving the UI from the PC over http and opening it in the phone browser as a diagnostic), (2) the admin-elevated exe + Edge window competing with the game (try `--background` / closing the window), (3) Wi-Fi.
- Delivery rule reminder: always hand over the FULL project zip (push-ready, builds APK + EXE) + progress.md.

### milestone 13 — MERGE of the two diverged branches + v3-speed connection (user: "merge them, make it as fast as v3, keep every feature")
- Two zips had diverged from the same project: (A) `progress.zip` (chat features: chatSeq/keep/reopen, keyboard show/hide bridge, layouts/ folder, my 7i v3 look-zone fix) and (B) `progress_1.zip` (milestones 9-12: stick sensitivity, no-code Allow pairing, one-click driver+firewall, exe icon). BASE = B; from A brought: play.js chat code, play.css `#chatbar.keep`, MainActivity `showKeyboard/hideKeyboard`, LAYOUT_SPEC chat recipes, `layouts/` + screenshots.
- Re-applied the v3 simplification on B (B still had it un-done): look zone sends ONE `mmove` per touch event immediately (sub-pixel remainder carried, no rAF batching); link.js sends straight through (no merge, no `keepWifi` calls). B had already dropped boost.py + stall monitor from the receiver.
- NEW (user: shutter gone but camera rotation fps lower than v3's 144): theory = a WebView does not ask Android for a high refresh rate (Chrome does) and with no per-frame callback the page idles, so touch events arrive at a lower rate. Fix without removing anything: (1) `MainActivity.requestMaxRefresh()` (onCreate + onResume) sets `preferredDisplayModeId`/`preferredRefreshRate` to the highest mode at the current resolution; (2) `play.js keepFrames()` = one EMPTY requestAnimationFrame loop while playing (no work per frame, no measuring). UNVERIFIED on device. If fps is still below v3: next step = serve the phone UI from the PC over http like v3 and load that URL in the WebView/phone browser (biggest remaining difference), or count `pointermove` per second on the phone to see the event rate.
- Re-added (was only described in the old log, absent from BOTH zips): typed text on Windows is sent as real key presses (VkKeyScanW -> virtual key + scan code, Shift/Ctrl/Alt as needed, Enter/Tab, fallback to pynput per character and on any error) = `core.py type_text`. Not run on real Windows.
- Kept untouched (features): pairing/Allow prompt, driver+firewall installer, icon, stick sensitivity, chat, presets, editor, Edge PC window, admin relaunch, optional Compatibility (OkHttp) mode (OFF by default, not on the hot path).
- Tests (all PASS): smoke_link (no-merge assertion), smoke_look (17 mmove for a 20-step drag), smoke_home, smoke_presets, smoke_import, test_receiver. smoke_play/smoke_editor/smoke_sens need a layout with the Genshin button names (old Genshin_layout.json).
- Kotlin still never compiled locally: first CI run may show a compile error in `requestMaxRefresh` (uses `display` on API 30+, `windowManager.defaultDisplay` below).
- Delivery rule reminder: ALWAYS hand over the full push-ready project zip (builds APK + EXE) + progress.md.


### milestone 14 — more phone-side speed, architecture unchanged (user: phone stays the main handler, PC = pure receiver; do NOT serve the UI from the PC)
- `play.js` liveLook: listens to `pointerrawupdate` (every touch-panel sample as it arrives, not one per screen frame) when `"onpointerrawupdate" in window`, else `pointermove`; same handler/logic otherwise.
- `MainActivity.kt`: `setOnTouchListener` -> `requestUnbufferedDispatch(ev)` on ACTION_DOWN (no per-frame batching of MotionEvents; returns false so the WebView still handles the touch), `setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT,false)`; manifest `android:hardwareAccelerated="true"`. (imports MotionEvent.) Kotlin not compiled locally.
- Tests re-run: smoke_look/link/home/presets PASS.
- IDEAS NOT DONE (in order of power if still below v3): (1) handle look-zone touches natively in Kotlin (dispatchTouchEvent reads MotionEvent history at full panel rate) and send over a native socket - bypasses the WebView for the hottest path but needs a rect list from JS + care with multi-touch; (2) UDP for mouse moves (TCP head-of-line blocking on bad Wi-Fi) - needs Kotlin socket + receiver UDP listener; (3) ADPF PerformanceHintManager / sustained-performance mode to avoid thermal throttling.

### milestone 16 — stick limiter: Walk + Cinema buttons (user request)
- New action kind `limit` {stick:"left|right|both", radius:0.05-1}. `play.js`: `LIMIT` map (button id -> {side,r}), `capFor(side)` = smallest active radius, `setLimit` (called from `sendAct`, so toggle/hold both work), live sticks re-send their output the moment a cap changes (second finger on the button while the thumb is already on the stick), `capVec` for look zones in lstick/rstick mode. In `liveStick` the cap is applied LAST (`m = min(m*sens*max, cap)`), after global/per-stick sensitivity, so it is an absolute output limit. Limit buttons are toggles by default and get the `.active` highlight (restored after page switches/re-renders). `release all` / app hidden clear all limits; opening chat does NOT (`release(false,true)`).
- `editor.js`: Action dropdown has "limit" (Stick to limit: left/right/both + Radius number); toggle checkbox defaults ON for limit like autoclick. `engine.js`: `limit` added to KINDS only (engine itself ignores it; play.js intercepts). Hot path (look zone, link.js, receiver) untouched.
- `layouts/Genshin.json` = the user's current uploaded Genshin.json (33 items; the older repo copy had an extra gear button) + Walk (id walklim01, x20.5 y93) + Cinema (id cinelim01, x43 y93.5).
- Tests: smoke_limit 15/15, smoke_limit_editor PASS, smoke_sens/look/link/presets/import/home + test_receiver pass. NOT tested on a real phone/game; the best radius for walking in Genshin (default 0.4) may need tuning.

### milestone 15 — docs sync after the user confirmed the speed fix ("finally it worked like a charm")
- User confirmed on device: look zone smooth like v3 (milestones 7i + 13 + 14). Added the HOT-PATH RULES section at the top so it never regresses.
- Rebuilt `progress.md` (top = current state, rules, map, tests, workflow, remaining work; history below). RESTORED milestones 9-12 and the chat-update notes that the milestone-13 merge had accidentally dropped (root `progress.md` and `docs/progress.md` had diverged; both are now identical).
- `docs/PROTOCOL.md` updated (transport + per-event `mmove` contract, typed text, ping cadence, fallback). `docs/LAYOUT_SPEC.md` rewritten clean (old copy had escaped backslashes, wrong look modes `left/right` instead of `lstick/rstick`, no chat recipes, no stick `sens`). `README.md` rewritten for the current flow. The generic `Read_this_before_starting.txt` was made project-independent (user request: one common file for all projects); the project-specific rules in it were moved into this file (top sections) and it is no longer inside the project zip.
- No code changed in this milestone.
