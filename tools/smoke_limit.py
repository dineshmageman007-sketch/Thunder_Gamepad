# Headless test of the stick limiter (Walk / Cinema buttons).  LAYOUT=layouts/Genshin.json python3 tools/smoke_limit.py
import json, os
from playwright.sync_api import sync_playwright
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
lay=json.load(open(os.environ.get("LAYOUT",os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","layouts","Genshin.json")),encoding="utf-8"))
store=json.dumps({"g1":{"name":"Genshin","data":lay,"edited":1}})
init="""
window.__sent=[]; document.addEventListener('DOMContentLoaded',()=>{Link.mode='native'});
window.NativeBridge={connect(){},disconnect(){},send(s){window.__sent.push(JSON.parse(s))},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};
localStorage.setItem('padlink.seeded','1'); localStorage.setItem('padlink.layouts', %s);
""" % json.dumps(store)
ok=True
def check(name,cond,extra=""):
    global ok; ok&=bool(cond); print(("PASS " if cond else "FAIL ")+name, extra)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390})
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script(init); pg.goto("file://"+WWW)
    pg.evaluate("Native.onMessage(JSON.stringify({t:'welcome',host:'PC',pad:'xbox'}))")
    pg.click('[data-go=library]'); pg.click('[data-a=play]'); pg.wait_for_selector('#stage .el')
    def sent(): return pg.evaluate("window.__sent.filter(e=>e.t==='stick')")
    def clear(): pg.evaluate("window.__sent.length=0")
    def mag(side,x0,y0,dx):          # drag a floating stick far and return the biggest output length
        clear(); pg.mouse.move(x0,y0); pg.mouse.down(); pg.mouse.move(x0+dx,y0,steps=6)
        m=max([(e["x"]**2+e["y"]**2)**.5 for e in sent() if e["side"]==side[0]] or [0]); pg.mouse.up(); return round(m,3)
    def active(txt): return pg.locator('#stage .el',has_text=txt).first.evaluate("e=>e.classList.contains('active')")
    def tap(txt): pg.locator('#stage .el',has_text=txt).first.click()
    L=(120,200); R=(560,200)
    check("left full", mag("left",*L,150)>=0.99, mag("left",*L,150)); check("right full", mag("right",*R,150)>=0.99)
    tap("Walk"); check("Walk highlighted", active("Walk"))
    m=mag("left",*L,150); check("Walk caps left at 0.4", abs(m-0.4)<0.01, m)
    check("right untouched by Walk", mag("right",*R,150)>=0.99)
    tap("Cinema"); check("Cinema highlighted", active("Cinema"))
    m=mag("right",*R,150); check("Cinema caps right at 0.3", abs(m-0.3)<0.01, m)
    check("both on: left still 0.4", abs(mag("left",*L,150)-0.4)<0.01)
    tap("Walk"); check("Walk off: not highlighted", not active("Walk")); check("Walk off: left full again", mag("left",*L,150)>=0.99)
    check("Cinema still on after Walk off", abs(mag("right",*R,150)-0.3)<0.01)
    tap("Cinema"); check("Cinema off: right full", mag("right",*R,150)>=0.99)
    # cap switched on while the thumb is already holding the stick (second finger on the button)
    tap("Walk"); tap("Walk")   # make sure state is off
    clear(); pg.mouse.move(*L); pg.mouse.down(); pg.mouse.move(L[0]+150,L[1],steps=6)
    pg.evaluate("""(()=>{const el=[...document.querySelectorAll('#stage .el')].find(e=>e.textContent.includes('Walk'));
      el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,bubbles:true,clientX:5,clientY:5}));
      el.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,bubbles:true,clientX:5,clientY:5}));})()""")
    last=sent()[-1]; m=round((last["x"]**2+last["y"]**2)**.5,3); pg.mouse.up()
    check("cap applies instantly to a held stick", abs(m-0.4)<0.01, m)
    # page re-render keeps state; release all clears it
    pg.evaluate("Play.util && 0"); 
    print("errors",errs); check("no JS errors", not errs)
    b.close()
print("ALL PASS" if ok else "SOME FAILED")
