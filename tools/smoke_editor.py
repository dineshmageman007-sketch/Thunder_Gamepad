# Headless smoke test of the Editor.  LAYOUT=path/to/layout.json python3 tools/smoke_editor.py
import json, os, time
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
WWW=os.path.join(HERE,"..","app","src","main","assets","www","index.html")
lay=json.load(open(os.environ.get("LAYOUT","Genshin_layout.json")))
init="""window.__sent=[];window.NativeBridge={connect(){},disconnect(){},send(s){window.__sent.push(JSON.parse(s))},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){}};
localStorage.setItem('padlink.seeded','1');localStorage.setItem('padlink.layouts', %s);""" % json.dumps(json.dumps({"g1":{"name":"Genshin","data":lay,"edited":1}}))
ok=True
def check(name,cond,extra=""):
    global ok; ok&=bool(cond); print(("PASS " if cond else "FAIL ")+name, extra)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390})
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.add_init_script(init); pg.goto("file://"+os.path.abspath(WWW))
    saved=lambda: json.loads(pg.evaluate("localStorage.getItem('padlink.layouts')"))["g1"]["data"]
    # macro text round trip for every macro in the layout
    res=pg.evaluate("""(L)=>L.layout.filter(i=>i.action&&i.action.kind==='macro').map(i=>{const t=Editor._dsl.formatMacro(i.action.steps);return JSON.stringify(Editor._dsl.parseMacro(t))===JSON.stringify(i.action.steps)})""", lay)
    check("macro text round-trip", all(res), f"{len(res)} macros")
    pg.click('[data-go=library]'); pg.click('[data-a=edit]'); pg.wait_for_selector('#edStage .el')
    n=pg.locator('#edStage .el').count(); check("editor renders items (fullscreen+reload buttons stripped)", n==34, n)
    # --- floating toolbar: two rows, <= half width, draggable, position remembered
    bb0=pg.locator('#edBar').bounding_box(); vw=pg.viewport_size['width']
    check("toolbar at most half the width", bb0['width']<=vw*0.51+1, (round(bb0['width']),vw))
    r1=pg.locator('#edBar .r1').bounding_box(); tb=pg.locator('#edTabs').bounding_box()
    check("toolbar has two rows", tb['y']>=r1['y']+r1['height']-1, (r1['y'],tb['y']))
    g=pg.locator('#edGrip').bounding_box(); gx,gy=g['x']+g['width']/2,g['y']+g['height']/2
    pg.mouse.move(gx,gy); pg.mouse.down(); pg.mouse.move(gx+300,gy+120,steps=8); pg.mouse.up(); time.sleep(0.2)
    bb1=pg.locator('#edBar').bounding_box()
    check("toolbar dragged by grip", abs(bb1['x']-bb0['x']-300)<3 and abs(bb1['y']-bb0['y']-120)<3, (bb0['x'],bb0['y'],bb1['x'],bb1['y']))
    check("toolbar position saved", pg.evaluate("!!localStorage.getItem('padlink.edbar')"))
    pg.mouse.move(bb1['x']+bb1['width']/2,bb1['y']+8); pg.mouse.down(); pg.mouse.move(-500,-500,steps=4); pg.mouse.up()
    gb=pg.locator('#edGrip').bounding_box(); check("toolbar cannot leave the screen", gb['x']>=0 and gb['y']>=0)
    pg.click('#edAdd'); mb=pg.locator('#edAddMenu').bounding_box(); ab=pg.locator('#edAdd').bounding_box()
    check("add menu opens under the Add button", mb['y']>=ab['y']+ab['height']-1 and abs(mb['x']-ab['x'])<6, (mb['x'],mb['y'],ab['x'],ab['y']))
    pg.click('#edAdd')
    # park the toolbar mid-screen, away from the controls the test clicks
    g=pg.locator('#edGrip').bounding_box(); pg.mouse.move(g['x']+15,g['y']+15); pg.mouse.down(); pg.mouse.move(vw*0.30+15,pg.viewport_size['height']*0.30+15,steps=8); pg.mouse.up(); time.sleep(0.2)
    # select Jump, edit label via inspector
    bb=pg.locator('#edStage .el',has_text="Jump").first.bounding_box(); x,y=bb['x']+bb['width']/2,bb['y']+bb['height']/2
    pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.up()
    check("inspector opens", pg.locator('#edDrawer [data-f=label]').count()==1)
    pg.fill('#edDrawer [data-f=label]',"Leap"); time.sleep(0.4)
    check("label saved to storage", any(i.get("label")=="Leap" for i in saved()["layout"]))
    # drag
    pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.move(x-120,y+40,steps=6); pg.mouse.up(); time.sleep(0.3)
    it=[i for i in saved()["layout"] if i["label"]=="Leap"][0]; check("drag moved item", it["x"]<87 and it["y"]>49, (it["x"],it["y"]))
    # resize via handle
    hb=pg.locator('#edHandle').bounding_box(); s0=it["s"]
    pg.mouse.move(hb['x']+13,hb['y']+13); pg.mouse.down(); pg.mouse.move(hb['x']+60,hb['y']+60,steps=5); pg.mouse.up(); time.sleep(0.3)
    it=[i for i in saved()["layout"] if i["label"]=="Leap"][0]; check("resize handle changes size", it["s"]!=s0, (s0,it["s"]))
    # undo x3 -> label back
    depth=pg.evaluate("1") 
    for k in range(6):
        if pg.locator('#edUndo[disabled]').count(): break
        pg.click('#edUndo'); time.sleep(0.15)
    time.sleep(0.3); jj=[i for i in saved()["layout"] if i["id"]=="2stc4kqz8"][0]
    check("undo restores original", jj["label"]=="Jump (A)" and jj["x"]==87 and jj["s"]==14, (jj["label"],jj["x"],jj["s"]))
    pg.click('#edRedo'); time.sleep(0.3)
    # macro editing through the text box
    pg.click('#edDrawerX'); pg.locator('#edStage .el',has_text="Map").first.click()
    pg.select_option('#edDrawer [data-f="action.kind"]',"pad"); time.sleep(0.2)
    check("kind change swaps action", [i for i in saved()["layout"] if i["id"]=="kdvmhupc9"][0]["action"]["kind"]=="pad")
    pg.click('#edUndo'); time.sleep(0.3)
    pg.fill('#edDrawer textarea[data-sp=macro]',"down pad:LB\nwait 50\nup pad:LB"); time.sleep(0.4)
    check("macro text -> steps", [i for i in saved()["layout"] if i["id"]=="kdvmhupc9"][0]["action"]["steps"]==[{"down":"pad:LB"},{"wait":50},{"up":"pad:LB"}])
    pg.fill('#edDrawer textarea[data-sp=macro]',"bogus 1"); check("macro error shown", "unknown step" in pg.inner_text('#edMacroErr'))
    # add + page + theme + JSON
    pg.click('#edAdd'); pg.click('[data-add=slider]'); time.sleep(0.3); check("add slider", any(i["type"]=="slider" for i in saved()["layout"]))
    pg.click('#edPanel'); check("layout panel via menu button", pg.locator('#edName').count()==1)
    pg.evaluate("document.querySelector('[data-c=background]').value='#112233';document.querySelector('[data-c=background]').dispatchEvent(new Event('input'))"); time.sleep(0.3)
    check("theme saved", saved()["settings"]["background"]=="#112233")
    pg.screenshot(path="editor_layout.png")
    pg.click('#edDrawerX'); pg.locator('#edStage .el',has_text="Skill").first.click(); pg.click('details:has-text("Advanced") summary')
    pg.fill('#edJson','{"type":"button","label":"Skill2","x":50,"y":50,"s":15,"action":{"kind":"pad","value":"RT"},"long":{"action":"pad:LT","ms":300}}'); pg.click('#edJsonApply'); time.sleep(0.3)
    check("JSON apply keeps long-press", any(i.get("long") for i in saved()["layout"]))
    pg.screenshot(path="editor_item.png")
    # Done -> library; Play -> HUD -> Edit -> Done returns to play
    pg.click('#edDone'); check("done returns to library", pg.evaluate("document.getElementById('editor').hidden") and pg.locator('#library.on').count()==1)
    pg.evaluate("Native.onMessage(JSON.stringify({t:'welcome',host:'PC',pad:'xbox'}))")
    pg.click('[data-a=play]'); pg.click('#hudGrip'); pg.click('[data-h=edit]'); pg.wait_for_selector('#edStage .el')
    check("play->edit hides play", pg.evaluate("document.getElementById('play').hidden"))
    pg.click('#edDone'); time.sleep(0.2); check("edit->play returns to play", not pg.evaluate("document.getElementById('play').hidden"))
    pg.click('#hudGrip'); pg.click('[data-h=exit]')
    # New layout uses the template
    pg.click('#newLayout'); pg.fill('#dlgI',"Fresh"); pg.click('#dlgOk'); time.sleep(0.2)
    st=json.loads(pg.evaluate("localStorage.getItem('padlink.layouts')")); check("new layout has Xbox template", any(len(v["data"]["layout"])==19 for v in st.values()))
    check("no JS errors", not errs, errs)
    b.close()
print("ALL PASS" if ok else "SOME FAILED")
