# how to run: python3 tools/smoke_bundled.py  (mimics the gradle step: layouts/*.json + index.json next to www; checks auto-load, no duplicates, deletes stick, edits are kept, untouched copies update)
import os, json, shutil, tempfile, threading, http.server, functools
from playwright.sync_api import sync_playwright
R=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))
T=tempfile.mkdtemp(); A=os.path.join(T,"assets")
shutil.copytree(os.path.join(R,"app","src","main","assets","www"),os.path.join(A,"www")); os.makedirs(os.path.join(A,"layouts"))
for f in os.listdir(os.path.join(R,"layouts")):
    if f.endswith(".json"): shutil.copy(os.path.join(R,"layouts",f),os.path.join(A,"layouts",f))
def index(): json.dump(sorted(f for f in os.listdir(os.path.join(A,"layouts")) if f!="index.json"),open(os.path.join(A,"layouts","index.json"),"w"))
index()
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory=T)
H.log_message=lambda *a,**k:None
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),H); threading.Thread(target=srv.serve_forever,daemon=True).start()
URL="http://127.0.0.1:%d/assets/www/index.html"%srv.server_port
ok=True
def chk(n,c):
    global ok; ok&=bool(c); print("PASS" if c else "FAIL",n)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script("window.NativeBridge={connect(){},disconnect(){},send(){},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};")
    names=lambda: sorted(l["name"] for l in json.loads(pg.evaluate("localStorage.getItem('padlink.layouts')")).values())
    pg.goto(URL); pg.wait_for_timeout(800)
    n=names(); print(n); chk("bundled layouts auto-added", {"Windows","Minecraft","Genshin"}<=set(n))
    pg.reload(); pg.wait_for_timeout(800); chk("reload: no duplicates", names()==n)
    pg.evaluate("""()=>{const L=JSON.parse(localStorage.getItem('padlink.layouts')); delete L.bundled_genshin; L.bundled_minecraft.edited=Date.now()+5; L.bundled_minecraft.data.layout=[]; localStorage.setItem('padlink.layouts',JSON.stringify(L));}""")
    w=json.load(open(os.path.join(A,"layouts","Windows.json"))); w["layout"].append({"type":"label","label":"new","x":50,"y":50,"s":10,"page":"main"})
    json.dump(w,open(os.path.join(A,"layouts","Windows.json"),"w"))
    m=json.load(open(os.path.join(A,"layouts","Minecraft.json"))); m["settings"]["opacity"]=0.9; json.dump(m,open(os.path.join(A,"layouts","Minecraft.json"),"w"))
    pg.reload(); pg.wait_for_timeout(800); L=json.loads(pg.evaluate("localStorage.getItem('padlink.layouts')"))
    chk("deleted layout stays deleted", "bundled_genshin" not in L)
    chk("edited copy is NOT overwritten", L["bundled_minecraft"]["data"]["layout"]==[])
    chk("untouched copy updated from new file", len(L["bundled_windows"]["data"]["layout"])==len(w["layout"]))
    pg.click('[data-go=library]'); chk("library shows Windows card", pg.locator('.lay',has_text="Windows").count()>=1)
    print("errors",errs); chk("no js errors", not errs); b.close()
shutil.rmtree(T,ignore_errors=True)
print("ALL PASS" if ok else "FAILED"); raise SystemExit(0 if ok else 1)
