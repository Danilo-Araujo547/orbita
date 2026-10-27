import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from './store.mjs';
function setup(t){const folder=mkdtempSync(join(tmpdir(),'scv-baileys-'));const s=new Store(folder,randomBytes(32).toString('hex'));t.after(()=>{s.db.close();rmSync(folder,{recursive:true,force:true});});return {s,folder};}
test('auth is encrypted and bound to unit and key',t=>{const {s}=setup(t);s.set('1','creds','private_credentials');assert.equal(s.get('1','creds'),'private_credentials');assert.equal(s.get('2','creds'),null);const raw=s.db.prepare('SELECT value FROM auth').get().value;assert.ok(!raw.includes('private_credentials'));assert.throws(()=>s.decrypt(raw,'2:creds'));s.clearAuth('1');assert.equal(s.get('1','creds'),null);});
test('outbound deduplication retains uncertain sends without retry',t=>{const {s}=setup(t);const data={content:'synthetic report'};assert.equal(s.claim('1','job:1',data),null);assert.equal(s.claim('1','job:1',data).state,'uncertain');assert.throws(()=>s.claim('1','job:1',{content:'changed'}));s.complete('1','job:1','provider-id');assert.equal(s.claim('1','job:1',data).state,'sent');assert.equal(s.claim('2','job:1',data),null);});
test('inbound redelivery is durable, encrypted, and deduplicated',t=>{const {s}=setup(t);s.putInbox('1','m1',{text:'private parameter'});s.putInbox('1','m1',{text:'other'});assert.equal(s.inbox().length,1);assert.equal(s.inbox()[0].payload.text,'private parameter');assert.ok(!s.db.prepare('SELECT payload FROM inbox').get().payload.includes('private parameter'));s.ack('1','m1');assert.equal(s.inbox().length,0);});
test('logs are scoped and bounded',t=>{const {s}=setup(t);for(let i=0;i<205;i++)s.log('1','connected');s.log('2','disconnected');assert.equal(s.logs('1').length,60);assert.ok(s.logs('1').every(x=>x.event==='connected'));assert.equal(s.db.prepare("SELECT count(*) AS n FROM logs WHERE unit='1'").get().n,200);assert.equal(s.logs('2').length,1);});
