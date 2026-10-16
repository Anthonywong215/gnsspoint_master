const { chromium } = require('C:/Users/wcyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let server;
  const header = 'Point name,Latitude,Longitude,Elevation,Date,Time\n';
  async function importText(rows) {
    await page.locator('#file-input').setInputFiles({ name: 'timed.txt', mimeType: 'text/plain', buffer: Buffer.from(header + rows) });
    await page.waitForFunction(() => !document.getElementById('angle-format').disabled);
  }
  async function downloadText(button) {
    const download = page.waitForEvent('download'); await page.locator(button).click();
    const file = await download;
    return { filename: file.suggestedFilename(), text: fs.readFileSync(await file.path(), 'utf8') };
  }
  try {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    assert.equal(await page.locator('#play-map-button').isEnabled(), false);
    assert.equal(await page.locator('#coordinate-button').isEnabled(), false);
    await importText('LATE,22.32224,114.14118,23.128,2026-09-16,10:05:03\nEARLY,22.323,114.142,23.128,2026-08-26,09:48:49\nMIDDLE,22.324,114.143,23.128,2026-09-03,14:42:57');
    assert.match(await page.locator('#playback-order').innerText(), /collection date\/time across all files/);
    await page.locator('#playback-delay').selectOption('2000');
    await page.locator('#play-map-button').click();
    await page.locator('#play-map-button').click();
    assert.equal(await page.locator('#mini-map').getAttribute('data-playback-state'), 'paused');
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '1');
    assert.match(await page.locator('#playback-status').innerText(), /EARLY · 2026-08-26 09:48:49/);
    await page.locator('#output-order').selectOption('EN');
    assert.equal(await page.locator('#mini-map').getAttribute('data-playback-state'), 'paused');
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '1');
    await page.waitForTimeout(160);
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '1');
    await page.locator('#playback-delay').selectOption('50');
    await page.locator('#play-map-button').click();
    await page.waitForFunction(() => document.getElementById('mini-map').dataset.playbackState === 'complete');
    assert.match(await page.locator('#playback-status').innerText(), /LATE · 2026-09-16 10:05:03/);
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '3');
    await page.locator('#play-map-button').click();
    await page.locator('#show-all-map-button').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#mini-map').getAttribute('data-playback-state'), 'idle');
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '3');
    console.log('PASS: Delayed chronological playback, recorded times, pause/resume, speed changes, replay and show-all; output switching preserves playback.');

    await page.locator('#clear-button').click();
    await importText('UNDATED,22.32224,114.14118,23.128,,\nDATED,22.323,114.142,23.128,2026-08-26,09:48:49');
    assert.match(await page.locator('#playback-order').innerText(), /file\/import order because 1/);
    await page.locator('#playback-delay').selectOption('2000');
    await page.locator('#play-map-button').click();
    assert.match(await page.locator('#playback-status').innerText(), /UNDATED · Collection date\/time unavailable/);
    await page.locator('#playback-delay').selectOption('50');
    await page.locator('#clear-button').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '0');
    assert.equal(await page.locator('#play-map-button').isEnabled(), false);
    console.log('PASS: Missing timestamps use explicit import order; clearing playback cancels timers and resets the map.');

    let apiCalls = 0;
    page.on('request', request => { if (request.url().startsWith('https://www.geodetic.gov.hk/transform/v2/?')) apiCalls++; });
    await page.locator('#example-button').click();
    await page.locator('#convert-button').click();
    await page.waitForFunction(() => document.getElementById('converted-count').textContent === '1', { timeout: 45000 });
    assert.equal(await page.locator('#output-first-heading').innerText(), 'hkE HK80 m');
    const resultCells = page.locator('#points-body tr').first().locator('td.result-col');
    assert.deepEqual(await resultCells.allTextContents(), ['832590.508', '820358.910', '26.009']);
    const enCsv = await downloadText('#results-button');
    assert.match(enCsv.filename, /_en_/);
    assert.match(enCsv.text, /Point name,hkE,hkN,hkpd/);
    assert.match(enCsv.text, /Manual Example 3,832590.508,820358.910,26.009/);
    const enTxt = await downloadText('#coordinate-button');
    assert.equal(enTxt.filename, 'gnss_hk1980_en_mpd.txt');
    assert.equal(enTxt.text, '832590.508,820358.910,26.009\r\n');
    const enJson = JSON.parse((await downloadText('#json-button')).text)[0];
    assert.equal(enJson.hkE, 832590.508); assert.equal(enJson.hkN, 820358.910);
    const callCount = apiCalls;
    await page.locator('#output-order').selectOption('NE');
    assert.deepEqual(await resultCells.allTextContents(), ['820358.910', '832590.508', '26.009']);
    assert.equal((await downloadText('#coordinate-button')).text, '820358.910,832590.508,26.009\r\n');
    assert.equal(apiCalls, callCount);
    await page.screenshot({ path: path.join(__dirname, 'output-order-desktop.png'), fullPage: true });
    console.log('PASS: Live LandsD result reorders actual table/CSV/TXT values; downloads have correct labels, XYZ TXT has no header/BOM/names, no reconversion on swap.');

    server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '18082' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited ${code}`))); });
    await page.goto('http://127.0.0.1:18082');
    const originals = path.resolve(root, '../web_conversion/original gnss export');
    const files = fs.readdirSync(originals).filter(name => name.endsWith('.txt')).reverse().map(name => path.join(originals, name));
    await page.locator('#file-input').setInputFiles(files);
    await page.waitForFunction(() => document.getElementById('point-count').textContent === '1,380');
    await page.locator('#playback-delay').selectOption('2000');
    await page.locator('#play-map-button').click();
    await page.locator('#play-map-button').click();
    assert.match(await page.locator('#playback-status').innerText(), /SC24.1 · 2026-08-26 09:48:49/);
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '1');
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile').length > 0 && [...document.querySelectorAll('.leaflet-tile')].every(tile => tile.complete && tile.naturalWidth === 256), { timeout: 30000 });
    await page.screenshot({ path: path.join(__dirname, 'playback-osm-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, 'playback-output-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: Real OSM, 1,380 points from files imported in reverse order, playback starts at earliest timestamp; mobile layout fits without errors.');
  } finally { await browser.close(); server?.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
