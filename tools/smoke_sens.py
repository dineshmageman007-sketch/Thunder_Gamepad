# Headless smoke test of the Play screen with a mocked NativeBridge.  LAYOUT=path/to/layout.json python3 tools/smoke_play.py
import json, time
from playwright.sync_api import sync_playwright
import os
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
lay=json.load(open(os.environ.get("LAYOUT","Genshin_layout.json")))
store=json.dumps({"g1":{"name":"Genshin","data":lay,"edited":1}})
init="""
window.__sent=[]; window.__vib=[]; document.addEventListener('DOMContentLoaded',()=>{Link.mode='native'});
window.NativeBridge={connect(){},disconnect(){},send(s){window.__sent.push(JSON.parse(s))},vibrate(a,b){window.__vib.push(a)},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};
localStorage.setItem('padlink.seeded','1'); localStorage.setItem('padlink.layouts', %s);
""" % json.dumps(store)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/opt/pw-browsers/chromium" if False else None)
    pg=b.new_page(viewport={"width":844,"height":390})
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.add_init_script(init)
    pg.goto("file://"+WWW)
    pg.evaluate("Native.onMessage(JSON.stringify({t:'welcome',host:'PC',pad:'xbox'}))")
    pg.click('[data-go=library]'); pg.click('[data-a=play]')
    pg.wait_for_selector('#stage .el')
    print("elements", pg.locator('#stage .el').count())
    def clear(): pg.evaluate("window.__sent.length=0")
    def sent(): return pg.evaluate("window.__sent.filter(e=>e.t!=='ping')")
    def center(txt):
        bb=pg.locator('#stage .el',has_text=txt).first.bounding_box(); return bb['x']+bb['width']/2, bb['y']+bb['height']/2

    def drag(dx):
        clear(); pg.mouse.move(120,250); pg.mouse.down(); pg.mouse.move(120+dx,250,steps=4)
        st=[e for e in sent() if e.get("t")=="stick" or "stick" in str(e)]; last=st[-1] if st else None; pg.mouse.up(); return last
    print("1.0x  small push:", drag(14))
    pg.evaluate("(()=>{const s=App.settings();s.stickSens=2})()"); print("2.0x  small push:", drag(14))
    pg.evaluate("(()=>{const s=App.settings();s.stickSens=0.5})()"); print("0.5x  small push:", drag(14))
    pg.evaluate("(()=>{const s=App.settings();s.stickSens=1})()")
    print("errors",errs); b.close()
