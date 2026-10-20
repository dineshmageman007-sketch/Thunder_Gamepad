# Look zone test (v3 behaviour): every touch move -> one mmove message, sent immediately, no frame batching.
# LAYOUT=layouts/Minecraft.json python3 tools/smoke_look.py
import json, os, time
from playwright.sync_api import sync_playwright
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
lay=json.load(open(os.environ.get("LAYOUT","layouts/Minecraft.json")))
store=json.dumps({"g1":{"name":"T","data":lay,"edited":1}})
init="""window.__sent=[];document.addEventListener('DOMContentLoaded',()=>{Link.mode='native'});
window.NativeBridge={connect(){},disconnect(){},send(s){window.__sent.push(JSON.parse(s))},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};
localStorage.setItem('padlink.layouts', %s);localStorage.setItem('padlink.seeded','1');"""%json.dumps(store)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e))); pg.add_init_script(init); pg.goto("file://"+WWW)
    pg.evaluate("Native.onMessage(JSON.stringify({t:'welcome',host:'PC',pad:'xbox'}))")
    pg.click('[data-go=library]'); pg.click('[data-a=play]'); pg.wait_for_selector('#stage .el')
    pg.evaluate("window.__sent.length=0")
    x,y=520,170
    pg.mouse.move(x,y); pg.mouse.down()
    for i in range(1,21): pg.mouse.move(x+i*3,y+i); 
    # no waiting for a frame: count immediately after the last move was dispatched
    mm=pg.evaluate("window.__sent.filter(e=>e.t==='mmove')"); pg.mouse.up()
    sx=sum(e['dx'] for e in mm); sy=sum(e['dy'] for e in mm)
    print("mmove messages:",len(mm)," sum dx,dy:",sx,sy)
    # first ~10px of a touch is the tap/drag dead zone (same as v3): 17 of 20 steps are routed
    ok = len(mm)==17 and abs(sx-17*3*5.8)<=8 and abs(sy-17*1*5.8)<=8 and not errs
    print("js errors:",errs); print("PASS" if ok else "FAIL")
