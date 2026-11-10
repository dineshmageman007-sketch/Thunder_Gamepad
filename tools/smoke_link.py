# Link test with a fake WebSocket: direct page->PC socket, merge, rumble throttle, retry, fallback. python3 tools/smoke_link.py
import json, os
from playwright.sync_api import sync_playwright
WWW=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","app","src","main","assets","www","index.html")
INIT="""window.__socks=[];window.__nbc=0;
class FakeWS{constructor(u){this.url=u;this.readyState=0;this.sent=[];this.bufferedAmount=0;window.__socks.push(this)}send(x){this.sent.push(x)}close(){this.readyState=3}}
window.WebSocket=FakeWS;
window.NativeBridge={connect(){window.__nbc++},disconnect(){},send(){},vibrate(){},keepAwake(){},immersive(){},importFile(){},exportFile(){},exitApp(){},discover(){},keepWifi(){}};
window.opn=i=>{const s=__socks[i];s.readyState=1;s.onopen()};
window.msg=(i,o)=>__socks[i].onmessage({data:JSON.stringify(o)});
window.drop=i=>{const s=__socks[i];s.readyState=3;s.onclose()};"""
ok=[]
def chk(n,c): ok.append(c); print(("PASS " if c else "FAIL ")+n)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":844,"height":390}); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e))); pg.add_init_script(INIT); pg.goto("file://"+WWW)
    pg.evaluate("Link.conn.host='10.0.0.5';Link.conn.pcs={pcA:{name:'PC',host:'10.0.0.5',port:8766,token:'TK1'}};Link.conn.pc='pcA';window.__rum=0;Link.on(e=>{if(e&&e.type==='rumble')window.__rum++});Link.connect()")
    chk("direct socket to ws://host:port/ws, bridge NOT used", pg.evaluate("__socks.length==1&&__socks[0].url=='ws://10.0.0.5:8766/ws'&&__nbc==0"))
    pg.evaluate("opn(0)"); chk("hello sent on open", json.loads(pg.evaluate("__socks[0].sent[0]")).get("token")=="TK1")
    pg.evaluate("msg(0,{t:'welcome',host:'PC',pad:'xbox'})"); chk("welcome -> open", pg.evaluate("Link.state")=="open")
    pg.evaluate("Link.send({t:'key',k:'w',d:1})"); chk("send goes straight out", json.loads(pg.evaluate("__socks[0].sent.at(-1)"))["k"]=="w")
    pg.evaluate("__socks[0].bufferedAmount=9000;Link.send({t:'mmove',dx:1,dy:2});Link.send({t:'mmove',dx:3,dy:4});__socks[0].bufferedAmount=0;Link.send({t:'mmove',dx:5,dy:6})")
    chk("every mouse move is sent as its own message at once (v3 style, no merging)", pg.evaluate("__socks[0].sent.filter(x=>x.includes('mmove')).length")==3 and json.loads(pg.evaluate("__socks[0].sent.at(-1)"))=={"t":"mmove","dx":5,"dy":6})
    pg.evaluate("msg(0,{t:'rumble',l:200,s:50});msg(0,{t:'rumble',l:210,s:50});msg(0,{t:'rumble',l:0,s:0})")
    chk("rumble flood throttled, stop always passes", pg.evaluate("__rum")==2)
    pg.evaluate("drop(0)"); chk("drop -> closed", pg.evaluate("Link.state")=="closed"); pg.wait_for_timeout(1400)
    chk("auto-retry opens a new socket", pg.evaluate("__socks.length")==2)
    pg.evaluate("opn(1);msg(1,{t:'welcome',host:'PC',pad:'xbox'});Link.disconnect()"); pg.wait_for_timeout(1400)
    chk("manual disconnect does NOT retry", pg.evaluate("__socks.length")==2)
    pg.evaluate("Link.connect()"); pg.evaluate("opn(2);msg(2,{t:'denied'});drop(2)")
    chk("denied stays denied", pg.evaluate("Link.state")=="denied")
    pg.evaluate("Link.want=false;Link.connect();__socks.at(-1).onerror()")
    chk("fallback OFF by default: no native route, clear error", pg.evaluate("__nbc==0&&Link.state=='failed'&&/Compatibility/.test(Link.err)"))
    pg.evaluate("localStorage.setItem('padlink.settings',JSON.stringify({nativeFallback:true}));Link.want=false;Link.connect();__socks.at(-1).onerror()")
    chk("fallback ON in settings: native route used (once)", pg.evaluate("__nbc")==1)
    # --- new pairing flow + auto reconnect
    pg.evaluate("localStorage.setItem('padlink.settings',JSON.stringify({nativeFallback:false}));Link.disconnect();Link.conn.pcs={};Link.conn.pc='';Link.conn.host='10.0.0.9';Link.connect()")
    i = pg.evaluate("__socks.length-1"); pg.evaluate("opn(%d)" % i)
    chk("never-paired phone sends an empty token", json.loads(pg.evaluate("__socks[%d].sent[0]" % i)).get("token")=="")
    pg.evaluate("msg(%d,{t:'pending',secs:30})" % i); chk("pending state while the PC asks", pg.evaluate("Link.state")=="pending")
    pg.evaluate("msg(%d,{t:'paired',token:'NEWTOK'});msg(%d,{t:'welcome',host:'DESK',pad:'xbox',pcid:'pc77'})" % (i, i))
    chk("Allow -> open, token + PC remembered", pg.evaluate("Link.state=='open'&&Link.conn.pc=='pc77'&&Link.conn.pcs.pc77.token=='NEWTOK'&&Link.conn.pcs.pc77.host=='10.0.0.9'"))
    pg.evaluate("Link.disconnect();Link.conn.host='';Link.connect=Link.connect;Link.autoStart()")
    j = pg.evaluate("__socks.length-1"); pg.evaluate("opn(%d)" % j)
    chk("autoStart reconnects to the remembered PC with its token", json.loads(pg.evaluate("__socks[%d].sent[0]" % j)).get("token")=="NEWTOK" and pg.evaluate("__socks[%d].url" % j)=="ws://10.0.0.9:8766/ws")
    pg.evaluate("Link.disconnect();Link.autoMode=true;Link.want=true;Link.state='failed';Native.onMessage(JSON.stringify({t:'found',list:[{name:'DESK',host:'10.0.0.44',port:8766,pcid:'pc77'}]}))")
    chk("PC got a new IP -> found by pcid, address updated and reconnected", pg.evaluate("Link.conn.host=='10.0.0.44'&&Link.conn.pcs.pc77.host=='10.0.0.44'&&__socks.at(-1).url=='ws://10.0.0.44:8766/ws'"))
    for reason, rx in (("blocked", "blocked"), ("timeout", "in time"), ("busy", "Another phone")):
        pg.evaluate("Native.onMessage(JSON.stringify({t:'denied',reason:'%s'}))" % reason)
        chk("denied(%s) -> clear message" % reason, pg.evaluate("Link.state=='denied'&&/%s/.test(Link.err)" % rx))
    chk("no js errors", not errs); b.close()
print("ALL PASS" if all(ok) else "SOME FAILED")
