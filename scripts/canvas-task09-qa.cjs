// Synthetic browser regression against the staging bundle. Never touches a real report.
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 const context = await browser.newContext({viewport:{width:1440,height:1000}});
 const page = await context.newPage();
 const errors=[], writes=[]; let previewReady=false;
 page.on('pageerror', e=>errors.push(e.message));
 const columns=['Paciente','Quantidade','Data','Status'];
 const layout={schema_version:1,page:{width:900,height:1200,columns:24,background:'#ffffff'},sources:[{id:'dados',label:'dados',type:'report',report_id:6}],pages:[{id:'p1',name:'QA',blocks:[{id:'t',type:'table',title:'Tabela',source_id:'dados',x:40,y:50,width:450,height:220},{id:'x',type:'text',title:'Texto',text:'QA',x:520,y:350,width:220,height:80}]}]};
 await page.route('**/api/**', route=>{
  const req=route.request(), path=new URL(req.url()).pathname;
  if(path.endsWith('/canvas-source-preview/')) return route.fulfill({status:previewReady?200:404,contentType:'application/json',body:JSON.stringify(previewReady?{columns:columns.map((name,i)=>({name,type:['text','number','date','text'][i]})),rows:[['Prévia sintética',10,'2026-01-01','Teste']],total_rows:1}: {detail:'Not found.'})});
  if(req.method()!=='GET'){writes.push(path);return route.abort('blockedbyclient');}
  let body={};
  if(path.endsWith('/auth/csrf/')) body={csrfToken:'synthetic'};
  else if(path.endsWith('/auth/session/')) body={username:'qa',units:[{id:1,slug:'ame',name:'QA',paused:false}],roles:{ame:'admin'},mode:'simulated'};
  else if(path.endsWith('/reports/6/canvas/')) body={version:1,layout,enabled:false,output_format:'pdf',sources:[{id:6,name:'Relatório #6',code:'qa',datasets:[{id:'rows',name:'Registros',columns}]}],assets:[],monthly_goals:[]};
  else if(path.endsWith('/reports/6/')) body={id:6,name:'QA sintético',parameter_schema:{}};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:8091/relatorios/6/canvas?unit=ame');
 await page.waitForSelector('.cv-block-table');
 assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('cv-back-btn')));
 await page.locator('.cv-block-table').click({position:{x:100,y:70}});
 await page.locator('.cv-inspector').getByRole('tab',{name:'Dados',exact:true}).click();
 await page.getByText('dados · Relatório #6 › Registros',{exact:true}).waitFor();
 assert.match(await page.locator('.cv-lineage-text').innerText(),/4 de 4/);
 await page.locator('.cv-inspector').getByRole('tab',{name:'Conteúdo',exact:true}).click();
 assert.equal(await page.locator('.cv-inspector .cv-type-badge.is-text').count(),2);
 // The data mode control lives in the top toolbar.
 const dataButton=page.getByRole('button',{name:/Dados: Prévia/});
 await dataButton.click();
 await page.getByText(/servidor não respondeu à rota de prévia/).first().waitFor();
 assert.match(await page.locator('.cv-block-table .cv-origin-chip').innerText(),/Prévia/);
 previewReady=true;
 await page.locator('.cv-block-table').getByRole('button',{name:'Tentar de novo'}).click();
 await page.locator('.cv-block-table').getByText('Prévia sintética').waitFor();
 assert.match(await page.locator('.cv-block-table .cv-origin-chip').innerText(),/Prévia · 1 linhas/);
 const chip=await page.locator('.cv-block-table .cv-origin-chip').boundingBox();
 const table=await page.locator('.cv-block-table').boundingBox();
 assert.ok(chip.y+chip.height <= table.y);
 const originalHeight=(await page.locator('.cv-block-table').boundingBox()).height;
 await page.getByRole('button',{name:'Ajustar altura ao conteúdo',exact:true}).click();
 assert.ok((await page.locator('.cv-block-table').boundingBox()).height < originalHeight);
 // Drag the table to the other block: guides during movement, warning after release.
 const before=await page.locator('.cv-block-table').boundingBox();
 const scale=before.width/450;
 await page.locator('.cv-block-table').dispatchEvent('pointerdown',{button:0,clientX:before.x+100,clientY:before.y+60});
 await page.evaluate(({x,y})=>window.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y})),{x:before.x+100+410*scale,y:before.y+60+300*scale});
 await page.waitForTimeout(100);
 assert.ok(await page.locator('.cv-snap-guide').count()>0);
 await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup')));
 await page.locator('.cv-overlap-warning').waitFor();
 await page.keyboard.press('Alt+Shift+B');
 assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('cv-resize-handle-se')));
 await page.keyboard.press('ArrowDown');
 await page.getByRole('button',{name:/Problemas ·/}).click();
 await page.getByRole('button',{name:/Problemas ·/}).click();
 const a11y={};
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  await page.screenshot({path:`/qa/qa09-${theme}.png`});
  a11y[theme]=(await new AxeBuilder({page}).include('.cv-root').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));
 }
 await page.setViewportSize({width:1100,height:850});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
 await page.locator('.cv-back-btn').focus();
 await page.keyboard.press('Tab');
 assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('cv-report-title')));
 assert.equal(await page.locator('.cv-resizer[tabindex="0"]').count(),0);
 await page.keyboard.press('Alt+Shift+R');
 assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('cv-resizer-right')));
 assert.deepEqual(a11y,{light:[],dark:[]});
 assert.deepEqual(errors,[]); assert.deepEqual(writes,[]);
 console.log(JSON.stringify({synthetic:true,lineage:true,types:true,preview404Retry:true,badgeOutside:true,fitHeight:true,guides:true,overlap:true,keyboardResize:true,problemsStatus:true,tabOrder:true,overflow1100:false,a11y,errors,writes}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
