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
    x,y=center("Jump"); clear(); pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.up(); print("jump",sent())
    x,y=center("Map"); clear(); pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.up(); time.sleep(1.8); print("map",len(sent()),sent()[:3],sent()[-2:])
    x,y=center("Auto"); clear(); pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.up(); time.sleep(2.5); a=sent(); print("auto on events",len(a))
    pg.mouse.down(); pg.mouse.up(); time.sleep(0.2); clear(); time.sleep(1.5); print("auto off after stop", sent())
    # floating left stick: drag in left area
    clear(); pg.mouse.move(120,250); pg.mouse.down(); pg.mouse.move(170,250,steps=4); print("stick",sent()[-2:]); pg.mouse.up(); print("release",sent()[-1])
    pg.screenshot(path="play.png")
    # HUD
    pg.click('#hudGrip'); pg.screenshot(path="hud.png"); print("hud menu", pg.locator('#hud .menu button').all_inner_texts())
    pg.click('[data-h=exit]'); print("play hidden", pg.evaluate("document.getElementById('play').hidden"))
    print("errors",errs)
    b.close()
