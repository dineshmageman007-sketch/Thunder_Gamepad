"""Builds receiver/ThunderGamepad.ico + the PC-window icon from the APK's launcher icon, so both stay identical.
Source: app/src/main/res/drawable/ic_launcher_foreground.xml + values/ic_launcher_background.xml (colour pl_bg).
Run: python3 tools/make_icon.py   (needs playwright+chromium and Pillow; the .ico is committed, CI does not run this)"""
import base64, io, os, re, xml.etree.ElementTree as ET
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RES = os.path.join(ROOT, "app", "src", "main", "res")
A = "{http://schemas.android.com/apk/res/android}"
bg = re.search(r'name="pl_bg">(#[0-9A-Fa-f]{6})', open(os.path.join(RES, "values", "colors.xml")).read()).group(1)
paths = [(p.get(A + "fillColor"), p.get(A + "pathData")) for p in ET.parse(os.path.join(RES, "drawable", "ic_launcher_foreground.xml")).getroot().iter("path")]
# the APK's foreground sits small inside the adaptive-icon safe zone; zoom so the pad fills ~80 % of the square (same artwork)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 6 100 100"><rect x="2" y="6" width="100" height="100" rx="22" fill="%s"/>' % bg
       + "".join('<path fill="%s" d="%s"/>' % p for p in paths) + "</svg>")
open(os.path.join(ROOT, "receiver", "ui", "icon.svg"), "w").write(svg)
SIZES = [16, 24, 32, 48, 64, 128, 256]
imgs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for s in SIZES:
        pg = b.new_page(viewport={"width": s, "height": s})
        pg.set_content('<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,%s" width="%d" height="%d"></body>' % (base64.b64encode(svg.encode()).decode(), s, s))
        imgs.append(Image.open(io.BytesIO(pg.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": s, "height": s}))).convert("RGBA"))
    b.close()
imgs[-1].save(os.path.join(ROOT, "receiver", "ThunderGamepad.ico"), format="ICO", sizes=[(s, s) for s in SIZES], append_images=imgs[:-1])
imgs[-1].save("/tmp/claude-0/-home-claude/4ef0f1a1-c689-582d-be86-7e53076ff4fb/scratchpad/icon256.png")
print("ico ok", os.path.getsize(os.path.join(ROOT, "receiver", "ThunderGamepad.ico")), "bytes; bg", bg)
