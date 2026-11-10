"""Start-with-Windows task logic (stubs, no Windows needed).  python3 tools/test_autostart.py"""
import sys, types, os, time, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "receiver"))
def mod(n, **kw):
    m = types.ModuleType(n); m.__dict__.update(kw); sys.modules[n] = m; return m
class _K:
    def __getattr__(s, n): return n
import enum
class Key(enum.Enum): ctrl=1; shift=2; alt=3; cmd=4; space=5; backspace=6; esc=7; enter=8
class Btn(enum.Enum): left=1; right=2; middle=3
mod("pynput"); mod("pynput.keyboard", Controller=lambda: None, Key=Key, KeyCode=object); mod("pynput.mouse", Controller=lambda: None, Button=Btn)
mod("aiohttp", web=types.SimpleNamespace(), WSMsgType=types.SimpleNamespace(TEXT=1))
import core
ok = 0
def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name); ok += 0 if cond else 1

# 1) script content
core.sys.frozen = True; core.sys.executable = r"D:\Application Files\My Tools\ThunderGamepad.exe"
on = core._task_script(True)
check("script: exe path", "D:\\Application Files\\My Tools\\ThunderGamepad.exe" in on)
check("script: --background", "'--background'" in on)
check("script: highest run level", "-RunLevel Highest" in on)
check("script: 20 s delay", "PT20S" in on)
check("script: battery + no time limit", "-AllowStartIfOnBatteries" in on and "-DontStopIfGoingOnBatteries" in on and "[TimeSpan]::Zero" in on)
check("script: off = unregister", "Unregister-ScheduledTask" in core._task_script(False))

# 2) get: path comparison
def fake_run(xml_cmd, rc=0, utf16=True):
    def run(*a, **k):
        x = ("<Task><Actions><Exec><Command>%s</Command></Exec></Actions></Task>" % xml_cmd)
        return types.SimpleNamespace(returncode=rc, stdout=(b"\xff\xfe" + x.encode("utf-16-le")) if utf16 else x.encode())
    return run
real_run = subprocess.run
subprocess.run = fake_run(r'"d:\application files\my tools\thundergamepad.exe"')
check("query: same exe (case/quotes ignored) -> ON", core._autostart_query() is True)
subprocess.run = fake_run(r"C:\old\ThunderGamepad.exe")
check("query: task points elsewhere -> OFF", core._autostart_query() is False)
subprocess.run = fake_run("", rc=1)
check("query: no task -> OFF", core._autostart_query() is False)

# 3) set(): admin path runs powershell -File with the script; cache shows the wanted value at once
calls = []
state = {"exists": False}
def run2(cmd, *a, **k):
    calls.append(cmd)
    if cmd[0] == "powershell":
        state["exists"] = ("Register-ScheduledTask" in open(cmd[-1], encoding="utf-8-sig").read())
        return types.SimpleNamespace(returncode=0, stdout=b"")
    if state["exists"]:
        return fake_run(core.sys.executable)()
    return types.SimpleNamespace(returncode=1, stdout=b"")
subprocess.run = run2
core._is_admin = lambda: True
core._reg_autostart_remove = lambda: calls.append(["reg-remove"])
core.autostart_set(True)
check("set(True): shows ON immediately", core.autostart_get() is True)
t0 = time.time()
while core._AUTO["want"] is not None and time.time() - t0 < 10: time.sleep(0.2)
check("set(True): ran powershell as admin + removed old registry entry", any(c[0] == "powershell" for c in calls) and ["reg-remove"] in calls)
check("set(True): final state read back from Windows = ON", core.autostart_get() is True)

# 4) auto-allow phones (no Allow prompt) - only when the switch is on
import asyncio, tempfile, json
core.DEV_PATH = os.path.join(tempfile.mkdtemp(), "dev.json")
class WS:
    closed = False
    async def send_json(self, o): pass
core.DEV["auto_allow"] = True
tok, why = asyncio.run(core.pair_request(WS(), "192.168.1.5", "Phone", [0, 0.0]))
check("auto-allow ON: token issued without prompt", bool(tok) and why == "" and tok in core.DEV["phones"] and core.PENDING is None)
core.DEV["auto_allow"] = False
async def ask():
    core.ASK_SECS = 0.2
    return await core.pair_request(WS(), "192.168.1.6", "Other", [0, 0.0])
tok2, why2 = asyncio.run(ask())
check("auto-allow OFF: still asks (times out here, nobody clicked)", tok2 is None and why2 == "timeout")

# 5) declined permission prompt -> remembered, never nags again; ensure() respects the choice
core.ctypes.windll = types.SimpleNamespace(shell32=types.SimpleNamespace(ShellExecuteW=lambda *a: 5))
core._is_admin = lambda: False
subprocess.run = run2; state["exists"] = False
core.autostart_set(True)
t0 = time.time()
while core._AUTO["want"] is not None and time.time() - t0 < 10: time.sleep(0.2)
check("declined prompt -> pref False + switch OFF", core.DEV.get("autostart_pref") is False and core.autostart_get() is False)
ran = []
core.sys.frozen = True
core.autostart_set = lambda on: ran.append(on)
core.autostart_ensure(); time.sleep(0.5)
check("ensure(): pref False -> does nothing", ran == [])
core.DEV["autostart_pref"] = None; state["exists"] = False
core.autostart_ensure(); time.sleep(0.5)
check("ensure(): first run, no task -> registers it", ran == [True])
ran.clear(); state["exists"] = True; core.DEV["autostart_pref"] = None
core.autostart_ensure(); time.sleep(0.5)
check("ensure(): task already right -> nothing, pref remembered True", ran == [] and core.DEV["autostart_pref"] is True)
subprocess.run = real_run
print("ALL PASS" if not ok else "%d FAILED" % ok); sys.exit(1 if ok else 0)
