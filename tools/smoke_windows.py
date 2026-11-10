# how to run: python3 tools/smoke_windows.py   (checks layouts/Windows.json: render, page switch, typing mode sends no key, macros, combos)
import json, os
from playwright.sync_api import sync_playwright
R=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..")
WWW=os.path.join(R,"app","src","main","assets","www","index.html")
lay=json.load(open(os.path.join(R,"layouts","Windows.json")))
init="""window.__sent=[];document.addEventListener('DOMContentLoaded',()=>{Link.mode='native'});
window.NativeBridge={connect(){},disconnect(){},send(s){window.__sent.push(JSON.parse(s))},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){},showKeyboard(){},hideKeyboard(){}};
localStorage.setItem('padlink.layouts', %s);""" % json.dumps(json.dumps({"w":{"name":"Windows","data":lay,"edited":1}}))
ok=True
def chk(n,c):
    global ok; ok&=bool(c); print("PASS" if c else "FAIL",n)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e))); pg.add_init_script(init); pg.goto("file://"+WWW)
    pg.evaluate("Native.onMessage(JSON.stringify({t:'welcome',host:'PC',pad:'xbox'}))")
    pg.click('[data-go=library]'); pg.click('.lay[data-id=w] [data-a=play]'); pg.wait_for_selector('#stage .el')
    sent=lambda: [e for e in pg.evaluate("window.__sent") if e["t"]!="ping"]
    clear=lambda: pg.evaluate("window.__sent.length=0")
    def tap(txt,exact=True):
        loc=pg.locator('#stage .el',has_text=txt)
        bb=loc.first.bounding_box(); pg.mouse.move(bb["x"]+bb["width"]/2,bb["y"]+bb["height"]/2); pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(120)
    chk("main page renders", pg.locator('#stage .el').count()>30)
    clear(); tap("Start"); s=sent(); chk("Start -> key cmd", any(e["t"]=="key" and e["k"]=="cmd" and e["d"]==1 for e in s))
    clear(); tap("⌨"); pg.wait_for_timeout(500); s=sent()
    chk("Type opens bar and sends NO key (no 't')", pg.locator('#chatbar').is_visible() and not [e for e in s if e["t"]=="key"])
    pg.fill('#chatin',"hello"); pg.wait_for_timeout(100); chk("typed text goes to PC", any(e["t"]=="type" and "hello" in e["s"] for e in sent()))
    clear(); pg.click('#chatx'); pg.wait_for_timeout(100); chk("Exit closes bar, sends no key", not pg.locator('#chatbar').is_visible() and not [e for e in sent() if e["t"]=="key"])
    clear(); tap("Keys"); pg.wait_for_timeout(100); chk("Keys page shows Copy", pg.locator('#stage .el',has_text="Copy").count()==1)
    clear(); tap("Copy"); s=sent(); chk("Copy -> ctrl+c", [e["k"] for e in s if e["t"]=="key" and e["d"]==1][-2:]==["ctrl","c"] or any(e["t"]=="key" and e["k"]=="c" for e in s))
    tap("Magic"); clear(); tap("Terminal"); pg.wait_for_timeout(1500); s=sent(); chk("Terminal macro types wt then enter", any(e["t"]=="type" and e["s"]=="wt" for e in s) and any(e["t"]=="key" and e["k"]=="enter" for e in s))
    clear(); tap("●"); s=sent(); chk("teleport centre -> mto .5 .5", any(e["t"]=="mto" and e["x"]==0.5 and e["y"]==0.5 for e in s))
    print("js errors:",errs); chk("no js errors", not errs); b.close()
print("ALL PASS" if ok else "SOME FAILED"); raise SystemExit(0 if ok else 1)
