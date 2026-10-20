"""Render receiver/ui/index.html with mocked /api/status for 3 states; saves PNGs to /tmp/pcui_*.png"""
import json, os, http.server, threading, functools
from playwright.sync_api import sync_playwright
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "receiver", "ui")
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=D)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = {"phone": "", "pad": "xbox", "padError": "", "port": 8766, "ips": ["10.95.244.112"], "phones": [{"id": "ab12cd34", "name": "CPH2629", "added": 1760000000, "last": 0}], "pending": None, "setup": {"driver": "", "fw": ""}, "firewall": {"checked": True, "ok": False},
        "driver": {"checked": True, "ok": True, "err": ""}, "autostart": False, "version": "0.1.0", "log": ["Thunder Gamepad receiver running on 10.95.244.112 port 8766"], "error": ""}
states = {"waiting": base, "connected": dict(base, phone="CPH2629"), "nodriver": dict(base, driver={"checked": True, "ok": False, "err": "x"}),
          "asking": dict(base, pending={"name": "Pixel 8", "ip": "192.168.1.23", "left": 24})}
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, st in states.items():
        pg = b.new_page(viewport={"width": 980, "height": 640}); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route("**/api/status", (lambda S: (lambda r, q=None: r.fulfill(json=S)))(st))
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html"); pg.wait_for_timeout(900)
        pg.screenshot(path=f"/tmp/pcui_{name}.png")
        if name == "connected":
            pg.click("[data-go=settings]"); pg.wait_for_timeout(200); pg.screenshot(path="/tmp/pcui_settings.png")
    b.close()
print("JS errors:", errs)
