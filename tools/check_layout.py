# Render check for any layout file: LAYOUT=file.json python3 tools/check_layout.py (counts elements, JS errors, taps 'A')
import json, time
from playwright.sync_api import sync_playwright
import os
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
lay=json.load(open(os.environ.get("LAYOUT","layout.json")))
store=json.dumps({"g1":{"name":"Genshin","data":lay,"edited":1}})
init="""
window.__sent=[]; window.__vib=[]; document.addEventListener('DOMContentLoaded',()=>{Link.mode='native'});
window.NativeBridge={connect(){},disconnect(){},send(s){window.__sent.push(JSON.parse(s))},vibrate(a,b){window.__vib.push(a)},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};
localStorage.setItem('padlink.layouts', %s);
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
    print("rendered", pg.locator('#stage .el').count(), "of", len(lay["layout"]), "| errors:", errs)
    x,y=(lambda bb:(bb["x"]+bb["width"]/2,bb["y"]+bb["height"]/2))(pg.locator('#stage .el',has_text="A").first.bounding_box())
    pg.evaluate("window.__sent.length=0"); pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.up()
    print("tap A ->", pg.evaluate("window.__sent.filter(e=>e.t!=='ping')"))
    b.close()
