const { chromium } = require('C:/Users/wcyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const downloads = async id => {
    const pending = page.waitForEvent('download'); await page.locator(id).click();
    const downloaded = await pending; return fs.readFileSync(await downloaded.path(), 'utf8');
  };
  const header = 'Point name,Latitude,Longitude,Elevation,Date,Time\n';
  try {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    const originals = path.resolve(root, '../web_conversion/original gnss export');
    const files = fs.readdirSync(originals).filter(name => name.endsWith('.txt')).map(name => path.join(originals, name));
    const transfer = await page.evaluateHandle(files => {
      const data = new DataTransfer();
      for (const file of files) data.items.add(new File([file.text], file.name, { type: 'text/plain' }));
      return data;
    }, files.map(file => ({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') })));
    await page.locator('#drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
    await page.waitForFunction(() => document.getElementById('point-count').textContent === '1,380');
    assert.equal(await page.locator('#unique-point-count').innerText(), '45');
    assert.equal(await page.locator('#points-body .group-row').count(), 45);
    assert.equal(await page.locator('#points-body .measurement-row').count(), 0);
    assert.match(await page.locator('#file-list').innerText(), /12 unique points · 360 measurements/);
    assert.match(await page.locator('#map-point-count').innerText(), /45 unique points · 1,380 measurements/);
    await page.locator('button[data-toggle-point="SC43"]').click();
    assert.equal(await page.locator('.measurement-row[data-point-id="SC43"]').count(), 30);
    assert.equal(await page.locator('button[data-toggle-point="SC43"]').getAttribute('aria-expanded'), 'true');
    await page.locator('button[data-toggle-point="SC61"]').click();
    const sc61 = page.locator('.measurement-row[data-point-id="SC61"]');
    assert.equal(await sc61.count(), 60);
    const recordIds = await sc61.evaluateAll(rows => rows.map(row => row.dataset.recordId));
    assert.equal(new Set(recordIds).size, 60);
    assert.equal(await sc61.locator('.point-name').filter({ hasText: /^SC61\.1$/ }).count(), 2);
    const before = recordIds.slice();
    await page.locator('#collapse-groups-button').click();
    assert.equal(await page.locator('.measurement-row').count(), 0);
    await page.locator('button[data-toggle-point="SC61"]').click();
    assert.deepEqual(await sc61.evaluateAll(rows => rows.map(row => row.dataset.recordId)), before);
    const prepared = await downloads('#prepared-button');
    assert.equal(prepared.trim().split('\n').length, 1381);
    await page.locator('#point-view').selectOption('measurements');
    assert.equal(await page.locator('.measurement-row').count(), 50);
    assert.equal(await page.locator('#page-label').innerText(), 'Page 1 of 28');
    await page.locator('#point-view').selectOption('grouped');
    await page.locator('#collapse-groups-button').click();
    await page.locator('button[data-toggle-point="SC43"]').click();
    await page.screenshot({ path: path.join(__dirname, 'grouped-originals-desktop.png'), fullPage: true });
    console.log('PASS: Drag/drop all 7 files → 45 unique IDs / 1,380 retained measurements; expandable SC43 (30), SC61 (60 across 2 files); unique record IDs survive collapse; full export and flat pagination retained.');

    await page.locator('#clear-button').click();
    const rows = 'SC43.1,22.32224,114.14118,23.128,2026-09-16,10:05:01\nSC43.2,22.323,114.142,23.128,2026-09-16,10:05:02\nSC43.3,22.324,114.143,23.128,2026-09-16,10:05:03\nSC44.1,22.325,114.144,23.128,2026-09-16,10:05:04';
    await page.locator('#file-input').setInputFiles({ name: 'stats-fixture.txt', mimeType: 'text/plain', buffer: Buffer.from(header + rows) });
    await page.waitForFunction(() => document.getElementById('point-count').textContent === '4');
    const calls = [];
    // Known fixture results deliberately test means/SD, partial groups and errors.
    await page.route('https://www.geodetic.gov.hk/transform/v2/**', async route => {
      const lat = new URL(route.request().url()).searchParams.get('lat'); calls.push(lat);
      const payload = lat === '22.32224' ? { hkN: 820358.910, hkE: 832590.508, hkpd: 26.009 }
        : lat === '22.323' ? { hkN: 820358.914, hkE: 832590.516, hkpd: 26.011 }
        : lat === '22.324' ? { ErrorCode: 4 } : { hkN: 820400, hkE: 832600, hkpd: 10 };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(payload) });
    });
    await page.locator('button[data-toggle-point="SC43"]').click();
    await page.locator('#convert-button').click();
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('3 of 4 measurements converted'));
    assert.equal(calls.length, 4); // Collapsing does not collapse API observations.
    const group = page.locator('.group-row[data-point-id="SC43"]');
    assert.deepEqual(await group.locator('.result-col').allTextContents(), ['820358.912', '832590.512', '26.010']);
    assert.match(await group.innerText(), /Mean of 2 \/ 3 converted measurements/);
    assert.match(await page.locator('.group-statistics').innerText(), /SD 0.002828/);
    const childIds = await page.locator('.measurement-row').evaluateAll(rows => rows.map(row => row.dataset.recordId));
    await page.locator('#output-order').selectOption('EN');
    assert.deepEqual(await group.locator('.result-col').allTextContents(), ['832590.512', '820358.912', '26.010']);
    assert.deepEqual(await page.locator('.measurement-row').evaluateAll(rows => rows.map(row => row.dataset.recordId)), childIds);
    const json = JSON.parse(await downloads('#json-button'));
    assert.equal(json.length, 4); assert.equal(new Set(json.map(point => point.recordId)).size, 4);
    assert.equal(json[0].pointId, 'SC43'); assert.equal(json[0].measurementIndex, '1');
    assert.equal(json[2].status, 'error'); assert.equal(json[2].pointName, 'SC43.3');
    const resultCsv = await downloads('#results-button');
    assert.match(resultCsv, /Point ID,Measurement index,Record ID/);
    assert.match(resultCsv, /SC43.1,832590.508,820358.910,26.009,SC43,1,/);
    const stats = await downloads('#statistics-button');
    assert.match(stats, /Failed measurements,hkE mean \(m\)/);
    assert.match(stats, /SC43,3,2,0,1,832590.512000,0.005657/);
    const coordinates = await downloads('#coordinate-button'); assert.equal(coordinates.trim().split('\n').length, 3);
    await page.locator('#playback-delay').selectOption('2000');
    await page.locator('#play-map-button').click(); await page.locator('#play-map-button').click();
    await page.locator('button[data-toggle-point="SC43"]').click();
    assert.equal(await page.locator('#mini-map').getAttribute('data-playback-state'), 'paused');
    assert.equal(await page.locator('#mini-map').getAttribute('data-visible-point-count'), '1');
    await page.locator('button[data-toggle-point="SC43"]').click();
    await page.screenshot({ path: path.join(__dirname, 'grouped-statistics-desktop.png'), fullPage: true });
    console.log('PASS: Every measurement converted independently; correct partial means and sample SD; failed reading retained; IDs/record provenance and EN order in downloads; collapsing preserves playback.');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, 'grouped-statistics-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#clear-button').click();
    assert.equal(await page.locator('#unique-point-count').innerText(), '0');
    assert.equal(await page.locator('#point-count').innerText(), '0');
    assert.deepEqual(errors, []);
    console.log('PASS: Mobile layout fits; clear resets counts and expansion; no script errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
