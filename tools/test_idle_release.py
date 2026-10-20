# how to run: python3 tools/test_idle_release.py  (needs node) - an idle release must NOT send "reset" (it made apps react)
import subprocess, textwrap
js = textwrap.dedent("""
global.window = global; const fs = require('fs'); eval(fs.readFileSync('app/src/main/assets/www/engine.js','utf8'));
const out=[]; Engine.setOutput(o=>out.push(o)); const H=Engine.create();
Engine.releaseAll(H,false);
console.log('idle:',JSON.stringify(out)); const idle=out.map(o=>o.t).join();
out.length=0; Engine.apply({kind:'key',value:'ctrl'},true,H,'a'); Engine.releaseAll(H,false);
console.log('held:',JSON.stringify(out)); const held=out.map(o=>o.t).join();
process.exit(idle==='axes0' && held.includes('reset') && held.includes('key') ? 0 : 1);
""")
r = subprocess.run(['node','-e',js],capture_output=True,text=True); print(r.stdout, r.stderr[:300])
print('PASS' if r.returncode==0 else 'FAIL'); raise SystemExit(r.returncode)
