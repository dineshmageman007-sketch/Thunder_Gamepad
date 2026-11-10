# how to run: python3 tools/smoke_import_name.py  (imported layout name = file name without path and .json)
import os,json
from playwright.sync_api import sync_playwright
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
ok=True
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script("window.NativeBridge={connect(){},disconnect(){},send(){},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};")
    pg.goto("file://"+WWW)
    for n in ["Windows.json","primary:Download/Windows.json","/storage/emulated/0/Download/My Game.JSON","1000012345"]:
        pg.evaluate("n=>Native.onMessage(JSON.stringify({t:'imported',name:n,text:JSON.stringify({settings:{},layout:[]})}))",n)
    names=pg.evaluate("Object.values(JSON.parse(localStorage.getItem('padlink.layouts'))).map(l=>l.name)")
    print(names)
    for want in ["Windows","My Game","1000012345"]:
        c=want in names; ok&=c; print("PASS" if c else "FAIL",want)
    ok&=names.count("Windows")==2; ok&=not any("/" in n or ":" in n or n.lower().endswith(".json") for n in names)
    print("errors",errs); b.close()
print("ALL PASS" if ok and not errs else "FAILED"); raise SystemExit(0 if ok and not errs else 1)
