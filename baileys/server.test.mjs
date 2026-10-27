import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import net from 'node:net';
test('private HTTP API remains idle and blocks every send when disabled',async t=>{
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=mkdtempSync(join(tmpdir(),'scv-channel-http-')), token=randomBytes(32).toString('hex');
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,REPORT_BAILEYS_TOKEN:token,REPORT_BAILEYS_AUTH_KEY:randomBytes(32).toString('hex'),REPORT_BAILEYS_ALLOW_SENDS:'0'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}rmSync(dir,{recursive:true,force:true});});
 const root=`http://127.0.0.1:${port}`;let ready=false;
 for(let i=0;i<300;i++){try{const r=await fetch(root+'/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 assert.equal((await fetch(root+'/sessions/1')).status,401);
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 for(const unit of ['1','2']){const r=await fetch(root+`/sessions/${unit}`,{headers});const data=await r.json();assert.equal(data.state,'disconnected');assert.equal(data.qr,null);assert.equal(data.sends_enabled,false);}
 const blocked=await fetch(root+'/sessions/1/send',{method:'POST',headers,body:JSON.stringify({key:'test-1',to:'5511999990001',kind:'text',content:'Never sent'})});assert.equal(blocked.status,423);
 assert.equal((await blocked.json()).detail,'sends_disabled');
 assert.equal((await fetch(root+'/sessions/../auth',{headers})).status,404);
});
