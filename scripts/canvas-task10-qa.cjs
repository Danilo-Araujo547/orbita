// Read-only staging QA. Authenticated report data is synthetic; all mutations blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 const page=await context.newPage();
 const failures=[],writes=[],calls=[];
 page.on('pageerror',e=>failures.push(e.message));
 // Verify the real staging proxy before installing synthetic authenticated fixtures.
 const probe=await context.request.post('http://127.0.0.1:8091/api/v1/reports/6/canvas-source-preview/?unit=ame',{data:{source:{id:'s',type:'report',report_id:6},limit:50}});
 assert.equal(probe.status(),401);
 let mode='parameters', reportId=6, revision=1;
 const columns=['Categoria','Quantidade'];
 const rows=Array.from({length:50},(_,i)=>['Grupo '+i,i+1]);
 const layout=()=>({schema_version:1,page:{width:1000,height:1250,columns:24,background:'#ffffff'},sources:[{id:'s',type:'report',report_id:6}],pages:[{id:'p',name:'QA',blocks:(reportId===6?['table','table']:['kpi','bar','line','pie']).map((type,i)=>({id:'b'+i,type,source_id:'s',title:type,x:35+(i%2)*480,y:50+Math.floor(i/2)*400,width:440,height:330,options:{x_field:'Categoria',y_fields:['Quantidade'],value_field:'Quantidade',aggregate:'sum'}}))}]});
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/canvas-source-preview/')){
   calls.push({mode,body:req.postDataJSON()});
   if(mode==='parameters') assert.equal(req.postDataJSON().source.parameters.year,2026);
   if(['400','403','404'].includes(mode))return route.fulfill({status:Number(mode),json:{detail:mode==='400'?'Parâmetros inválidos.':mode==='403'?'Permission denied.':'Not found.'}});
   await new Promise(r=>setTimeout(r,200));
   return route.fulfill({json:{columns:columns.map((name,i)=>({name,type:i?'number':'text'})),rows:mode==='empty'?[]:rows,total_rows:mode==='empty'?0:120,truncated:mode!=='empty'}});
  }
  if(req.method()!=='GET'){writes.push(path);return route.abort('blockedbyclient');}
  let body={};
  if(path.endsWith('/auth/csrf/'))body={csrfToken:'synthetic'};
  else if(path.endsWith('/auth/session/'))body={username:'qa',units:[{id:1,slug:'ame',name:'QA',paused:false}],roles:{ame:'admin'},mode:'simulated'};
  else if(/\/reports\/\d+\/canvas\/$/.test(path))body={version:revision,layout:layout(),enabled:false,output_format:'pdf',sources:[{id:6,name:'Fonte QA',code:'qa',columns}],assets:[],monthly_goals:[]};
  else if(/\/reports\/\d+\/$/.test(path))body={id:reportId,name:'QA sintético '+reportId,version:revision,parameter_schema:mode==='parameters'?{year:{type:'integer',label:'Ano'}}:{}};
  return route.fulfill({json:body});
 });
 const open=async id=>{
  reportId=id;revision++;
  await page.goto('http://127.0.0.1:8091/relatorios/'+id+'/canvas?unit=ame');
  await page.locator('.cv-block').first().waitFor();
  // Preferences can preserve preview mode between visits.
  await page.getByRole('button',{name:'Dados: Prévia',exact:true}).click();
 };
 await open(6);
 await page.locator('.cv-block').first().getByText('Preencha os parâmetros: Ano.',{exact:true}).waitFor();
 assert.equal(calls.length,0);
 await page.locator('.cv-block').first().getByLabel('Ano *').fill('2026');
 await page.locator('.cv-block').first().getByRole('button',{name:'Tentar de novo'}).click();
 await page.locator('.cv-block-table').first().getByText('Grupo 0',{exact:true}).waitFor();
 assert.equal(calls.length,1); // Shared source, one request for two blocks.
 assert.equal(await page.locator('.cv-origin-chip').filter({hasText:'Prévia · 50 linhas'}).count(),2);
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  await page.screenshot({path:'/shots/report6-synthetic-'+theme+'.png',fullPage:true});
 }
 mode='ready';
 await open(999);
 await page.locator('.cv-block-kpi .cv-kpi-value').filter({hasText:'1.275'}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.cv-block-bar svg path.recharts-rectangle').length>0);
 await page.waitForFunction(()=>document.querySelectorAll('.cv-block-line .recharts-line-curve').length>0);
 await page.waitForFunction(()=>document.querySelectorAll('.cv-block-pie .recharts-pie-sector').length>0);
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  await page.screenshot({path:'/shots/charts-synthetic-'+theme+'.png',fullPage:true});
 }
 for(const status of ['400','403','404']){
  mode=status; await open(999);
  await page.locator('.cv-block-kpi').getByText(/Não foi possível carregar a prévia/).waitFor();
  if(status!=='400')assert.match(await page.locator('.cv-block-kpi').innerText(),/Sem permissão|Fonte ou rota/);
  mode='ready';
  await page.locator('.cv-block-kpi').getByRole('button',{name:'Tentar de novo'}).click();
  await page.locator('.cv-block-kpi .cv-kpi-value').filter({hasText:'1.275'}).waitFor();
 }
 mode='empty'; await open(999);
 await page.getByText('A fonte não retornou linhas para estes parâmetros',{exact:true}).first().waitFor();
 assert.equal(await page.getByText('A fonte não retornou linhas para estes parâmetros',{exact:true}).count(),4);
 mode='ready';
 await page.locator('.cv-block-kpi').getByRole('button',{name:'Tentar de novo'}).click();
 await page.locator('.cv-block-kpi .cv-kpi-value').filter({hasText:'1.275'}).waitFor();
 assert.equal(await page.locator('.cv-unsaved-dot').count(),0);
 assert.deepEqual(writes,[]);assert.deepEqual(failures,[]);
 assert.ok(calls.every(c=>c.body.limit===50));
 console.log(JSON.stringify({realProxyUnauthenticatedStatus:probe.status(),authenticatedData:'synthetic',report6Table:true,sharedSource:true,requiredParameters:true,kpi:1275,bar:true,line:true,pie:true,errors400403404AndRetry:true,emptyAndRetry:true,screenshots:4,previewRequests:calls.length,writes,failures}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
