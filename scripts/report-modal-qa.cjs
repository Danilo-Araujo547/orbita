// Browser regression with synthetic data. All API calls are intercepted.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox']});
 const page=await browser.newPage();const gets=[],writes=[];
 const row={id:999,name:'Relatório QA',code:'qa',catalog_kind:'report',source:'local',enabled:false,reviewed:true,manual_enabled:false,output_format:'pdf',version:1,parameter_schema:{},components:[],keywords:[],description:''};
 await page.route('**/api/**',async route=>{
 const req=route.request(),u=new URL(req.url()),p=u.pathname;
 if(req.method()!=='GET'){writes.push(p);return route.fulfill({json:{...row,...req.postDataJSON(),version:2}});}
 gets.push(p+u.search);let body={results:[],count:0,next:null};
 if(p.endsWith('/auth/csrf/'))body={csrfToken:'qa'};
 else if(p.endsWith('/auth/session/'))body={username:'qa',units:[{id:1,slug:'qa',name:'QA',paused:false}],roles:{qa:'admin'},mode:'simulated'};
 else if(p.endsWith('/reports/inventory/'))body={components:0};
 else if(p.endsWith('/reports/999/'))body=row;
 else if(p.endsWith('/reports/'))body={results:[row],count:1,next:null};
 else if(p.endsWith('/report-recipients/users/'))body=[];
 if(p.endsWith('/reports/')&&writes.length)await new Promise(r=>setTimeout(r,700));
 await route.fulfill({json:body});
 });
 await page.goto(`${process.env.SCV_QA_URL || 'http://127.0.0.1:8080'}/relatorios?unit=qa`);
 await page.getByRole('button',{name:'Editar Relatório QA',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Buscar relatório',exact:true}).fill('QA');await page.waitForTimeout(500);
 let before=gets.length;
 await page.getByRole('button',{name:'Editar Relatório QA',exact:true}).click();await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.waitForTimeout(400);
 assert.equal(gets.slice(before).filter(url=>new URL(url,'http://qa').pathname==='/api/v1/reports/').length,0,'Closing without saving must not search again');
 console.log(JSON.stringify({phase:'cancel',newRequests:gets.slice(before),search:await page.getByRole('textbox',{name:'Buscar relatório',exact:true}).inputValue()}));
 before=gets.length;
 await page.getByRole('button',{name:'Editar Relatório QA',exact:true}).click();await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Salvar',exact:true}).click();
 await page.waitForTimeout(150);assert.equal(await page.getByRole('button',{name:'Editar Relatório QA',exact:true}).isVisible(),true,'Saving must keep the current list visible');console.log(JSON.stringify({phase:'saving',listVisible:await page.getByRole('button',{name:'Editar Relatório QA',exact:true}).isVisible()}));
 await page.waitForTimeout(900);assert.equal(await page.getByRole('textbox',{name:'Buscar relatório',exact:true}).inputValue(),'QA');assert.equal(gets.slice(before).filter(url=>url.includes('/report-connections/')||url.includes('/report-recipients/')||url.includes('/report-app-connections/')).length,0,'Saving must reuse lookup data');console.log(JSON.stringify({phase:'saved',newRequests:gets.slice(before),writes,search:await page.getByRole('textbox',{name:'Buscar relatório',exact:true}).inputValue()}));
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
