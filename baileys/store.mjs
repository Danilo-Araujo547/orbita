import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
export class Store {
  constructor(folder, hexKey) {
    if (!/^[a-f0-9]{64}$/i.test(hexKey || '')) throw new Error('invalid_auth_key');
    mkdirSync(folder, {recursive: true, mode: 0o700});
    this.key = Buffer.from(hexKey, 'hex');
    this.db = new DatabaseSync(`${folder}/sessions.sqlite`);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS auth(unit TEXT, key TEXT, value TEXT, PRIMARY KEY(unit,key));
      CREATE TABLE IF NOT EXISTS sessions(unit TEXT PRIMARY KEY, desired INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, unit TEXT, time TEXT, event TEXT);
      CREATE TABLE IF NOT EXISTS inbox(unit TEXT, id TEXT, payload TEXT, created INTEGER, PRIMARY KEY(unit,id));
      CREATE TABLE IF NOT EXISTS sends(unit TEXT, id TEXT, hash TEXT, state TEXT, provider_id TEXT, PRIMARY KEY(unit,id));`);
  }
  encrypt(value, aad) {
    const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',this.key,iv);
    c.setAAD(Buffer.from(aad));
    return Buffer.concat([iv,c.update(value,'utf8'),c.final(),c.getAuthTag()]).toString('base64');
  }
  decrypt(value, aad) {
    const b=Buffer.from(value,'base64'), d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));
    d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8');
  }
  get(unit,key) {const row=this.db.prepare('SELECT value FROM auth WHERE unit=? AND key=?').get(unit,key);return row?this.decrypt(row.value,`${unit}:${key}`):null;}
  set(unit,key,value) {if(value===null)this.db.prepare('DELETE FROM auth WHERE unit=? AND key=?').run(unit,key);else this.db.prepare('INSERT OR REPLACE INTO auth VALUES(?,?,?)').run(unit,key,this.encrypt(value,`${unit}:${key}`));}
  log(unit,event) {this.db.prepare('INSERT INTO logs(unit,time,event) VALUES(?,?,?)').run(unit,new Date().toISOString(),event);this.db.prepare('DELETE FROM logs WHERE unit=? AND id NOT IN (SELECT id FROM logs WHERE unit=? ORDER BY id DESC LIMIT 200)').run(unit,unit);}
  logs(unit) {return this.db.prepare('SELECT id,time,event FROM logs WHERE unit=? ORDER BY id DESC LIMIT 60').all(unit);}
  clearAuth(unit) {this.db.prepare('DELETE FROM auth WHERE unit=?').run(unit);}
  desired(unit,on) {this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?)').run(unit,on?1:0);}
  desiredUnits() {return this.db.prepare('SELECT unit FROM sessions WHERE desired=1').all().map(x=>x.unit);}
  putInbox(unit,id,payload) {this.db.prepare('INSERT OR IGNORE INTO inbox VALUES(?,?,?,?)').run(unit,id,this.encrypt(JSON.stringify(payload),`${unit}:inbox:${id}`),Date.now());}
  inbox() {return this.db.prepare('SELECT * FROM inbox ORDER BY created LIMIT 30').all().map(r=>({...r,payload:JSON.parse(this.decrypt(r.payload,`${r.unit}:inbox:${r.id}`))}));}
  ack(unit,id) {this.db.prepare('DELETE FROM inbox WHERE unit=? AND id=?').run(unit,id);}
  claim(unit,id,payload) {
    const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const row=this.db.prepare('SELECT * FROM sends WHERE unit=? AND id=?').get(unit,id);
    if(row){if(row.hash!==hash)throw new Error('idempotency_conflict');return row;}
    this.db.prepare('INSERT INTO sends VALUES(?,?,?,?,?)').run(unit,id,hash,'uncertain','');return null;
  }
  complete(unit,id,providerId) {this.db.prepare("UPDATE sends SET state='sent',provider_id=? WHERE unit=? AND id=?").run(providerId,unit,id);}
}
