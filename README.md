# Thunder Gamepad

Turn your Android phone into a fully customisable gamepad / keyboard / mouse for your Windows PC.
**The phone does everything** (layouts, macros, editor, touch handling); the PC only runs the small **ThunderGamepad.exe** receiver that turns what the phone sends into a virtual Xbox 360 / PlayStation controller, keyboard and mouse.

## Get it
Push this repo to GitHub -> **Actions -> Build Thunder Gamepad** -> download
- `ThunderGamepad-apk` (install on the phone, over the old version if you have one)
- `ThunderGamepad-exe` (double-click on the PC)

Tags `v*` attach both files to a GitHub Release.

## Use it
1. **PC:** double-click `ThunderGamepad.exe`. If the window says the controller driver is missing, press **Install controller driver** (needs the Windows admin prompt, one time). Press **Allow phone connections** once so Windows does not ask about the firewall.
2. **Phone (same Wi-Fi):** open Thunder Gamepad -> **Connect** -> **Find automatically** -> tap your PC.
3. **First time only:** the PC window asks **"Allow this phone?"** -> press **Allow**. No code to type; the phone is remembered (see *Paired phones* in the PC window, where you can also remove it).
4. Pick a layout under **Layouts** -> **Play**. Tap the small pill at the top while playing for the menu (pages, reconnect, release all, edit, exit).

(Windows SmartScreen may warn about an unsigned exe: *More info -> Run anyway*.)

## Features
- Layout editor on the phone: buttons, sticks (analog / WASD / d-pad / mouse), look zones, sliders, pages, macros, auto-clicker, chat bar, turbo, toggle, long/double press.
- Xbox 360 or PlayStation virtual controller chosen from the phone; game rumble comes back as phone vibration.
- Global + per-stick sensitivity, haptics, keep-awake, immersive mode, auto-reconnect.
- Import / export layouts (old v3 layout files import as they are). Ready-made Xbox and PlayStation layouts included; `layouts/` has Minecraft and Genshin examples.
- Optional "Compatibility mode" (Settings) for networks where the direct connection is blocked; it is OFF by default.

## Speed (important if you change code)
The look zone is as smooth as the original v3 because the connection is kept as simple as possible: one mouse message per touch sample, sent straight away; the receiver applies each one immediately; the phone asks for the fastest refresh rate. **Do not add batching, merging, throttling, priority tweaks or per-frame work** - the rules are listed at the top of `progress.md` ("HOT-PATH RULES").

## Development
- Dev receiver: `python receiver/thunder_receiver.py` (console; `--allow-all` pairs every phone). Headless tests are in `tools/` (see `progress.md`).
- Protocol: `docs/PROTOCOL.md`. Layout format for AI-made layouts: `docs/LAYOUT_SPEC.md`. Project log / resume notes: `progress.md`.
- Every change delivered by Claude comes as the **full, up-to-date `progress.zip`** (+ `progress.md`). Unzip it over the project folder, commit, push.

## Making layouts with an AI
Give `docs/LAYOUT_SPEC.md` (only that file) to Claude/ChatGPT together with the game name; import the JSON it returns via **Layouts -> Import**.


## Ready-made layouts
Every `.json` file in the `layouts/` folder is packed into the APK and appears in the app's Layouts list automatically (first start, or when a new file is added in an update). Layouts you delete stay deleted; layouts you edited are never overwritten by an update.
