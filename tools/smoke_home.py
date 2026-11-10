# Headless smoke test of Home polish.  LAYOUT=file.json python3 tools/smoke_home.py
import json, os
from playwright.sync_api import sync_playwright
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
lay=json.load(open(os.environ.get("LAYOUT","Genshin_layout.json")))
store=json.dumps({"g1":{"name":"Genshin","data":lay,"edited":1}})
init="""window.NativeBridge={connect(){},disconnect(){},send(){},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};
localStorage.setItem('padlink.seeded','1');localStorage.setItem('padlink.layouts', %s);""" % json.dumps(store)
ok=[]
def chk(n,c): ok.append(c); print(("PASS " if c else "FAIL ")+n)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390})
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script(init); pg.goto("file://"+WWW)
    chk("continue card shows layout", "Genshin" in pg.inner_text("#cont") and "Not connected" in pg.inner_text("#cont"))
    pg.evaluate("Native.onMessage(JSON.stringify({t:'welcome',host:'PC',pad:'xbox'}))")
    chk("continue card updates on connect", "Connected" in pg.inner_text("#cont"))
    pg.click("#contGo"); pg.wait_for_selector("#stage .el")
    chk("one-tap play renders", pg.locator("#stage .el").count()>20)
    chk("played stamp saved", pg.evaluate("!!JSON.parse(localStorage.getItem('padlink.layouts')).g1.played"))
    pg.evaluate("Play.stop()"); pg.click("[data-go=library]")
    chk("card shows played", "played" in pg.inner_text("#cards"))
    pg.click("[data-a=dup]"); chk("duplicate -> 2 cards", pg.locator(".lay").count()==2)
    chk("duplicate deep copy", pg.evaluate("Object.values(JSON.parse(localStorage.getItem('padlink.layouts'))).filter(l=>l.name==='Genshin copy').length")==1)
    pg.locator(".lay",has_text="Genshin copy").locator("[data-a=rename]").click()
    pg.fill("#dlgI","Honkai"); pg.click("#dlgOk")
    chk("rename", pg.locator(".lay",has_text="Honkai").count()==1)
    pg.locator(".lay",has_text="Honkai").locator("[data-a=del]").click(); pg.click("#dlgOk")
    chk("delete", pg.locator(".lay").count()==1)
    chk("0 js errors", not errs); print(errs)
    b.close()
print("ALL PASS" if all(ok) else "SOME FAILED")
