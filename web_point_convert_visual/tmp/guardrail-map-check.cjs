const { chromium } = require('C:/Users/wcyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const C = require('../converter.js');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let server;
  const header = 'Point name,Latitude,Longitude,Elevation\n';
  async function importText(text, name = 'angles.txt') {
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(header + text) });
    await page.waitForFunction(() => !document.getElementById('angle-format').disabled);
  }
  try {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    assert.match(await page.locator('.datum-reminder').innerText(), /WGS84 latitude, longitude \+ ellipsoidal height.*HK80 northing, easting \+ height in mPD/);
    await importText('DMS,22°19\'20.064"N,114°8\'28.248"E,23.128\nDEC,22.33,114.15,2\nBAD,22 70 0,114 8 28,2');
    assert.equal(await page.locator('#point-count').innerText(), '2');
    assert.equal(await page.locator('#mini-map').getAttribute('data-point-count'), '2');
    assert.match(await page.locator('#notice').innerText(), /1 DMS → decimal/);
    assert.match(await page.locator('#points-body tr').first().innerText(), /22.32224/);
    assert.match(await page.locator('#points-body tr').first().innerText(), /DMS normalized/);
    assert.equal(await page.locator('#bound-south').innerText(), '22.322240000°');
    assert.equal(await page.locator('#bound-north').innerText(), '22.330000000°');
    assert.equal(await page.locator('#bound-west').innerText(), '114.141180000°');
    assert.match(await page.locator('#map-status').innerText(), /start.cmd/);
    await page.locator('#issues-panel').evaluate(node => { node.open = true; });
    assert.match(await page.locator('#issues-list').innerText(), /minutes and seconds must each be less than 60/);
    await page.screenshot({ path: path.join(__dirname, 'guardrails-desktop.png'), fullPage: true });
    console.log('PASS: DMS import normalization, rejected rows, explicit conversion reminder, bounding rectangle and coordinates.');
    await page.locator('#clear-button').click();
    assert.equal(await page.locator('#mini-map').isVisible(), false);
    assert.equal(await page.locator('#bound-north').innerText(), '—');
    assert.equal(await page.locator('#fit-map-button').isEnabled(), false);
    await page.locator('#angle-format').selectOption('packed');
    await importText('PACKED,22.1920064,114.0828248,23.128');
    assert.match(await page.locator('#notice').innerText(), /packed DMS → decimal/);
    assert.match(await page.locator('#points-body tr').innerText(), /22.32224/);
    await page.locator('#angle-format').selectOption('decimal');
    assert.match(await page.locator('#points-body tr').innerText(), /22.32224/); // existing records are not reinterpreted
    await page.locator('#clear-button').click();
    await importText('WRONG,22 19 20,114 8 28,23.128');
    assert.equal(await page.locator('#point-count').innerText(), '0');
    assert.match(await page.locator('#issues-list').innerText(), /DMS, but Decimal degrees/);
    console.log('PASS: Packed DMS explicit selection, format mismatch rejection, no reinterpretation, map clearing and single-location bounds.');

    server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '18081' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited ${code}`))); });
    await page.goto('http://127.0.0.1:18081');
    const originals = path.resolve(root, '../web_conversion/original gnss export');
    const files = fs.readdirSync(originals).filter(name => name.endsWith('.txt')).map(name => path.join(originals, name));
    const allPoints = files.flatMap(file => C.parseExport(fs.readFileSync(file, 'utf8')).points);
    const expected = C.coordinateBounds(allPoints);
    let tileReferrer;
    page.on('request', request => { if (request.url().startsWith('https://tile.openstreetmap.org/')) tileReferrer = request.headers().referer; });
    await page.locator('#file-input').setInputFiles(files);
    await page.waitForFunction(() => document.getElementById('mini-map').dataset.pointCount === '1380');
    for (const key of ['north', 'south', 'east', 'west']) assert.equal(await page.locator('#bound-' + key).innerText(), `${expected[key].toFixed(9)}°`);
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile').length > 0 && [...document.querySelectorAll('.leaflet-tile')].every(tile => tile.complete && tile.naturalWidth === 256), { timeout: 30000 });
    assert.ok(tileReferrer?.startsWith('http://127.0.0.1:18081'), 'OSM receives a valid local web referrer');
    assert.ok(await page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]').isVisible());
    assert.ok(await page.locator('#mini-map canvas').count() > 0);
    const canvas = page.locator('#mini-map canvas');
    const mapBox = await canvas.boundingBox();
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.screenshot({ path: path.join(__dirname, 'osm-survey-desktop.png'), fullPage: true });
    console.log('PASS: Real OSM background from local server, visible attribution, all 1,380 mapped points and exact survey bounds.');
    console.log('Survey bounding box:', JSON.stringify(expected));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, 'osm-survey-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: Mobile layout without page overflow or script errors.');
  } finally { await browser.close(); server?.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

