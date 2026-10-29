"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../converter.js");
const sample = fs.readFileSync(
  path.join(__dirname, "../samples/demo_topcon.txt"),
  "utf8",
);

test("Topcon maps B/L/84H precisely and ignores Elevation and projected E/N/Z", () => {
  const result = C.parseExport(sample, "topcon.txt");
  assert.equal(result.profile, "Topcon");
  assert.match(result.fieldMapping, /84H → WGS84 height/);
  assert.deepEqual(result.issues, []);
  assert.equal(result.points.length, 4);
  const point = result.points[0];
  assert.equal(point.lat, "22.322240000000");
  assert.equal(point.long, "114.141180000000");
  assert.equal(point.elevation, "23.128");
  assert.equal(point.sourceFormat, "Topcon");
  const params = new URL(C.buildUrl(point)).searchParams;
  assert.equal(params.get("lat"), "22.322240000000");
  assert.equal(params.get("long"), "114.141180000000");
  assert.equal(params.get("h"), "23.128");
  assert.deepEqual(C.coordinateBounds(result.points), {
    south: 22.32223999,
    west: 114.14117999,
    north: 22.32234,
    east: 114.14128,
  });
});

test("Topcon requires unambiguous B/L/84H, with no fallback to Elevation or Z", () => {
  for (const [header, row, expected] of [
    ["Name,B,L,Z,Elevation", "P.1,22.32,114.14,99,10", /84H/],
    ["Name,B,84H,Elevation", "P.1,22.32,23,10", /column: L/],
    ["Name,L,84H,Elevation", "P.1,114.14,23,10", /column: B/],
    ["Name,B,L,84H,84H", "P.1,22.32,114.14,23,10", /ambiguous/],
  ])
    assert.throws(() => C.parseExport(header + "\n" + row), expected);
  const emptyHeight = C.parseExport(
    "Name,B,L,84H,Elevation\nP.1,22.32,114.14,,10",
  );
  assert.equal(emptyHeight.points.length, 0);
  assert.equal(emptyHeight.issues.length, 1);
});

test("Topcon column order, case, separators and DMS keep existing guardrails", () => {
  const parsed = C.parseExport(
    "84h\tl\tname\tb\televation\n23.128\t114 08 28.248\tP.1\t22 19 20.064\t10",
  );
  assert.deepEqual(parsed.issues, []);
  assert.equal(Number(parsed.points[0].lat), 22.32224);
  assert.equal(Number(parsed.points[0].long), 114.14118);
  assert.equal(parsed.formatCounts.dms, 1);
  const bad = C.parseExport(
    "Name,B,L,84H\nSWAPPED.1,114.14,22.32,23\nOUTSIDE.1,24,114.14,23\nHEIGHT.1,22.32,114.14,NaN",
  );
  assert.equal(bad.points.length, 0);
  assert.deepEqual(
    bad.issues.map((issue) => issue.line),
    [2, 3, 4],
  );
});

test("Topcon Start time supports chronological mixed-receiver playback and retains original", () => {
  const topcon = C.parseExport(sample).points;
  assert.deepEqual(topcon[0].collectedAt, {
    date: "2026-10-16",
    time: "09:32:30",
    original: "2026/10/16 09:32:30",
  });
  const standard = C.parseExport(
    "Point name,Latitude,Longitude,Elevation,Date,Time\nSTANDARD.1,22.32224,114.14118,23.128,2026-10-14,10:00:00",
  ).points;
  const sequence = C.collectionSequence([...topcon, ...standard]);
  assert.equal(sequence.mode, "time");
  assert.equal(sequence.points[0], standard[0]);
  assert.equal(sequence.points[1], topcon[2]);
  assert.deepEqual(sequence.points.slice(2), [topcon[0], topcon[1], topcon[3]]);
  for (const timestamp of [
    "2026/02/30 09:32:30",
    "2026/10/16 25:32:30",
    "unreadable",
    "",
  ]) {
    const parsed = C.parseExport(
      sample.replace("2026/10/16 09:32:30", timestamp),
    );
    assert.equal(parsed.points.length, 4);
    assert.equal(C.collectionSequence(parsed.points).mode, "import");
    assert.equal(parsed.points[0].collectedAt.original, timestamp);
  }
});

test("Topcon duplicate observation names retain compound point IDs and converted means", () => {
  const points = C.parseExport(sample).points.map((p, index) => ({
    ...p,
    recordId: `record-${index}`,
    status: "done",
    result: {
      hkE: 832590.508 + index,
      hkN: 820358.91 + index,
      hkpd: 26.009 + index,
    },
  }));
  const groups = C.groupMeasurements(points);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].pointId, "DEMO.010");
  assert.equal(groups[0].count, 3);
  assert.equal(points[0].name, points[1].name);
  assert.notEqual(points[0].recordId, points[1].recordId);
  assert.equal(
    C.coordinateText(points),
    "DEMO.010,832591.508,820359.910,27.009\r\nDEMO.020,832593.508,820361.910,29.009\r\n",
  );
  assert.equal(
    C.coordinateText(points, "NE"),
    "DEMO.010,820359.910,832591.508,27.009\r\nDEMO.020,820361.910,832593.508,29.009\r\n",
  );
  const csv = C.measurementsCsv(points);
  assert.match(csv, /Source format,Original collection timestamp/);
  assert.match(csv, /Topcon,2026\/10\/16 09:32:30/);
  const json = JSON.parse(C.resultsJson(points));
  assert.equal(json.length, 4);
  assert.equal(json[0].sourceFormat, "Topcon");
  assert.equal(json[0].collectedAt.original, "2026/10/16 09:32:30");
});
