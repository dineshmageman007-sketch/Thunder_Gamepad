# Ready-made layouts: seeded on first start, render, buttons work, PS switches PC to DS4. python3 tools/smoke_presets.py
import json, os, re
from playwright.sync_api import sync_playwright
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
INIT="window.__sent=[];window.NativeBridge={connect(){},disconnect(){},send(s){window.__sent.push(JSON.parse(s))},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){},keepWifi(){}};document.addEventListener('DOMContentLoaded',()=>{Link.mode='native'});"
ok=[]
def chk(n,c): ok.append(c); print(("PASS " if c else "FAIL ")+n)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e))); pg.add_init_script(INIT); pg.goto("file://"+WWW)
    pg.evaluate("Native.onMessage(JSON.stringify({t:'welcome',host:'PC',pad:'xbox'}))")
    names=pg.evaluate("Object.values(JSON.parse(localStorage.getItem('padlink.layouts'))).map(l=>l.name)")
    chk("first start has Xbox 360 + PlayStation", sorted(names)==["PlayStation","Xbox 360"])
    for pid,face,exp,cnt in (("preset_xbox",re.compile(r"^A$"),"A",19),("preset_ps",re.compile(r"^✕$"),"A",20)):
        pg.evaluate("id=>{window.__sent.length=0;document.querySelector('[data-go=library]').click();document.querySelector('.lay[data-id=\"'+id+'\"] [data-a=play]').click()}", pid)
        pg.wait_for_selector("#stage .el"); n=pg.locator("#stage .el").count()
        chk(pid+" renders all %d controls"%cnt, n==cnt)
        bb=pg.locator("#stage .el",has_text=face).first.bounding_box(); pg.mouse.click(bb["x"]+bb["width"]/2,bb["y"]+bb["height"]/2)
        ev=pg.evaluate("window.__sent.filter(e=>e.t==='pad'&&e.d===1).map(e=>e.n)")
        chk(pid+" face button sends pad A", exp in ev)
        pg.evaluate("Play.stop()")
    chk("PlayStation layout switched PC to ds4", pg.evaluate("Link.conn.pad")=="ds4" and any(e["t"]=="setpad" and e["kind"]=="ds4" for e in pg.evaluate("window.__sent")))
    pg.click("[data-go=library]"); pg.click("[data-preset=xbox]")
    chk("+ Xbox button adds another copy", pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('padlink.layouts'))).length")==3)
    pg.reload(); chk("not re-seeded after reload", pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('padlink.layouts'))).length")==3)
    chk("no js errors", not errs); b.close()
print("ALL PASS" if all(ok) else "SOME FAILED")
