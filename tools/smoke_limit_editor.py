# Editor check: the Cinema button's radius can be edited and is saved.  python3 tools/smoke_limit_editor.py
import json, os
from playwright.sync_api import sync_playwright
D=os.path.dirname(os.path.abspath(__file__))
WWW=os.path.join(D,"..","app","src","main","assets","www","index.html")
lay=json.load(open(os.path.join(D,"..","layouts","Genshin.json"),encoding="utf-8"))
store=json.dumps({"g1":{"name":"Genshin","data":lay,"edited":1}})
init="window.NativeBridge={connect(){},disconnect(){},send(){},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};localStorage.setItem('padlink.seeded','1');localStorage.setItem('padlink.layouts',%s);"%json.dumps(store)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e))); pg.add_init_script(init); pg.goto("file://"+WWW)
    pg.click('[data-go=library]'); pg.click('[data-a=edit]'); pg.wait_for_selector('#editor .el')
    pg.locator('#editor .el',has_text="Cinema").first.click()
    sel=pg.locator('select[data-f="action.stick"]'); rad=pg.locator('input[data-f="action.radius"]')
    print("inspector shows stick/radius:", sel.input_value(), rad.input_value())
    rad.fill("0.2"); rad.dispatch_event("input"); rad.dispatch_event("change"); pg.wait_for_timeout(400)
    saved=json.loads(json.loads(pg.evaluate("localStorage.getItem('padlink.layouts')"))["g1"]["data"] if isinstance(json.loads(pg.evaluate("localStorage.getItem('padlink.layouts')"))["g1"]["data"],str) else json.dumps(json.loads(pg.evaluate("localStorage.getItem('padlink.layouts')"))["g1"]["data"]))
    c=[i for i in saved["layout"] if i.get("label")=="Cinema"][0]
    print("saved action:", c["action"]); assert abs(c["action"]["radius"]-0.2)<1e-9 and c["action"]["stick"]=="right"
    print("errors",errs); assert not errs; print("EDITOR PASS"); b.close()
