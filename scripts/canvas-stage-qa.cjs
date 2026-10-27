// Read-only browser QA. Every API request is mocked; writes are always aborted.
// Set CANVAS_QA_BLOCKS=100 for the stress profile; default is a quick AA smoke.
// Uses synthetic session/data; no real login, credential or report is accessed.
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
(async () => {
  console.log('QA: iniciando navegador');
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.name));
  page.on('console', m => {if (m.type() === 'error') errors.push(m.text().slice(0, 160));});
  const requestedBlocks = Math.max(1, Math.min(100, Number(process.env.CANVAS_QA_BLOCKS) || 1));
  const requestedPoints = Math.max(1, Math.min(500, Number(process.env.CANVAS_QA_POINTS) || 500));
  const rows = Array.from({length: requestedPoints}, (_, i) => [`P${i}`, i % 7]);
  const layout = {schema_version: 1, page: {width: 3000, height: 3000, columns: 24, background: '#ffffff'}, sources: [{id: 's', type: 'inline', columns: ['X', 'Y'], rows}], pages: [{id: 'p1', name: 'QA', blocks: Array.from({length: requestedBlocks}, (_, i) => ({id: `b${i}`, type: 'line', source_id: 's', x: 10 + i % 10 * 298, y: 10 + Math.floor(i / 10) * 298, width: 280, height: 270, title: `Bloco ${i}`, options: {x_field: 'X', y_fields: ['Y']}}))}]};
  await page.route('**/api/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') { writes.push(path); return route.abort('blockedbyclient'); }
    let body = {};
    if (path.endsWith('/auth/csrf/')) body = {csrfToken: 'synthetic-qa'};
    else if (path.endsWith('/auth/session/')) body = {username: 'qa', units: [{id: 1, slug: 'qa', name: 'QA', paused: false}], roles: {qa: 'admin'}, mode: 'simulated'};
    else if (path.endsWith('/reports/999/canvas/')) body = {version: 1, layout, enabled: false, output_format: 'pdf', sources: [], assets: [], monthly_goals: []};
    else if (path.endsWith('/reports/999/')) body = {id: 999, name: 'QA sintético', version: 1, parameter_schema: {}};
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:8091/relatorios/999/canvas?unit=qa');
  await page.waitForSelector('.cv-block', {timeout: 60000});
  await page.waitForTimeout(2500);
  console.log('QA: folha carregada');
  const blockCount = await page.locator('.cv-block').count();
  await page.evaluate(() => {
    window.qaLongTasks = [];
    new PerformanceObserver(list => window.qaLongTasks.push(...list.getEntries().map(e => e.duration))).observe({type: 'longtask'});
    window.qaChangedBlocks = new Set();
    new MutationObserver(mutations => { for (const m of mutations) {const el = m.target.nodeType === 1 ? m.target : m.target.parentElement; const b = el?.closest?.('.cv-block'); if (b) window.qaChangedBlocks.add(b.getAttribute('aria-label'));} }).observe(document.querySelector('.cv-stage'), {attributes: true, childList: true, subtree: true});
  });
  const first = page.locator('.cv-block').first();
  const box = await first.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {await page.mouse.move(box.x + box.width / 2 + i * 2, box.y + box.height / 2 + i); await page.waitForTimeout(20);}
  const dragStyle = await first.evaluate(el => ({transform: getComputedStyle(el).transform, containment: getComputedStyle(el.querySelector(".cv-block-inner")).contain}));
  await page.mouse.up();
  await page.waitForTimeout(200);
  const perf = await page.evaluate(() => ({longTasksOver100: window.qaLongTasks.filter(v => v > 100), changedBlockDOMs: window.qaChangedBlocks.size}));
  perf.dragStyle = dragStyle;
  console.log(JSON.stringify({phase: 'drag', perf}));
  const accessibility = {};
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    const results = await new AxeBuilder({page}).include('.cv-root').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    console.log(`QA: axe ${theme} concluído`);
    accessibility[theme] = results.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length, details: v.nodes.map(n => ({target: n.target, summary: n.failureSummary}))}));
  }
  await page.setViewportSize({width: 1100, height: 850});
  await page.waitForTimeout(250);
  const overflow1100 = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  // Natural Tab must actually move focus outside a selected block to controls.
  await page.locator('.cv-block').last().focus();
  await page.keyboard.press('Tab');
  const focusAfterLastBlock = await page.evaluate(() => ({tag: document.activeElement.tagName, remainsBlock: document.activeElement.classList.contains('cv-block')}));
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Shift+1');
  const statusLive = await page.locator('[role="status"][aria-live="polite"]').count();
  console.log(JSON.stringify({synthetic: true, blockCount, pointsPerChart: requestedPoints, perf, accessibility, overflow1100, focusAfterLastBlock, statusLive, consoleErrors: errors, attemptedWrites: writes}));
  await browser.close();
})().catch(e => {console.error(e); process.exit(1);});
