"""Thunder Gamepad - PC launcher (the .exe). Starts the receiver (core.py) and shows its window,
which is the same web design as the phone app (receiver/ui/index.html) in a borderless Edge/Chrome app window."""
import faulthandler, os, socket, subprocess, sys, time, traceback, webbrowser

CRASH_LOG = os.path.join(os.path.expanduser("~"), "ThunderGamepad_crash.log")
try:   # if the program ever dies hard, this file says why
    _crash_f = open(CRASH_LOG, "a")
    faulthandler.enable(_crash_f)
except Exception:
    _crash_f = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core


def port_open():
    try:
        socket.create_connection(("127.0.0.1", core.ARGS.port), timeout=0.7).close()
        return True
    except OSError:
        return False


def browsers():
    pf = [os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", ""), os.environ.get("LocalAppData", "")]
    rel = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"]
    return [os.path.join(b, r) for r in rel for b in pf if b and os.path.exists(os.path.join(b, r))]


def open_ui():
    url = "http://127.0.0.1:%d/ui" % core.ARGS.port
    profile = os.path.join(os.path.expanduser("~"), ".thunder_gamepad_window")
    for exe in browsers():
        try:
            subprocess.Popen([exe, "--app=" + url, "--window-size=980,640", "--user-data-dir=" + profile,
                              "--no-first-run", "--disable-features=Translate"])
            return
        except OSError:
            continue
    webbrowser.open(url)   # no Edge/Chrome found: normal browser tab


def selftest():
    """CI: start the server, make sure the port + UI answer, write selftest.txt, exit 0/1."""
    import urllib.request
    core.start_thread()
    ok, msg = False, "port never opened"
    for _ in range(24):
        time.sleep(0.25)
        try:
            html = urllib.request.urlopen("http://127.0.0.1:%d/ui" % core.ARGS.port, timeout=2).read().decode("utf-8", "ignore")
            st = urllib.request.urlopen("http://127.0.0.1:%d/api/status" % core.ARGS.port, timeout=2).read()
            ok = "Thunder Gamepad" in html and b"version" in st
            msg = "OK: server + UI + status answer on %d" % core.ARGS.port if ok else "UI answered but content is wrong"
            break
        except Exception as e:
            msg = "waiting: %s" % e
    try:
        open("selftest.txt", "w").write(msg + "\n")
    except OSError:
        pass
    os._exit(0 if ok else 1)


def main():
    if "--selftest" in sys.argv:
        selftest()
    background = "--background" in sys.argv
    if port_open():                       # already running -> just bring its window back
        if not background:
            open_ui()
        return
    def hook(kind, info=None):            # a new phone asks to connect: make sure someone can see the Allow/Block prompt
        if kind == "ask" and time.time() - core.LAST_UI_POLL > 4:
            open_ui()
    core.HOOK = hook
    core.start_thread()
    for _ in range(20):                   # wait until the server answers (max ~5 s)
        if port_open():
            break
        time.sleep(0.25)
    if not background:
        open_ui()
    while not core.QUIT.is_set():
        time.sleep(0.4)
    core.stop()
    time.sleep(0.3)
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        try:
            with open(CRASH_LOG, "a") as f:
                f.write(traceback.format_exc() + "\n")
        except Exception:
            pass
        raise
