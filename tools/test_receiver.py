"""Receiver logic test with stubbed aiohttp/pynput/vgamepad (no drivers needed).  python3 tools/test_receiver.py"""
import sys, types, asyncio, json, os, enum
rec = []   # everything the fakes were asked to do
def mod(name, **kw):
    m = types.ModuleType(name); m.__dict__.update(kw); sys.modules[name] = m; return m
class Rec:
    def __init__(s, tag): s.tag = tag
    def __getattr__(s, n):
        if n.startswith("__"): raise AttributeError(n)
        return lambda *a, **k: rec.append((s.tag, n, a, k))
class Key(enum.Enum):
    ctrl=1; shift=2; alt=3; cmd=4; space=5; backspace=6; esc=7; enter=8
class KeyCode:
    def __init__(s, vk=None, ch=None): s.vk, s.ch = vk, ch
    @classmethod
    def from_vk(c, v): return c(vk=v)
    def __repr__(s): return f"KC({s.vk})"
class Btn(enum.Enum): left=1; right=2; middle=3
mod("pynput"); mod("pynput.keyboard", Controller=lambda: Rec("kb"), Key=Key, KeyCode=KeyCode); mod("pynput.mouse", Controller=lambda: Rec("ms"), Button=Btn)
class FakeWS:
    def __init__(s): s.q = asyncio.Queue(); s.out = []; s.closed = False
    async def prepare(s, r): pass
    async def send_json(s, o): s.out.append(o)
    async def close(s): s.closed = True; s.q.put_nowait(None)
    def __aiter__(s): return s
    async def __anext__(s):
        m = await s.q.get()
        if m is None: raise StopAsyncIteration
        return m
    def feed(s, o): s.q.put_nowait(types.SimpleNamespace(type=1, data=json.dumps(o)))
class Web: WebSocketResponse = None
mod("aiohttp", web=Web, WSMsgType=types.SimpleNamespace(TEXT=1))
class FakePad(Rec):
    def __init__(s): super().__init__("pad")
class VG:
    class XUSB_BUTTON:
        def __getattr__(s, n): return n
    VX360Gamepad = FakePad; VDS4Gamepad = FakePad
vgm = mod("vgamepad")
class _Any:
    def __getattr__(s, n): return n
vgm.XUSB_BUTTON = _Any(); vgm.DS4_BUTTONS = _Any(); vgm.DS4_SPECIAL_BUTTONS = _Any(); vgm.DS4_DPAD_DIRECTIONS = _Any()
vgm.VX360Gamepad = FakePad; vgm.VDS4Gamepad = FakePad
sys.argv = ["x"]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "receiver"))
import core as R
import tempfile
R.DEV_PATH = os.path.join(tempfile.mkdtemp(), "devices.json")
GOOD = "g" * 32
R.DEV["phones"][GOOD] = {"name": "Old phone", "ip": "1.1.1.1", "added": 1}
ok = []
def chk(n, c): ok.append(bool(c)); print(("PASS " if c else "FAIL ") + n)
def ops(tag=None): return [(t, n) for t, n, a, k in rec if tag in (None, t)]

async def session(ws, token=GOOD, pad="xbox", ip="9.9.9.9"):
    Web.WebSocketResponse = lambda **k: ws
    ws.feed({"t": "hello", "token": token, "pad": pad, "name": "T"})
    return asyncio.ensure_future(R.ws_handler(types.SimpleNamespace(remote=ip)))

async def run():
    # --- unknown phone: asked on the PC, Block -> denied
    ws = FakeWS(); h = await session(ws, token="", ip="5.5.5.5"); await asyncio.sleep(0.05)
    chk("unknown phone gets 'pending' and the PC is asked", ws.out == [{"t": "pending", "secs": 30}] and R.PENDING and R.PENDING["name"] == "T")
    R.decide(False); await h
    chk("Block -> denied(blocked) + closed", ws.out[-1].get("reason") == "blocked" and ws.closed and R.PENDING is None)
    for _ in range(2):
        ws = FakeWS(); h = await session(ws, token="nope", ip="5.5.5.5"); await asyncio.sleep(0.05); R.decide(False); await h
    ws = FakeWS(); h = await session(ws, token="", ip="5.5.5.5"); await h
    chk("3 declines -> that phone is ignored for 60 s, no prompt", ws.out and ws.out[0].get("reason") == "locked" and ws.out[0]["locked"] > 0 and R.PENDING is None)
    # --- Allow -> paired token + welcome; remembered on disk
    ws = FakeWS(); h = await session(ws, token="", ip="6.6.6.6"); await asyncio.sleep(0.05)
    ws_x = FakeWS(); h_x = await session(ws_x, token="", ip="6.6.6.1"); await h_x
    chk("2nd unknown phone while one is pending -> busy", ws_x.out and ws_x.out[0].get("reason") == "busy")
    R.decide(True); await asyncio.sleep(0.1)
    kinds = [o["t"] for o in ws.out]
    chk("Allow -> pending, paired, welcome (in order)", kinds == ["pending", "paired", "welcome"])
    TOK = ws.out[1]["token"]
    chk("welcome carries pcid", ws.out[2].get("pcid") == R.DEV["pcid"])
    chk("token stored in memory + file", TOK in R.DEV["phones"] and TOK in open(R.DEV_PATH).read())
    # --- remembered phone reconnects silently (takes over the old one)
    ws_b = FakeWS(); h_b = await session(ws_b, token=TOK, ip="6.6.6.7"); await asyncio.sleep(0.1)
    chk("known token -> welcome, no prompt", [o["t"] for o in ws_b.out] == ["welcome"] and R.PENDING is None and ws.closed)
    # --- unknown token is treated like a new phone (asks again)
    ws_c = FakeWS(); h_c = await session(ws_c, token="stale", ip="6.6.6.8"); await asyncio.sleep(0.05)
    chk("stale token -> prompt again", ws_c.out and ws_c.out[0]["t"] == "pending")
    R.decide(False); await h_c
    # --- timeout
    R.ASK_SECS = 0.1
    ws_d = FakeWS(); h_d = await session(ws_d, token="", ip="6.6.6.9"); await h_d
    R.ASK_SECS = 30
    chk("nobody answers -> denied(timeout)", ws_d.out[-1].get("reason") == "timeout" and R.PENDING is None)
    # --- forget disconnects that phone
    n = R.forget(TOK[:8]); await asyncio.sleep(0.1)
    chk("forget removes phone and kicks it", n == 1 and TOK not in R.DEV["phones"] and ws_b.closed and not any(p["id"] == TOK[:8] for p in R.phones_list()))
    await h_b
    # --- dev --allow-all
    R.ARGS.allow_all = True
    ws_e = FakeWS(); h_e = await session(ws_e, token="", ip="7.7.7.7"); await asyncio.sleep(0.1)
    chk("--allow-all pairs without prompt", [o["t"] for o in ws_e.out] == ["paired", "welcome"])
    R.ARGS.allow_all = False; await ws_e.close(); await h_e
    # --- good session
    rec.clear(); ws = FakeWS(); h = await session(ws, ip="1.1.1.1"); await asyncio.sleep(0.05)
    chk("welcome xbox", ws.out and ws.out[0]["t"] == "welcome" and ws.out[0]["pad"] == "xbox")
    for e in [{"t":"pad","n":"A","d":1},{"t":"pad","n":"A","d":0},{"t":"pad","n":"RT","d":1},{"t":"trig","side":"L","v":0.5},
              {"t":"stick","side":"r","x":0,"y":-1},{"t":"key","k":"w","d":1},{"t":"key","k":"f5","d":1},{"t":"key","k":"ctrl","d":1},
              {"t":"mbtn","n":"left","d":1},{"t":"mmove","dx":5,"dy":-3},{"t":"scroll","v":1,"h":0},{"t":"type","back":2,"s":"hi"},{"t":"pad","n":"LB","d":1}]:
        ws.feed(e)
    ws.feed({"t":"ping","ts":77}); await asyncio.sleep(0.1)
    chk("pong echoes ts", {"t":"pong","ts":77} in ws.out)
    P = [(n, k) for t, n, a, k in rec if t == "pad"]
    chk("A press+release", ("press_button", {"button":"XUSB_GAMEPAD_A"}) in P and ("release_button", {"button":"XUSB_GAMEPAD_A"}) in P)
    chk("RT as trigger", ("right_trigger_float", {"value_float":1.0}) in P)
    chk("stick right", ("right_joystick_float", {"x_value_float":0.0,"y_value_float":-1.0}) in P)
    K = [(n, a) for t, n, a, k in rec if t == "kb"]
    chk("key w + F5(vk 0x74) + ctrl", any(n=="press" and a==("w",) for n,a in K) and any(n=="press" and getattr(a[0],"vk",0)==0x74 for n,a in K) and any(n=="press" and a==(Key.ctrl,) for n,a in K))
    chk("type: 2 backspaces + text", sum(1 for n,a in K if n=="press" and a==(Key.backspace,))==2 and ("type", ("hi",)) in K)
    chk("mouse move+scroll", ("move", (5,-3)) in [(n,a) for t,n,a,k in rec if t=="ms"] and ("scroll", (0,1)) in [(n,a) for t,n,a,k in rec if t=="ms"])
    rec.clear()
    # --- reconnect: new phone connection replaces old, old cleanup must not zero axes
    ws2 = FakeWS(); h2 = await session(ws2, ip="1.1.1.1"); await asyncio.sleep(0.1)
    chk("old connection closed on takeover", ws.closed)
    chk("held inputs of old phone released (A,LB,ctrl,w,mouse)", ("pad","release_button") in [(t,n) for t,n,a,k in rec] and ("kb","release") in [(t,n) for t,n,a,k in rec])
    chk("stale cleanup did not zero axes", not any(n=="left_joystick_float" for t,n,a,k in rec))
    # --- setpad switches to ds4
    rec.clear(); ws2.feed({"t":"setpad","kind":"ds4"}); await asyncio.sleep(0.05)
    chk("setpad ds4 -> new welcome", ws2.out[-1]["pad"] == "ds4")
    ws2.feed({"t":"pad","n":"UP","d":1}); ws2.feed({"t":"pad","n":"RIGHT","d":1}); await asyncio.sleep(0.05)
    chk("ds4 dpad diagonal via directional_pad", sum(1 for t,n,a,k in rec if n=="directional_pad")==2)
    ws2.feed({"t":"setpad","kind":"none"}); await asyncio.sleep(0.05)
    chk("pad none works, keys still ok", ws2.out[-1]["pad"] == "none")
    ws2.feed({"t":"reset"}); await asyncio.sleep(0.05)
    await ws2.close(); await h2
    chk("CUR cleared after disconnect", R.CUR is None)
asyncio.run(run())
# --- driver + firewall helpers (Windows parts replaced by fakes; these run on background threads in the app, never on the phone link)
import hashlib, tempfile, time as _t
tempfile.tempdir = tempfile.mkdtemp()
R.IS_WIN = True
R.time = types.SimpleNamespace(sleep=lambda x: None, time=_t.time)
data = b"fake installer"
R.VIGEM_SHA256 = hashlib.sha256(data).hexdigest()
calls = []
R._download = lambda url, path: open(path, "wb").write(b"tampered")
R._run_elevated = lambda f, p="": calls.append((f, p)) or True
R._vigem_service = lambda: True
R._probe_driver = lambda: R.DRIVER.update(checked=True, ok=True, err="")
R._install_driver()
chk("tampered download is NOT run", R.SETUP["driver"].startswith("error") and "checksum" in R.SETUP["driver"] and not calls)
R._download = lambda url, path: open(path, "wb").write(data)
R._install_driver()
chk("good download -> installer started elevated + passive, driver ok", len(calls) == 1 and calls[0][1] == "/passive /norestart" and R.SETUP["driver"] == "" and R.DRIVER["ok"])
R._run_elevated = lambda *a: False
R._install_driver()
chk("declined Windows prompt -> clear error", R.SETUP["driver"].startswith("error") and "declined" in R.SETUP["driver"])
fs = R._fw_script(8766)
chk("firewall script: TCP 8766 + UDP 8767, local network only", "protocol=TCP localport=8766" in fs and "protocol=UDP localport=8767" in fs and fs.count("remoteip=localsubnet") == 2)
st = {"on": False}; seen = []
R._fw_present = lambda: st["on"]
def fake_el(f, p=""): seen.append(open(p[4:-1]).read()); st["on"] = True; return True
R._run_elevated = fake_el
R._setup_firewall()
chk("firewall setup: script written, run elevated, rules detected", seen and "add rule" in seen[0] and R.FIREWALL["ok"] and R.SETUP["fw"] == "")
print("ALL PASS" if all(ok) else "SOME FAILED")
