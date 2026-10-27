import { selectionText, listContent, listRelayOptions, buttonsContent, buttonsRelayOptions, documentFilename } from './interactive.mjs';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import makeWASocket, { initAuthCreds, BufferJSON, proto, DisconnectReason, makeCacheableSignalKeyStore, jidNormalizedUser, normalizeMessageContent, generateWAMessageFromContent } from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode';
import { Store } from './store.mjs';
const token=process.env.REPORT_BAILEYS_TOKEN || '';
if(token.length<40)throw new Error('missing_service_token');
const store=new Store(process.env.DATA_DIR||'/data',process.env.REPORT_BAILEYS_AUTH_KEY);
const allowSends=process.env.REPORT_BAILEYS_ALLOW_SENDS==='1';
const callback=process.env.REPORT_BAILEYS_CALLBACK||'http://api:8000/api/v1/report-whatsapp/inbound/';
const sessions=new Map(), logger=P({level:'silent'});
const validUnit=u=>/^[a-zA-Z0-9-]{1,64}$/.test(u||'');
function authState(unit) {
  const saved=store.get(unit,'creds');const creds=saved?JSON.parse(saved,BufferJSON.reviver):initAuthCreds();
  return {state:{creds,keys:{
    get:async(type,ids)=>{const out={};for(const id of ids){const raw=store.get(unit,`${type}:${id}`);if(raw){let v=JSON.parse(raw,BufferJSON.reviver);if(type==='app-state-sync-key')v=proto.Message.AppStateSyncKeyData.fromObject(v);out[id]=v;}}return out;},
    set:async(data)=>{store.db.exec('BEGIN');try{for(const[type,values]of Object.entries(data))for(const[id,value]of Object.entries(values))store.set(unit,`${type}:${id}`,value==null?null:JSON.stringify(value,BufferJSON.replacer));store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}}
  }},save:()=>store.set(unit,'creds',JSON.stringify(creds,BufferJSON.replacer))};
}
async function connect(unit) {
  let old=sessions.get(unit);if(old?.sock && ['connected','connecting','qr'].includes(old.status))return;
  const entry={status:'connecting',qr:null,qr_expires_at:null,account:'',sock:null,desired:true,retries:old?.retries||0};sessions.set(unit,entry);store.desired(unit,true);store.log(unit,'connecting');
  const auth=authState(unit);
  const sock=makeWASocket({auth:{creds:auth.state.creds,keys:makeCacheableSignalKeyStore(auth.state.keys,logger)},logger,markOnlineOnConnect:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false,browser:['SCV Messenger','Chrome','1.0.0'],getMessage:async()=>undefined});entry.sock=sock;
  sock.ev.on('creds.update',()=>{try{auth.save();}catch{store.log(unit,'auth_storage_error');}});
  sock.ev.on('connection.update',async u=>{
    if(sessions.get(unit)!==entry)return;
    if(u.qr){entry.qr=await QRCode.toDataURL(u.qr,{width:280,margin:2});entry.qr_expires_at=Date.now()+55000;entry.status='qr';store.log(unit,'qr_ready');}
    if(u.connection==='open'){entry.status='connected';entry.qr=null;entry.qr_expires_at=null;entry.account=(sock.user?.id||'').split(':')[0].split('@')[0];entry.retries=0;store.log(unit,'connected');}
    if(u.connection==='close'){
      entry.qr=null;entry.sock=null;
      const code=u.lastDisconnect?.error?.output?.statusCode;
      const loggedOut=code===DisconnectReason.loggedOut || code===DisconnectReason.badSession;
      entry.status=loggedOut?'logged_out':'disconnected';store.log(unit,loggedOut?'logged_out':'disconnected');
      if(loggedOut){store.clearAuth(unit);entry.desired=false;store.desired(unit,false);}
      else if(entry.desired){entry.retries++;const delay=code===DisconnectReason.restartRequired?1000:Math.min(60000,2000*2**Math.min(entry.retries,5));setTimeout(()=>{if(sessions.get(unit)===entry&&entry.desired)connect(unit).catch(()=>store.log(unit,'connection_error'));},delay);}
    }
  });
  sock.ev.on('message-receipt.update',updates=>{
    for(const update of updates){
      if(update.receipt?.readTimestamp)store.log(unit,'outbound_read');
      else if(update.receipt?.receiptTimestamp)store.log(unit,'outbound_delivered');
    }
  });
  sock.ev.on('messages.upsert',async({messages,type})=>{
    if(type!=='notify')return;
    for(const message of messages){
      try{
        if(message.key.fromMe || !message.key.id || !message.message)continue;
        const remote=message.key.remoteJid||'';if(remote==='status@broadcast'||remote.endsWith('@newsletter')||remote.endsWith('@broadcast'))continue;
        const group=remote.endsWith('@g.us');let sender=group?(message.key.participantAlt||message.key.participant):remote;
        if(!group&&sender?.endsWith('@lid'))sender=message.key.remoteJidAlt || await sock.signalRepository.lidMapping.getPNForLID(sender);
        if(!group&&!sender?.endsWith('@s.whatsapp.net')){store.log(unit,'unresolved_sender');continue;}
        const content=normalizeMessageContent(message.message);
        const text=selectionText(content);
        const address=group?remote:jidNormalizedUser(sender).split('@')[0];
        store.putInbox(unit,message.key.id,{unit_id:unit,message_id:message.key.id,address,is_group:group,text:text.slice(0,4000),timestamp:Number(message.messageTimestamp)||Math.floor(Date.now()/1000)});
      }catch{store.log(unit,'inbound_parse_error');}
    }
  });
}
async function disconnect(unit) {
  store.desired(unit,false);const s=sessions.get(unit);if(s){s.desired=false;s.status='disconnected';s.qr=null;const sock=s.sock;s.sock=null;sock?.end(new Error('operator_disconnect'));}store.log(unit,'operator_disconnected');
}
async function send(unit,data) {
  if(!allowSends)throw Object.assign(new Error('sends_disabled'),{status:423});
  const s=sessions.get(unit);if(s?.status!=='connected'||!s.sock)throw Object.assign(new Error('not_connected'),{status:409});
  if(!/^[a-zA-Z0-9:_.-]{1,180}$/.test(data.key||'')||!/^(?:[0-9]{8,15}|[0-9-]{5,90}@g\.us)$/.test(data.to||''))throw new Error('invalid_send');
  if(!['text','document','list','buttons'].includes(data.kind)||typeof data.content!=='string'||data.content.length>(data.kind==='document'?14*1024*1024:16000))throw new Error('invalid_content');
  const interactive=data.kind==='list'?listContent(data):data.kind==='buttons'?buttonsContent(data):null;
  const authorization=await fetch(callback.replace(/inbound\/$/,'authorize/'),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({unit_id:unit,key:data.key,to:data.to,mode:data.mode||'manual',event_id:data.event_id,policy:data.policy}),signal:AbortSignal.timeout(10000)});
  if(!authorization.ok)throw new Error('authorization_unavailable');
  if(!(await authorization.json()).allowed){store.log(unit,'send_blocked_policy');return {state:'blocked',provider_id:''};}
  const previous=store.claim(unit,data.key,data);if(previous)return {state:previous.state,provider_id:previous.provider_id};
  const to=data.to.endsWith('@g.us')?data.to:`${data.to}@s.whatsapp.net`;
  try{
    const payload=data.kind==='text'?{text:data.content}:{document:Buffer.from(data.content,'base64'),mimetype:data.mime||'application/pdf',fileName:documentFilename(data.filename)};
    let result;
    if(interactive){result=generateWAMessageFromContent(to,proto.Message.fromObject(interactive),{userJid:s.sock.user.id});await s.sock.relayMessage(to,result.message,(data.kind==='buttons'?buttonsRelayOptions(result.key.id):listRelayOptions(result.key.id)));}
    else result=await s.sock.sendMessage(to,payload);store.complete(unit,data.key,result?.key?.id||'');store.log(unit,data.kind==='list'?'list_accepted':'sent');return {state:'sent',provider_id:result?.key?.id||''};
  }catch{store.log(unit,'send_uncertain');return {state:'uncertain',provider_id:''};}
}
let flushing=false;
async function flushInbox(){if(flushing)return;flushing=true;try{for(const item of store.inbox()){
 if(Date.now()-item.created>30*60*1000){store.ack(item.unit,item.id);store.log(item.unit,'inbound_expired');continue;}
 try{const r=await fetch(callback,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(item.payload),signal:AbortSignal.timeout(15000)});if(!r.ok)continue;const data=await r.json();let retry=false;
 for(const action of data.actions||[]){try{await send(item.unit,action);}catch(e){if(e.message!=='sends_disabled')retry=true;}}
 if(!retry){store.ack(item.unit,item.id);store.log(item.unit,data.disabled?'inbound_disabled':'inbound_processed');}
 }catch{store.log(item.unit,'callback_unavailable');}
 }}finally{flushing=false;}}
setInterval(()=>flushInbox().catch(()=>{}),3000).unref();
function authorized(req){const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
async function readBody(req){let body='';for await(const part of req){body+=part;if(body.length>15*1024*1024)throw new Error('body_too_large');}return body?JSON.parse(body):{};}
http.createServer(async(req,res)=>{
 const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(req.url==='/health')return reply(200,{ok:true,sends_enabled:allowSends});
 if(!authorized(req))return reply(401,{detail:'unauthorized'});
 const match=/^\/sessions\/([a-zA-Z0-9-]+)(?:\/(connect|disconnect|send))?$/.exec(req.url||'');
 if(!match||!validUnit(match[1]))return reply(404,{detail:'not_found'});
 const unit=match[1],action=match[2];
 try{
  if(req.method==='GET'&&!action){const s=sessions.get(unit);return reply(200,{state:s?.status||'disconnected',account:s?.account||'',qr:s?.qr_expires_at>Date.now()?s.qr:null,qr_expires_at:s?.qr_expires_at||null,sends_enabled:allowSends,logs:store.logs(unit)});}
  if(req.method!=='POST')return reply(405,{detail:'method_not_allowed'});
  const body=await readBody(req);
  if(action==='connect'){await connect(unit);return reply(200,{state:'connecting'});}
  if(action==='disconnect'){await disconnect(unit);return reply(200,{state:'disconnected'});}
  if(action==='send')return reply(200,await send(unit,body));
  return reply(404,{detail:'not_found'});
 }catch(e){reply(e.status||400,{detail:['sends_disabled','not_connected','idempotency_conflict'].includes(e.message)?e.message:'service_operation_failed'});}
}).listen(Number(process.env.PORT||9322),'0.0.0.0',()=>console.log('SCV report transport ready; sends '+(allowSends?'enabled':'disabled')));
for(const unit of store.desiredUnits())connect(unit).catch(()=>store.log(unit,'restore_failed'));
process.on('SIGTERM',async()=>{for(const unit of sessions.keys()){const s=sessions.get(unit);s.desired=false;s.sock?.end(new Error('shutdown'));}process.exit(0);});
