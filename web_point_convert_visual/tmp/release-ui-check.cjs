const { chromium } = require('C:/Users/wcyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const C = require('../converter');
const root = path.resolve(__dirname, '..');
(async () => {
 const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page = await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message)); let server;
 async function download(id){const pending=page.waitForEvent('download');await page.locator(id).click();const file=await pending;return {name:file.suggestedFilename(),text:fs.readFileSync(await file.path(),'utf8')}}
 try {
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);
  await page.locator('#example-button').click();
  const selectors=['.brand','.local-tag','h1','.intro','.eyebrow','h2','.small','.text-button','.button','.height-note','.mapping>div','.output-tags small','.page-footer','.datum-reminder p','#output-order','th','td','.point-name','.source-name','.group-toggle'];
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1050});
   const current=await page.evaluate(selectors=>Object.fromEntries(selectors.map(s=>[s,parseFloat(getComputedStyle(document.querySelector(s)).fontSize)])),selectors);
   const baseline=await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'styles-before-font.css'),'utf8')+'\n:root{font-size:16px}'});
   const old=await page.evaluate(selectors=>Object.fromEntries(selectors.map(s=>[s,parseFloat(getComputedStyle(document.querySelector(s)).fontSize)])),selectors);
   for(const selector of selectors)assert.ok(current[selector]-old[selector]>=2.666,`${width}px ${selector}: ${old[selector]} → ${current[selector]}`);
   await baseline.evaluate(node=>node.remove());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No page overflow at ${width}px`);
  }
  console.log('PASS: 20 existing text styles increased by at least 2pt on desktop and mobile; no page overflow.');
  server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'18083'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)))});
  await page.setViewportSize({width:1440,height:1050});
  await page.goto('http://127.0.0.1:18083');
  assert.equal(await page.locator('#output-order').inputValue(),'EN');
  assert.match(await page.locator('.page-footer').innerText(),/Anthony Wong/);
  await page.locator('#file-input').setInputFiles(path.join(root,'samples/demo_decimal.txt'));
  await page.waitForFunction(()=>document.getElementById('point-count').textContent==='6');
  assert.equal(await page.locator('#unique-point-count').innerText(),'2');
  await page.locator('#convert-button').click();
  await page.waitForFunction(()=>document.getElementById('converted-count').textContent==='6',{timeout:100000});
  const audit=JSON.parse((await download('#json-button')).text);
  const means=C.meanCoordinates(audit.map(p=>({...p,name:p.pointName,result:{hkN:p.hkN,hkE:p.hkE,hkpd:p.hkpd}})));
  const expectedRows=means.map(p=>`${p.pointId},${p.hkE.toFixed(3)},${p.hkN.toFixed(3)},${p.hkpd.toFixed(3)}`);
  const csv=await download('#results-button');
  assert.equal(csv.text,'\uFEFFID,Easting,Northing,mPD\r\n'+expectedRows.join('\r\n')+'\r\n');
  const txt=await download('#coordinate-button');assert.equal(txt.name,'coordinate.txt');assert.equal(txt.text,expectedRows.join('\r\n')+'\r\n');
  assert.equal(txt.text.charCodeAt(0),68); // Starts with DEMO, not a BOM/header.
  const detailed=await download('#measurements-button');assert.equal(detailed.text.trim().split('\n').length,7);assert.match(detailed.text,/Point ID,Measurement index,Record ID/);
  await page.locator('#output-order').selectOption('NE');
  assert.equal(await page.locator('#mean-first-heading').innerText(),'Northing');
  assert.match((await download('#results-button')).text,/^\uFEFFID,Northing,Easting,mPD\r\n/);
  assert.equal((await download('#coordinate-button')).text,means.map(p=>`${p.pointId},${p.hkN.toFixed(3)},${p.hkE.toFixed(3)},${p.hkpd.toFixed(3)}`).join('\r\n')+'\r\n');
  await page.locator('#output-order').selectOption('EN');
  assert.match(await page.locator('#mean-export-summary').innerText(),/2 of 2 unique point means ready/);
  console.log('PASS: Live conversion of synthetic sample; four-column mean CSV; direct coordinate.txt TXYZ/TYXZ; separate six-record audit; EN default and correct values.');
  fs.mkdirSync(path.join(root,'docs/images'),{recursive:true});
  await page.locator('.points-panel').screenshot({path:path.join(root,'docs/images/overview.png')});
  await page.locator('.mean-export-panel').screenshot({path:path.join(root,'docs/images/mean-export.png')});
  await page.screenshot({path:path.join(__dirname,'release-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(__dirname,'release-mobile.png'),fullPage:true});
  const guide=await page.goto('http://127.0.0.1:18083/docs/USER_GUIDE.html');assert.equal(guide.status(),200);
  await page.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
  assert.match(await page.locator('body').innerText(),/Anthony Wong/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(__dirname,'guide-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: Shareable screenshots use synthetic data only; printable guide, author credit and mobile layout verified.');
 }finally{await browser.close();server?.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
