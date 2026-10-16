const { chromium } = require('C:/Users/wcyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.screenshot({ path: path.join(__dirname, 'desktop-empty.png'), fullPage: true });
    assert.equal(await page.locator('#convert-button').isEnabled(), false);
    // Real DataTransfer drag/drop of all original exports.
    const originals = path.resolve(root, '../web_conversion/original gnss export');
    const files = fs.readdirSync(originals).filter(name => name.endsWith('.txt')).map(name => ({ name, text: fs.readFileSync(path.join(originals, name), 'utf8') }));
    const transfer = await page.evaluateHandle(files => {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(new File([file.text], file.name, { type: 'text/plain' }));
      return transfer;
    }, files);
    await page.locator('#drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
    await page.waitForFunction(() => document.getElementById('point-count').textContent === '1,380');
    assert.equal(await page.locator('#file-list li').count(), 7);
    assert.equal(await page.locator('#issues-panel').isVisible(), false);
    assert.equal(await page.locator('#points-body tr').count(), 50);
    const firstRow = await page.locator('#points-body tr').first().innerText();
    assert.match(firstRow, /SC24.1/); assert.match(firstRow, /2.675/);
    assert.match(await page.locator('#page-label').innerText(), /Page 1 of 28/);
    await page.locator('#next-button').click();
    assert.match(await page.locator('#page-label').innerText(), /Page 2 of 28/);
    const preparedPromise = page.waitForEvent('download');
    await page.locator('#prepared-button').click();
    const prepared = await preparedPromise;
    const preparedText = fs.readFileSync(await prepared.path(), 'utf8');
    assert.equal(preparedText.trim().split('\n').length, 1381);
    assert.match(preparedText, /SC24.1,22.32571046,114.14086700,2.675/);
    await page.screenshot({ path: path.join(__dirname, 'desktop-imported.png'), fullPage: true });
    console.log('PASS: Actual drag/drop of 7 files, 1,380 points, exact Elevation mapping, pagination and full CSV download.');

    await page.locator('#clear-button').click();
    await page.locator('#example-button').click();
    await page.locator('#convert-button').click();
    await page.waitForFunction(() => document.getElementById('converted-count').textContent === '1', { timeout: 45000 });
    const resultRow = await page.locator('#points-body tr').innerText();
    for (const number of ['820358.910', '832590.508', '26.009']) assert.ok(resultRow.includes(number), number);
    assert.match(await page.locator('#notice').innerText(), /matches the expected result/);
    const resultPromise = page.waitForEvent('download');
    await page.locator('#results-button').click();
    const resultText = fs.readFileSync(await (await resultPromise).path(), 'utf8');
    assert.match(resultText, /820358.910,832590.508,26.009/);
    const jsonPromise = page.waitForEvent('download');
    await page.locator('#json-button').click();
    const json = JSON.parse(fs.readFileSync(await (await jsonPromise).path(), 'utf8'));
    assert.equal(json[0].pointName, 'Manual Example 3'); assert.equal(json[0].hkpd, 26.009);
    await page.screenshot({ path: path.join(__dirname, 'desktop-converted.png'), fullPage: true });
    console.log('PASS: Real API conversion directly from file://, precise reference result, CSV and JSON downloads.');

    // HTTP failure and retry are exercised with deliberate mock failures, never shown as live results.
    await page.locator('#clear-button').click();
    await page.locator('#file-input').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('Point name,Latitude,Longitude,Elevation\n<script>,22.32224,114.14118,23.128\nbad,0,114.14118,2') });
    await page.waitForFunction(() => document.getElementById('point-count').textContent === '1');
    assert.equal(await page.locator('#issues-panel').isVisible(), true);
    assert.equal(await page.locator('#points-body script').count(), 0);
    await page.route('https://www.geodetic.gov.hk/transform/v2/**', route => route.fulfill({ status: 503, body: 'Temporarily unavailable', headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.locator('#convert-button').click();
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('HTTP 503'));
    assert.equal(await page.locator('#converted-count').innerText(), '0');
    assert.equal(await page.locator('#convert-button').isEnabled(), true);
    await page.unroute('https://www.geodetic.gov.hk/transform/v2/**');
    await page.locator('#convert-button').click();
    await page.waitForFunction(() => document.getElementById('converted-count').textContent === '1', { timeout: 45000 });
    console.log('PASS: Rejected-row report, safe name rendering, network error handling and real retry.');

    // Verify stop against a pending request, then ensure the point remains resumable.
    await page.locator('#clear-button').click();
    await page.locator('#example-button').click();
    await page.route('https://www.geodetic.gov.hk/transform/v2/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await route.abort().catch(() => {});
    });
    await page.locator('#convert-button').click();
    await page.locator('#stop-button').click();
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Conversion stopped'));
    assert.equal(await page.locator('#ready-count').innerText(), '1');
    assert.equal(await page.locator('#convert-button').isEnabled(), true);
    await page.unroute('https://www.geodetic.gov.hk/transform/v2/**');
    console.log('PASS: Stop preserves remaining points for conversion.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow on mobile');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log('PASS: 390px mobile layout and no browser script errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
