# Import test: both file shapes must load. python3 tools/smoke_import.py
import json, os
from playwright.sync_api import sync_playwright
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
bare=json.dumps([{"page":"main","type":"button","label":"A","x":50,"y":50,"s":12,"action":"pad:A"}])
wrapped=json.dumps({"settings":{},"layout":[{"type":"button","label":"B","x":50,"y":50,"s":12,"action":"pad:B"}]})
init="window.NativeBridge={connect(){},disconnect(){},send(){},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};localStorage.setItem('padlink.seeded','1');"
ok=[]
def chk(n,c): ok.append(c); print(("PASS " if c else "FAIL ")+n)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e))); pg.add_init_script(init); pg.goto("file://"+WWW)
    for name,text in (("bare list.json",bare),("wrapped.json",wrapped),("junk.json","{}")):
        pg.evaluate("t=>Native.onMessage(JSON.stringify({t:'imported',name:%s,text:t}))" % json.dumps(name), text)
    n=pg.evaluate("Object.values(JSON.parse(localStorage.getItem('padlink.layouts')||'{}')).map(l=>l.name)")
    chk("bare list imported", "bare list" in n); chk("wrapped imported", "wrapped" in n); chk("junk rejected", len(n)==2)
    chk("no js errors", not errs); b.close()
print("ALL PASS" if all(ok) else "SOME FAILED")
