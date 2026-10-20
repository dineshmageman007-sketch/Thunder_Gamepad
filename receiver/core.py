"""
Thunder Gamepad receiver CORE (PC side, no GUI). The phone runs the app + all logic; this module only
turns the phone's low-level events into real input on this PC.

  - Virtual controller (Xbox 360 or DualShock 4) -- type is chosen from the phone
  - Keyboard, mouse (SendInput on Windows so locked-cursor games work), scroll, typed text
  - Rumble from games is sent back to the phone

Used by gui.py (the double-click Thunder Gamepad window / .exe) and thunder_receiver.py (console, for dev/tests).
"""
import secrets, asyncio, ctypes, json, os, random, re, socket, sys, threading, time
from collections import deque

from aiohttp import web, WSMsgType
from pynput.keyboard import Controller as Keyboard, Key, KeyCode
from pynput.mouse import Controller as Mouse, Button

APP_NAME = "Thunder Gamepad"


class Cfg:
    port = 8766
    code = ""        # DEV ONLY (console --code): a phone sending this code is accepted without the Allow prompt
    allow_all = False  # DEV ONLY (console --allow-all): pair every unknown phone automatically
    pad = ""         # force a controller type at start


ARGS = Cfg()
CONSOLE = False      # thunder_receiver.py sets True -> log() also prints
LOGS = deque(maxlen=200)
HOOK = lambda kind, info=None: None   # gui.py replaces: kind in {"log","phone","gone","pad","ready"}


def log(*a):
    msg = " ".join(str(x) for x in a)
    LOGS.append(msg)
    if CONSOLE:
        print(msg)
    try:
        HOOK("log", msg)
    except Exception:
        pass


IS_WIN = os.name == "nt"
DISCOVERY_PORT = 8767
kb, ms = Keyboard(), Mouse()
if IS_WIN:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


DEV_PATH = os.path.join(os.path.expanduser("~"), ".thunder_gamepad_devices.json")


def load_devices():
    """{"pcid": random id of THIS PC (phones remember PCs by it, so a changed IP is fine), "phones": {token: {name, ip, added}}}"""
    d = {}
    try:
        with open(DEV_PATH, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        pass
    if not isinstance(d, dict):
        d = {}
    if not isinstance(d.get("phones"), dict):
        d["phones"] = {}
    if not d.get("pcid"):
        d["pcid"] = secrets.token_hex(6)
        save_devices(d)
    return d


def save_devices(d=None):
    try:
        with open(DEV_PATH, "w", encoding="utf-8") as f:
            json.dump(d if d is not None else DEV, f, indent=1)
    except OSError as e:
        log("could not save paired phones:", e)


DEV = load_devices()
PENDING = None      # {"name","ip","fut","ts"} while a phone waits for Allow/Block on the PC
LAST_UI_POLL = 0.0  # last time the PC window asked for status (gui.py opens the window if nobody is looking)
CUR_TOKEN = ""
ASK_SECS = 30
LOOP = None
PHONE = {"name": ""}
CUR = None  # the connected phone's websocket (one phone at a time)
FAILS = {}  # ip -> [declined/timed-out requests, locked-until timestamp]  (stops a phone spamming the Allow prompt)
MAX_FAILS, LOCK_SECS = 3, 60

# ---------------- virtual controller ----------------
PAD_ALIAS = {
    "SELECT": "BACK", "VIEW": "BACK", "SHARE": "BACK", "MENU": "START", "OPTIONS": "START",
    "XBOX": "GUIDE", "PS": "GUIDE", "HOME": "GUIDE", "L1": "LB", "R1": "RB", "L2": "LT", "R2": "RT",
    "L3": "LS", "R3": "RS", "CROSS": "A", "CIRCLE": "B", "SQUARE": "X", "TRIANGLE": "Y",
}
pad = vg = None
DS4 = False
PAD_BTN, PAD_SPECIAL = {}, {}
PAD_KIND, PAD_ERROR = "none", ""
_dpad = set()


def clamp(v, lo=-1.0, hi=1.0):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return 0.0


def init_pad(kind):
    """(Re)create the virtual controller: xbox | ds4 | none."""
    global pad, vg, DS4, PAD_BTN, PAD_SPECIAL, PAD_KIND, PAD_ERROR
    if pad is not None:
        try:
            pad.unregister_notification()   # never leave a native callback pointing at a dead pad
        except Exception:
            pass
        try:
            pad.reset(); pad.update()
        except Exception:
            pass
    pad, PAD_BTN, PAD_SPECIAL, PAD_ERROR, PAD_KIND = None, {}, {}, "", "none"
    _dpad.clear()
    DS4 = kind == "ds4"
    if kind not in ("xbox", "ds4"):
        return
    try:
        import vgamepad as vg
        if DS4:
            pad = vg.VDS4Gamepad()
            B = vg.DS4_BUTTONS
            PAD_BTN = {"A": B.DS4_BUTTON_CROSS, "B": B.DS4_BUTTON_CIRCLE, "X": B.DS4_BUTTON_SQUARE,
                       "Y": B.DS4_BUTTON_TRIANGLE, "LB": B.DS4_BUTTON_SHOULDER_LEFT,
                       "RB": B.DS4_BUTTON_SHOULDER_RIGHT, "START": B.DS4_BUTTON_OPTIONS,
                       "BACK": B.DS4_BUTTON_SHARE, "LS": B.DS4_BUTTON_THUMB_LEFT, "RS": B.DS4_BUTTON_THUMB_RIGHT}
            S = vg.DS4_SPECIAL_BUTTONS
            PAD_SPECIAL = {"GUIDE": S.DS4_SPECIAL_BUTTON_PS, "TOUCHPAD": S.DS4_SPECIAL_BUTTON_TOUCHPAD}
        else:
            pad = vg.VX360Gamepad()
            B = vg.XUSB_BUTTON
            PAD_BTN = {"A": B.XUSB_GAMEPAD_A, "B": B.XUSB_GAMEPAD_B, "X": B.XUSB_GAMEPAD_X, "Y": B.XUSB_GAMEPAD_Y,
                       "LB": B.XUSB_GAMEPAD_LEFT_SHOULDER, "RB": B.XUSB_GAMEPAD_RIGHT_SHOULDER,
                       "START": B.XUSB_GAMEPAD_START, "BACK": B.XUSB_GAMEPAD_BACK,
                       "LS": B.XUSB_GAMEPAD_LEFT_THUMB, "RS": B.XUSB_GAMEPAD_RIGHT_THUMB,
                       "UP": B.XUSB_GAMEPAD_DPAD_UP, "DOWN": B.XUSB_GAMEPAD_DPAD_DOWN,
                       "LEFT": B.XUSB_GAMEPAD_DPAD_LEFT, "RIGHT": B.XUSB_GAMEPAD_DPAD_RIGHT,
                       "GUIDE": B.XUSB_GAMEPAD_GUIDE}
        PAD_KIND = kind
        for cb in ((_rumble_cb_ds4, _rumble_cb_xbox) if DS4 else (_rumble_cb_xbox, _rumble_cb_ds4)):
            try:
                pad.register_notification(callback_function=cb)
                break
            except Exception as e:
                last = e
        else:
            log("vibration forwarding unavailable:", last)
    except Exception as e:
        pad, PAD_BTN, PAD_SPECIAL, PAD_KIND, PAD_ERROR = None, {}, {}, "none", str(e)
        log(f"[!] Virtual controller unavailable ({e}). Keyboard/mouse still work.")


def pad_name(v):
    n = str(v).strip().upper()
    return PAD_ALIAS.get(n, n)


def _ds4_dpad_dir():
    D = vg.DS4_DPAD_DIRECTIONS
    u, d, l, r = ("UP" in _dpad, "DOWN" in _dpad, "LEFT" in _dpad, "RIGHT" in _dpad)
    table = {(1, 0, 0, 0): D.DS4_BUTTON_DPAD_NORTH, (1, 0, 0, 1): D.DS4_BUTTON_DPAD_NORTHEAST,
             (0, 0, 0, 1): D.DS4_BUTTON_DPAD_EAST, (0, 1, 0, 1): D.DS4_BUTTON_DPAD_SOUTHEAST,
             (0, 1, 0, 0): D.DS4_BUTTON_DPAD_SOUTH, (0, 1, 1, 0): D.DS4_BUTTON_DPAD_SOUTHWEST,
             (0, 0, 1, 0): D.DS4_BUTTON_DPAD_WEST, (1, 0, 1, 0): D.DS4_BUTTON_DPAD_NORTHWEST}
    return table.get((int(u), int(d), int(l), int(r)), D.DS4_BUTTON_DPAD_NONE)


def pad_set(name, down):
    if not pad:
        return
    if name == "LT":
        pad.left_trigger_float(value_float=1.0 if down else 0.0)
    elif name == "RT":
        pad.right_trigger_float(value_float=1.0 if down else 0.0)
    elif DS4 and name in ("UP", "DOWN", "LEFT", "RIGHT"):
        (_dpad.add if down else _dpad.discard)(name)
        pad.directional_pad(direction=_ds4_dpad_dir())
    elif DS4 and name in PAD_SPECIAL:
        (pad.press_special_button if down else pad.release_special_button)(special_button=PAD_SPECIAL[name])
    elif name in PAD_BTN:
        (pad.press_button if down else pad.release_button)(button=PAD_BTN[name])
    else:
        return
    pad.update()


def pad_trigger(side, v):
    if not pad:
        return
    v = clamp(v, 0.0, 1.0)
    (pad.left_trigger_float if str(side).upper().startswith("L") else pad.right_trigger_float)(value_float=v)
    pad.update()


def pad_stick(side, x, y):
    if not pad:
        return
    x, y = clamp(x), clamp(y)
    if str(side).lower().startswith("r"):
        pad.right_joystick_float(x_value_float=x, y_value_float=y)
    else:
        pad.left_joystick_float(x_value_float=x, y_value_float=y)
    pad.update()


def pad_axes0():
    if pad:
        pad.left_trigger_float(value_float=0.0); pad.right_trigger_float(value_float=0.0)
        pad.left_joystick_float(x_value_float=0.0, y_value_float=0.0)
        pad.right_joystick_float(x_value_float=0.0, y_value_float=0.0)
        pad.update()


# ---------------- keyboard ----------------
_NAMED = {k.name: k for k in Key}
KEY_ALIASES = {
    "escape": "esc", "return": "enter", "caps": "caps_lock", "capslock": "caps_lock", "spacebar": "space",
    "pageup": "page_up", "pgup": "page_up", "pagedown": "page_down", "pgdn": "page_down", "del": "delete",
    "ins": "insert", "control": "ctrl", "option": "alt", "win": "cmd", "windows": "cmd", "super": "cmd",
    "meta": "cmd", "lwin": "cmd_l", "rwin": "cmd_r", "printscreen": "print_screen", "prtsc": "print_screen",
    "scrolllock": "scroll_lock", "numlock": "num_lock", "lshift": "shift_l", "rshift": "shift_r",
    "lctrl": "ctrl_l", "rctrl": "ctrl_r", "lalt": "alt_l", "ralt": "alt_gr", "volumeup": "media_volume_up",
    "volumedown": "media_volume_down", "mute": "media_volume_mute", "playpause": "media_play_pause",
    "nexttrack": "media_next", "prevtrack": "media_previous",
}
PUNCT = {"plus": "+", "minus": "-", "equals": "=", "comma": ",", "period": ".", "dot": ".", "slash": "/",
         "backslash": "\\", "semicolon": ";", "quote": "'", "apostrophe": "'", "backtick": "`", "grave": "`",
         "lbracket": "[", "rbracket": "]", "hash": "#"}
VK = {"num0": 0x60, "num1": 0x61, "num2": 0x62, "num3": 0x63, "num4": 0x64, "num5": 0x65, "num6": 0x66,
      "num7": 0x67, "num8": 0x68, "num9": 0x69, "nummul": 0x6A, "numadd": 0x6B, "numsub": 0x6D,
      "numdecimal": 0x6E, "numdiv": 0x6F}


def parse_key(name):
    n = str(name).strip()
    if not n:
        return None
    low = n.lower()
    if low.startswith("vk:"):
        try:
            return KeyCode.from_vk(int(low[3:], 0))
        except ValueError:
            return None
    low = KEY_ALIASES.get(low, low)
    if low in _NAMED:
        return _NAMED[low]
    if low in VK:
        return KeyCode.from_vk(VK[low])
    m = re.fullmatch(r"f(\d{1,2})", low)
    if m and 1 <= int(m.group(1)) <= 24:
        return KeyCode.from_vk(0x70 + int(m.group(1)) - 1)
    if low in PUNCT:
        return PUNCT[low]
    if len(n) == 1:
        return n.lower() if n.isalpha() else n
    return None


def kb_press(k):
    try:
        kb.press(k)
    except Exception as e:
        log("key press error:", e)


def kb_release(k):
    try:
        kb.release(k)
    except Exception:
        pass


# ---------------- mouse ----------------
MB_FLAGS = {"left": (0x0002, 0x0004, 0), "right": (0x0008, 0x0010, 0), "middle": (0x0020, 0x0040, 0),
            "x1": (0x0080, 0x0100, 1), "x2": (0x0080, 0x0100, 2)}
MB_PYNPUT = {"left": Button.left, "right": Button.right, "middle": Button.middle,
             "x1": getattr(Button, "x1", getattr(Button, "button8", None)),
             "x2": getattr(Button, "x2", getattr(Button, "button9", None))}

if IS_WIN:
    from ctypes import wintypes

    class _MI(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

    class _IN(ctypes.Structure):
        class _U(ctypes.Union):
            _fields_ = [("mi", _MI)]
        _anonymous_ = ("u",)
        _fields_ = [("type", wintypes.DWORD), ("u", _U)]

    def _send_mouse(flags, dx=0, dy=0, data=0):
        inp = _IN()
        inp.type = 0
        inp.mi = _MI(dx, dy, data & 0xFFFFFFFF, flags, 0, 0)
        ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))


def mouse_move(dx, dy):
    dx, dy = max(-3000, min(3000, int(dx))), max(-3000, min(3000, int(dy)))
    if not (dx or dy):
        return
    if IS_WIN:
        _send_mouse(0x0001, dx, dy)
    else:
        ms.move(dx, dy)


def mouse_to(fx, fy):
    fx, fy = clamp(fx, 0, 1), clamp(fy, 0, 1)
    if IS_WIN:
        u = ctypes.windll.user32
        u.SetCursorPos(int(fx * (u.GetSystemMetrics(0) - 1)), int(fy * (u.GetSystemMetrics(1) - 1)))
    else:
        try:
            import tkinter
            r = tkinter.Tk(); w, h = r.winfo_screenwidth(), r.winfo_screenheight(); r.destroy()
            ms.position = (int(fx * (w - 1)), int(fy * (h - 1)))
        except Exception as e:
            log("mouse_to unavailable:", e)


def mouse_button(name, down):
    if IS_WIN and name in MB_FLAGS:
        f = MB_FLAGS[name]
        _send_mouse(f[0] if down else f[1], 0, 0, f[2])
    elif MB_PYNPUT.get(name) is not None:
        (ms.press if down else ms.release)(MB_PYNPUT[name])


def mouse_scroll(v=0, h=0):
    v, h = int(v), int(h)
    if IS_WIN:
        if v:
            _send_mouse(0x0800, 0, 0, 120 * v)
        if h:
            _send_mouse(0x1000, 0, 0, 120 * h)
    else:
        ms.scroll(h, v)


# ---------------- per-connection bookkeeping + message handling ----------------
class Held:
    """What this phone currently holds down, so a dropped connection never leaves keys stuck."""
    def __init__(self):
        self.keys, self.mouse, self.pad = {}, set(), set()

    def release(self, zero_axes=True):
        for k in list(self.keys.values()):
            kb_release(k)
        for b in list(self.mouse):
            mouse_button(b, False)
        for n in list(self.pad):
            pad_set(n, False)
        self.keys.clear(); self.mouse.clear(); self.pad.clear()
        if zero_axes:
            pad_axes0()


def panic(H=None):
    """H given (phone sent "reset"): release ONLY what that phone is really holding. Blind key-ups / mouse-ups
    (esp. X1/X2 = browser back/forward, Win, Alt) make other apps react, so nothing is sent for idle inputs.
    H None (receiver quitting): blanket release of everything."""
    if H is None:
        for name in ("ctrl", "ctrl_l", "ctrl_r", "shift", "shift_l", "shift_r", "alt", "alt_l", "alt_r", "cmd"):
            k = getattr(Key, name, None)
            if k is not None:
                kb_release(k)
        for b in MB_FLAGS:
            try:
                mouse_button(b, False)
            except Exception:
                pass
    else:
        for k in list(H.keys.values()):
            kb_release(k)
        for b in list(H.mouse):
            try:
                mouse_button(b, False)
            except Exception:
                pass
    if pad:
        try:
            pad.reset(); pad.update()
        except Exception:
            pass
    _dpad.clear()
    if H:
        H.keys.clear(); H.mouse.clear(); H.pad.clear()


if IS_WIN:
    class _KI(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

    class _INK(ctypes.Structure):
        class _U(ctypes.Union):
            _fields_ = [("ki", _KI), ("mi", _MI)]
        _anonymous_ = ("u",)
        _fields_ = [("type", wintypes.DWORD), ("u", _U)]

    def _key_scan(vk, down):
        scan = ctypes.windll.user32.MapVirtualKeyW(vk, 0)
        inp = _INK(); inp.type = 1
        inp.ki = _KI(vk, scan, 0x0008 | (0 if down else 0x0002), 0, 0)   # KEYEVENTF_SCANCODE (+ KEYUP)
        ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))


def type_text(s):
    """Windows: each character as a real key press (VkKeyScanW -> virtual key + scan code, with Shift/Ctrl/Alt as needed).
    Characters the keyboard layout cannot produce fall back to pynput. Other systems: pynput."""
    if not IS_WIN:
        kb.type(s)
        return
    u = ctypes.windll.user32
    u.VkKeyScanW.argtypes = [wintypes.WCHAR]; u.VkKeyScanW.restype = ctypes.c_short
    for ch in s:
        if ch in "\r\n":
            _key_scan(0x0D, True); _key_scan(0x0D, False); continue
        if ch == "\t":
            _key_scan(0x09, True); _key_scan(0x09, False); continue
        r = u.VkKeyScanW(ch)
        if r == -1:
            kb.type(ch); continue
        vk, sh = r & 0xFF, (r >> 8) & 0xFF
        mods = [m for bit, m in ((1, 0x10), (2, 0x11), (4, 0x12)) if sh & bit]
        for m in mods:
            _key_scan(m, True)
        _key_scan(vk, True); _key_scan(vk, False)
        for m in reversed(mods):
            _key_scan(m, False)


def handle(d, H):
    t, down = d.get("t"), bool(d.get("d"))
    if t == "pad":
        n = pad_name(d.get("n", ""))
        (H.pad.add if down else H.pad.discard)(n)
        pad_set(n, down)
    elif t == "trig":
        pad_trigger(d.get("side", "R"), d.get("v", 0))
    elif t == "stick":
        pad_stick(d.get("side", "l"), d.get("x", 0), d.get("y", 0))
    elif t == "key":
        name = str(d.get("k", ""))
        k = parse_key(name)
        if k is None:
            return
        if down:
            H.keys[name] = k
            kb_press(k)
        else:
            kb_release(H.keys.pop(name, k))
    elif t == "mbtn":
        n = str(d.get("n", "")).lower()
        (H.mouse.add if down else H.mouse.discard)(n)
        mouse_button(n, down)
    elif t == "mmove":
        mouse_move(d.get("dx", 0), d.get("dy", 0))
    elif t == "mto":
        mouse_to(d.get("x", 0.5), d.get("y", 0.5))
    elif t == "scroll":
        mouse_scroll(v=d.get("v", 0), h=d.get("h", 0))
    elif t == "type":   # diff-based typing: N backspaces, then new text
        for _ in range(max(0, min(200, int(d.get("back", 0))))):
            kb_press(Key.backspace); kb_release(Key.backspace)
        s = str(d.get("s", ""))[:500]
        if s:
            try:
                type_text(s)
            except Exception as e:
                log("type error:", e)
                try:
                    kb.type(s)
                except Exception:
                    pass
    elif t == "axes0":
        pad_axes0()
    elif t == "reset":
        panic(H)


def welcome():
    return {"t": "welcome", "pad": PAD_KIND, "padError": PAD_ERROR, "host": socket.gethostname(), "pcid": DEV["pcid"],
            "os": "windows" if IS_WIN else sys.platform}


def _send_rumble(large, small):
    ws = CUR
    if LOOP and ws is not None and not ws.closed:
        LOOP.call_soon_threadsafe(lambda: asyncio.ensure_future(ws.send_json({"t": "rumble", "l": large, "s": small})))


# vgamepad inspects the parameter NAMES of the callback, so these must match exactly.
def _rumble_cb_xbox(client, target, large_motor, small_motor, led_number, user_data):
    _send_rumble(large_motor, small_motor)


def _rumble_cb_ds4(client, target, large_motor, small_motor, lightbar_color, user_data):
    _send_rumble(large_motor, small_motor)


async def pair_request(ws, ip, name, rec):
    """Unknown phone: ask the person at the PC (Allow / Block, 30 s). Returns (new_token, "") or (None, reason)."""
    global PENDING
    if PENDING is not None:
        return None, "busy"
    if ARGS.allow_all:
        return add_phone(name, ip), ""
    fut = asyncio.get_running_loop().create_future()
    PENDING = {"name": name, "ip": ip, "fut": fut, "ts": time.time()}
    log(f"[?] {name} ({ip}) wants to connect - waiting for Allow/Block on the PC")
    HOOK("ask", {"name": name, "ip": ip})
    try:
        await ws.send_json({"t": "pending", "secs": ASK_SECS})
        allow = await asyncio.wait_for(fut, ASK_SECS)
        why = "blocked"
    except asyncio.TimeoutError:
        allow, why = False, "timeout"
    except Exception:
        allow, why = False, "gone"
    finally:
        PENDING = None
    if allow and not ws.closed:
        return add_phone(name, ip), ""
    rec[0] += 1
    if rec[0] >= MAX_FAILS:
        rec[0], rec[1] = 0, time.time() + LOCK_SECS
        log(f"[!] {ip}: declined too often, ignored for {LOCK_SECS}s")
    return None, why


def add_phone(name, ip):
    tok = secrets.token_hex(16)
    DEV["phones"][tok] = {"name": name, "ip": ip, "added": int(time.time())}
    save_devices()
    log(f"[+] paired: {name}")
    return tok


def decide(allow):
    """Called by the PC window (POST /api/decide)."""
    p = PENDING
    if p and not p["fut"].done():
        p["fut"].set_result(bool(allow))
        return True
    return False


def forget(pid):
    """Remove a paired phone (pid = first 8 chars of its token, or "all"). Disconnects it if it is the connected one."""
    global CUR
    gone = [t for t in DEV["phones"] if pid == "all" or t[:8] == pid]
    for t in gone:
        DEV["phones"].pop(t, None)
        if t == CUR_TOKEN and CUR is not None and not CUR.closed:
            asyncio.ensure_future(CUR.close())
    if gone:
        save_devices()
    return len(gone)


def phones_list():
    return [{"id": t[:8], "name": v.get("name", "?"), "added": v.get("added", 0), "last": v.get("last", 0)} for t, v in DEV["phones"].items()]


async def ws_handler(request):
    global CUR, CUR_TOKEN
    ws = web.WebSocketResponse(heartbeat=15)
    await ws.prepare(request)
    H, authed = Held(), False
    ip = request.remote or "?"
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                d = json.loads(msg.data)
            except ValueError:
                continue
            t = d.get("t")
            if not authed:
                rec = FAILS.setdefault(ip, [0, 0.0])
                if rec[1] > time.time():            # too many declined requests from this phone
                    await ws.send_json({"t": "denied", "reason": "locked", "locked": int(rec[1] - time.time())})
                    await ws.close()
                    break
                if t != "hello":
                    continue
                tok = str(d.get("token") or d.get("code") or "")
                name = str(d.get("name", "?"))[:40]
                if tok and tok in DEV["phones"]:
                    pass                                              # remembered phone: connect silently
                elif ARGS.code and tok == ARGS.code:
                    tok = ""                                          # dev shortcut, nothing remembered
                else:
                    new, why = await pair_request(ws, ip, name, rec)
                    if not new:
                        await ws.send_json({"t": "denied", "reason": why, "locked": int(max(0, rec[1] - time.time()))})
                        await ws.close()
                        break
                    tok = new
                    await ws.send_json({"t": "paired", "token": tok})
                FAILS.pop(ip, None)
                authed = True
                if CUR is not None and CUR is not ws and not CUR.closed:
                    await CUR.close()
                CUR, CUR_TOKEN = ws, tok
                if tok:
                    DEV["phones"][tok]["name"] = name; DEV["phones"][tok]["last"] = int(time.time()); save_devices()
                kind = d.get("pad")
                if kind in ("xbox", "ds4", "none") and kind != PAD_KIND:
                    init_pad(kind)
                PHONE["name"] = name; log(f"[+] phone connected: {name}  controller: {PAD_KIND}"); HOOK("phone", dict(PHONE))
                await ws.send_json(welcome())
                continue
            if t == "ping":
                await ws.send_json({"t": "pong", "ts": d.get("ts")})
            elif t == "setpad":
                init_pad(d.get("kind", "none"))
                HOOK("pad", PAD_KIND)
                await ws.send_json(welcome())
            else:
                try:
                    handle(d, H)
                except Exception as e:
                    log("handler error:", e)
    finally:
        H.release(zero_axes=(CUR is ws or CUR is None))
        if CUR is ws:
            CUR = None
            PHONE["name"] = ""; log("[-] phone disconnected"); HOOK("gone")
    return ws


# ---------------- LAN discovery (UDP) ----------------
def discovery_thread():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("", DISCOVERY_PORT))
    except OSError as e:
        log("discovery disabled:", e)
        return
    while True:
        try:
            data, addr = s.recvfrom(256)
            if data.strip() == b"PADLINK?":  # magic kept for protocol compatibility
                card = {"t": "padlink", "name": socket.gethostname(), "port": ARGS.port, "pad": PAD_KIND, "pcid": DEV["pcid"]}
                s.sendto(json.dumps(card).encode(), addr)
        except OSError:
            pass


def lan_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    try:
        t = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        t.connect(("8.8.8.8", 80)); ips.add(t.getsockname()[0]); t.close()
    except OSError:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


def check_driver():
    """Is the ViGEmBus driver installed? Importing vgamepad connects to it (fails with BUS_NOT_FOUND if missing).
    Deliberately creates NO controller. Returns (ok, error)."""
    try:
        import vgamepad  # noqa: F401
        return True, ""
    except Exception as e:
        return False, str(e)


def status():
    return {"phone": PHONE["name"], "pad": PAD_KIND, "padError": PAD_ERROR, "port": ARGS.port,
            "ips": lan_ips(), "pcid": DEV["pcid"], "phones": phones_list()}


_STOP = None


APP_VERSION = "0.1.0"
QUIT = threading.Event()
DRIVER = {"checked": False, "ok": False, "err": ""}
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VIGEM_URL = "https://github.com/nefarius/ViGEmBus/releases/latest"
_ips_cache = [0.0, []]


def _res(name):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "ui", name)


def start_cmd():
    """Command line used for Start-with-Windows (quiet background mode)."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --background'
    return f'"{sys.executable}" "{os.path.abspath(os.path.join(os.path.dirname(__file__), "gui.py"))}" --background'


def autostart_get():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
            return True
    except Exception:
        return False


def autostart_set(on):
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if on:
                winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, start_cmd())
            else:
                winreg.DeleteValue(k, APP_NAME)
    except Exception as e:
        log("autostart:", e)


def _probe_driver():
    ok, err = check_driver()
    DRIVER.update(checked=True, ok=ok, err=err)


# ---------------- one-click setup: controller driver + firewall (ALL of this runs on background threads, only when the
# person clicks a button in the PC window or once at start. It never touches the phone connection / input path.) ----------------
VIGEM_FILE = "ViGEmBus_1.22.0_x64_x86_arm64.exe"
VIGEM_DL = "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/" + VIGEM_FILE
VIGEM_SHA256 = "89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a"   # the installer is only run if it matches
FW_RULES = ("Thunder Gamepad TCP", "Thunder Gamepad UDP")
SETUP = {"driver": "", "fw": ""}        # "" idle | "downloading" | "installing" | "working" | "error: ..."
FIREWALL = {"checked": False, "ok": False}
_NOWIN = 0x08000000                     # CREATE_NO_WINDOW


def _sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url, path):
    import urllib.request
    tmp = path + ".part"
    with urllib.request.urlopen(url, timeout=30) as r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 18)
            if not b:
                break
            f.write(b)
    os.replace(tmp, path)


def _run_elevated(file, params=""):
    """Start a program with the Windows permission (UAC) prompt. True if Windows started it."""
    import ctypes
    return ctypes.windll.shell32.ShellExecuteW(None, "runas", file, params, None, 1) > 32


def _sc_ok(name):
    import subprocess
    try:
        return subprocess.run(["sc", "query", name], capture_output=True, creationflags=_NOWIN, timeout=8).returncode == 0
    except Exception:
        return False


def _vigem_service():
    return _sc_ok("ViGEmBus")


def install_driver():
    if SETUP["driver"] in ("downloading", "installing"):
        return False
    threading.Thread(target=_install_driver, daemon=True).start()
    return True


def _install_driver():
    import tempfile
    try:
        if not IS_WIN:
            raise RuntimeError("the driver is only needed on Windows")
        SETUP["driver"] = "downloading"
        path = os.path.join(tempfile.gettempdir(), "ThunderGamepad_" + VIGEM_FILE)
        if not (os.path.exists(path) and _sha256(path) == VIGEM_SHA256):
            _download(VIGEM_DL, path)
        if _sha256(path) != VIGEM_SHA256:
            try: os.remove(path)
            except OSError: pass
            raise RuntimeError("the downloaded file did not match the expected checksum, so it was not run")
        SETUP["driver"] = "installing"
        log("installing ViGEmBus driver (Windows will ask for permission)")
        if not _run_elevated(path, "/passive /norestart"):
            raise RuntimeError("the Windows permission prompt was declined")
        for _ in range(90):                       # up to 3 min, only while the person is installing
            time.sleep(2)
            if _vigem_service():
                break
        else:
            raise RuntimeError("the installer did not finish in 3 minutes")
        time.sleep(2)
        _probe_driver()
        SETUP["driver"] = ""
        log("driver installed" if DRIVER["ok"] else "driver installed, but needs Thunder Gamepad to be reopened: " + DRIVER["err"])
    except Exception as e:
        SETUP["driver"] = "error: " + str(e)
        log("driver setup failed:", e)


def _fw_present():
    import subprocess
    try:
        for n in FW_RULES:
            if subprocess.run(["netsh", "advfirewall", "firewall", "show", "rule", "name=" + n], capture_output=True,
                              creationflags=_NOWIN, timeout=8).returncode != 0:
                return False
        return True
    except Exception:
        return False


def _probe_firewall():
    FIREWALL.update(checked=True, ok=_fw_present() if IS_WIN else True)


def _fw_script(port):
    """Text of the .cmd that adds the two inbound rules (LAN only: remoteip=localsubnet)."""
    out = []
    for n in FW_RULES:
        out.append(f'netsh advfirewall firewall delete rule name="{n}" >nul 2>&1')
    out.append(f'netsh advfirewall firewall add rule name="{FW_RULES[0]}" dir=in action=allow protocol=TCP localport={port} profile=any remoteip=localsubnet')
    out.append(f'netsh advfirewall firewall add rule name="{FW_RULES[1]}" dir=in action=allow protocol=UDP localport={DISCOVERY_PORT} profile=any remoteip=localsubnet')
    return "\r\n".join(["@echo off"] + out) + "\r\n"


def setup_firewall():
    if SETUP["fw"] == "working":
        return False
    threading.Thread(target=_setup_firewall, daemon=True).start()
    return True


def _setup_firewall():
    import tempfile
    try:
        if not IS_WIN:
            raise RuntimeError("only needed on Windows")
        SETUP["fw"] = "working"
        bat = os.path.join(tempfile.gettempdir(), "thunder_gamepad_firewall.cmd")
        with open(bat, "w") as f:
            f.write(_fw_script(ARGS.port))
        if not _run_elevated("cmd.exe", f'/c "{bat}"'):
            raise RuntimeError("the Windows permission prompt was declined")
        for _ in range(30):
            time.sleep(1.5)
            if _fw_present():
                break
        _probe_firewall()
        if not FIREWALL["ok"]:
            raise RuntimeError("Windows did not add the rule")
        SETUP["fw"] = ""
        log("firewall rules added (TCP %d, UDP %d, local network only)" % (ARGS.port, DISCOVERY_PORT))
    except Exception as e:
        SETUP["fw"] = "error: " + str(e)
        log("firewall setup failed:", e)


def _local(request):
    return (request.remote or "") in ("127.0.0.1", "::1")


async def ui_page(request):
    if not _local(request):
        return web.Response(status=403, text="local only")
    return web.FileResponse(_res("index.html"))


async def api_status(request):
    if not _local(request):
        return web.Response(status=403, text="local only")
    global LAST_UI_POLL
    LAST_UI_POLL = time.time()
    if time.time() - _ips_cache[0] > 15:
        _ips_cache[0], _ips_cache[1] = time.time(), lan_ips()
    return web.json_response({"phone": PHONE["name"], "pad": PAD_KIND, "padError": PAD_ERROR, "port": ARGS.port,
                              "ips": _ips_cache[1], "pending": ({"name": PENDING["name"], "ip": PENDING["ip"], "left": max(0, int(ASK_SECS - (time.time() - PENDING["ts"])))} if PENDING else None), "phones": phones_list(), "driver": dict(DRIVER), "setup": dict(SETUP), "firewall": dict(FIREWALL), "autostart": autostart_get(),
                              "version": APP_VERSION, "log": list(LOGS)[-60:],
                              "error": SERVER_ERROR[0]})


async def api_action(request):
    if not _local(request):
        return web.Response(status=403, text="local only")
    act = request.match_info.get("action", "")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if act == "quit":
        QUIT.set()
    elif act == "autostart":
        autostart_set(bool(body.get("on")))
    elif act == "decide":
        decide(body.get("allow"))
    elif act == "forget":
        forget(str(body.get("id", "")))
    elif act == "driver":
        install_driver()
    elif act == "firewall":
        setup_firewall()
    elif act == "driverpage":
        import webbrowser
        webbrowser.open(VIGEM_URL)
    return web.json_response({"ok": True})


SERVER_ERROR = [""]


async def serve():
    global LOOP, _STOP
    LOOP = asyncio.get_running_loop()
    _STOP = asyncio.Event()
    if ARGS.pad:
        init_pad(ARGS.pad)
    threading.Thread(target=discovery_thread, daemon=True).start()
    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/ui", ui_page)
    app.router.add_get("/api/status", api_status)
    app.router.add_post("/api/{action}", api_action)
    threading.Thread(target=_probe_driver, daemon=True).start()
    threading.Thread(target=_probe_firewall, daemon=True).start()   # once, off the hot path
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", ARGS.port).start()
    log(f"{APP_NAME} receiver running on {', '.join(lan_ips()) or '?'} port {ARGS.port}")
    HOOK("ready", status())
    await _STOP.wait()
    await runner.cleanup()


def start_thread():
    """Run the server on a background thread (for the GUI). Returns the thread."""
    def run():
        try:
            asyncio.run(serve())
        except Exception as e:
            log("server stopped:", e)
            SERVER_ERROR[0] = str(e)
            HOOK("error", str(e))
    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


def stop():
    if LOOP and _STOP:
        LOOP.call_soon_threadsafe(_STOP.set)
    panic()
