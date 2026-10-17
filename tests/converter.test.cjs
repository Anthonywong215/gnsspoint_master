"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../converter.js");

test("Example 3 uses the exact government parameters and preserves input precision", () => {
  assert.equal(
    C.buildUrl(C.EXAMPLE),
    "https://www.geodetic.gov.hk/transform/v2/?inSys=wgsgeog&outSys=hkgrid&lat=22.32224&long=114.14118&h=23.128&inUnit=decDeg",
  );
  const url = new URL(
    C.buildUrl({
      ...C.EXAMPLE,
      lat: "22.32224000",
      long: "114.14118000",
      elevation: "23.128",
    }),
  );
  assert.equal(url.searchParams.get("long"), "114.14118000");
  assert.equal(url.searchParams.get("h"), "23.128");
  assert.equal(url.searchParams.has("name"), false);
});

test("named column extraction uses Elevation, never the separate Height", () => {
  const parsed = C.parseExport(
    "\uFEFFPoint name,Northing,Height,Latitude,Longitude,Elevation\r\nTEST.1,820000.000,99.999,22.32224000,114.14118000,23.128\r\n",
    "survey.txt",
  );
  assert.equal(parsed.points.length, 1);
  assert.deepEqual(parsed.points[0], {
    name: "TEST.1",
    pointId: "TEST",
    measurementIndex: "1",
    lat: "22.32224000",
    long: "114.14118000",
    elevation: "23.128",
    source: "survey.txt",
    line: 2,
    inputAngles: {
      latitude: "22.32224000",
      longitude: "114.14118000",
      latitudeFormat: "decimal",
      longitudeFormat: "decimal",
    },
  });
  assert.deepEqual(parsed.issues, []);
});

test("quoted names, escaped quotes, reordered columns, tabs and blank lines", () => {
  const text =
    '\nLongitude,Elevation,Point name,Latitude\r\n114.14118000,23.128,"SC, ""quoted""",22.32224000\r\n';
  const parsed = C.parseExport(text);
  assert.equal(parsed.points[0].name, 'SC, "quoted"');
  assert.equal(parsed.points[0].line, 3);
  const tabbed = C.parseExport(
    "LAT\tELEVATION\tPOINT_ID\tLON\n22.32224\t23.128\tP1\t114.14118",
  );
  assert.equal(tabbed.points[0].name, "P1");
  assert.equal(
    C.parseExport(
      "Point name;Latitude;Longitude;Elevation\nP1;22.32224;114.14118;23.128",
    ).points.length,
    1,
  );
});

test("invalid rows are reported with source lines and repeated observations are retained", () => {
  const parsed = C.parseExport(
    "Point name,Latitude,Longitude,Elevation\nP1,22.32224,114.14118,23.128\nP1,22.32224,114.14118,23.129\nP2,,114.14118,1\nP3,23,114.14118,1\nP4,22.32224,114.14118,\nP5,22.32224,114.14118,1,extra\nP6,22.32224,114.14118,0",
    "bad.txt",
  );
  assert.equal(parsed.rowCount, 7);
  assert.equal(parsed.points.length, 3);
  assert.equal(parsed.points[2].elevation, "0");
  assert.deepEqual(
    parsed.issues.map((issue) => issue.line),
    [4, 5, 6, 7],
  );
  assert.match(parsed.issues[0].message, /Latitude must be a number/);
});

test("missing Elevation, ambiguous columns and broken quotes are rejected", () => {
  assert.throws(
    () =>
      C.parseExport("Point name,Latitude,Longitude,Height\nP1,22.32,114.14,2"),
    /Missing required column: Elevation/,
  );
  assert.throws(
    () =>
      C.parseExport(
        "Point name,Latitude,lat,Longitude,Elevation\nP1,22.32,22.32,114.14,2",
      ),
    /ambiguous/,
  );
  assert.throws(
    () =>
      C.parseExport(
        'Point name,Latitude,Longitude,Elevation\n"P1,22.32,114.14,2',
      ),
    /Unclosed quoted/,
  );
  assert.throws(() => C.parseExport(""), /empty/);
});

test("DMS symbols, whitespace, colons and hemisphere markers normalize to decimal degrees", () => {
  for (const text of [
    "22°19′20.064″N",
    "N 22°19'20.064\"",
    "22 19 20.064",
    "22:19:20.064 N",
    "22d19m20.064sN",
  ]) {
    const angle = C.parseAngle(text, "lat");
    assert.equal(angle.format, "dms");
    assert.equal(angle.value, "22.32224");
    assert.equal(angle.original, text);
  }
  assert.equal(C.parseAngle("114°8′28.248″ E", "long").value, "114.14118");
  assert.equal(C.parseAngle("22.322240000° N", "lat").value, "22.322240000");
  assert.equal(C.parseAngle("22 19 20.064 S", "lat").value, "-22.32224");
  assert.equal(C.parseAngle("-22 19 20.064 S", "lat").value, "-22.32224");
});

test("packed DMS requires an explicit choice rather than guessing plain decimals", () => {
  assert.equal(C.parseAngle("22.1920064", "lat").value, "22.1920064");
  assert.equal(C.parseAngle("22.1920064", "lat", "packed").value, "22.32224");
  assert.equal(
    C.parseAngle("114.0828248", "long", "packed").value,
    "114.14118",
  );
  assert.throws(() => C.parseAngle("22.19", "lat", "packed"), /DD.MMSS/);
  assert.throws(
    () => C.parseAngle("22 19 20", "lat", "decimal"),
    /DMS, but Decimal/,
  );
  assert.throws(() => C.parseAngle("22.32224", "lat", "dms"), /complete DMS/);
});

test("invalid DMS, sign conflicts, hemisphere swaps and ambiguous incomplete angles are rejected", () => {
  for (const text of [
    "22 60 0",
    "22:19:60",
    "22 19 -2",
    "22 19 20 extra",
    "22°19.2′",
    "22 19",
    "221920.064",
  ])
    assert.throws(() => C.parseAngle(text, "lat"), undefined, text);
  assert.throws(() => C.parseAngle("22 19 20 E", "lat"), /wrong hemisphere/);
  assert.throws(() => C.parseAngle("114 8 28 N", "long"), /wrong hemisphere/);
  assert.throws(() => C.parseAngle("-22 19 20 N", "lat"), /sign conflicts/);
  assert.throws(() => C.parseAngle("+22 19 20 S", "lat"), /sign conflicts/);
  assert.throws(() => C.parseAngle("N 22 19 20 N", "lat"), /more than one/);
  assert.throws(() => C.parseAngle("90 0 1", "lat"), /exceeds/);
});

test("DMS TXT imports and RFC quoted CSV both work, with originals retained in downloads", () => {
  const header = "Point name,Latitude,Longitude,Elevation\n";
  const text =
    header +
    "P1,22°19'20.064\"N,114°8'28.248\"E,23.128\nP2,22.32224,114.14118,23.128\nP3,22 60 0,114 8 28,23.128";
  const result = C.parseExport(text, "dms.txt");
  assert.equal(result.points.length, 2);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].line, 4);
  assert.deepEqual(result.formatCounts, {
    decimal: 1,
    dms: 1,
    packed: 0,
    mixed: 0,
  });
  assert.equal(result.points[0].lat, "22.32224");
  assert.equal(result.points[0].long, "114.14118");
  assert.equal(
    new URL(C.buildUrl(result.points[0])).searchParams.get("inUnit"),
    "decDeg",
  );
  assert.match(C.preparedCsv(result.points), /P1,22.32224,114.14118,23.128/);
  assert.equal(
    JSON.parse(C.resultsJson(result.points))[0].inputAngles.latitudeFormat,
    "dms",
  );
  assert.match(
    C.measurementsCsv(result.points),
    /Input latitude,Input longitude/,
  );
  const quoted = C.parseExport(
    header + 'P1,"22°19\'20.064""N","114°8\'28.248""E",23.128',
  );
  assert.equal(quoted.points[0].lat, "22.32224");
  const packed = C.parseExport(
    header + "P1,22.1920064,114.0828248,23.128",
    "packed.txt",
    { angleFormat: "packed" },
  );
  assert.equal(packed.points[0].lat, "22.32224");
  assert.equal(packed.formatCounts.packed, 1);
});

test("mixed coordinate formats are normalized independently; swapped axes and out-of-HK DMS are excluded", () => {
  const result = C.parseExport(
    "Point name,Latitude,Longitude,Elevation\nP1,22 19 20.064,114.14118,23.128\nP2,114.14118,22.32224,23.128\nP3,22 19 20 S,114 8 28 E,23.128",
  );
  assert.equal(result.points.length, 1);
  assert.equal(result.formatCounts.mixed, 1);
  assert.match(result.issues[0].message, /swapped/);
  assert.match(result.issues[1].message, /between 22.13 and 22.57/);
});

test("bounding box uses all normalized points including DMS and handles empty/single-location data", () => {
  assert.equal(C.coordinateBounds([]), null);
  assert.deepEqual(C.coordinateBounds([C.EXAMPLE]), {
    south: 22.32224,
    west: 114.14118,
    north: 22.32224,
    east: 114.14118,
  });
  const parsed = C.parseExport(
    "Point name,Latitude,Longitude,Elevation\nP1,22 19 20.064,114 8 28.248,23.128\nP2,22.33,114.15,2\nP3,22.31,114.13,2",
  );
  assert.deepEqual(C.coordinateBounds(parsed.points), {
    south: 22.31,
    west: 114.13,
    north: 22.33,
    east: 114.15,
  });
  assert.throws(
    () => C.coordinateBounds([{ ...C.EXAMPLE, lat: "22 19 20" }]),
    /normalized/,
  );
});

test("API errors, malformed results and omitted heights are never accepted as conversions", async () => {
  assert.deepEqual(C.validateResponse(C.EXPECTED), C.EXPECTED);
  assert.throws(
    () => C.validateResponse({ ErrorCode: 4 }),
    /Coordinates out of range/,
  );
  assert.throws(() => C.validateResponse({ hkN: 1, hkE: 2 }), /hkpd/);
  assert.throws(() => C.validateResponse({ hkN: "1", hkE: 2, hkpd: 3 }), /hkN/);
  assert.throws(() => C.validateResponse(null), /unexpected/);
  await assert.rejects(
    C.requestConversion(C.EXAMPLE, {
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /HTTP 503/,
  );
  await assert.rejects(
    C.requestConversion(C.EXAMPLE, {
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError();
        },
      }),
    }),
    /not valid JSON/,
  );
});

test("abort and timeout interrupt a pending request", async () => {
  const pendingFetch = async (_url, { signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      else
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
    });
  await assert.rejects(
    C.requestConversion(C.EXAMPLE, { fetchImpl: pendingFetch, timeoutMs: 15 }),
    /did not respond/,
  );
  const controller = new AbortController();
  const request = C.requestConversion(C.EXAMPLE, {
    fetchImpl: pendingFetch,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("downloads retain point identity, source precision, failures and 3-decimal outputs", () => {
  const done = {
    ...C.EXAMPLE,
    name: "=SUM(1,2)",
    source: "one.txt",
    line: 2,
    status: "done",
    result: C.EXPECTED,
  };
  const failed = {
    ...C.EXAMPLE,
    source: "two.txt",
    line: 4,
    status: "error",
    error: "Network failure",
  };
  const prepared = C.preparedCsv([done]);
  assert.match(prepared, /Point name,Latitude,Longitude,Elevation\r\n/);
  assert.match(prepared, /"'=SUM\(1,2\)"/);
  assert.match(prepared, /22.32224,114.14118,23.128/);
  const csv = C.measurementsCsv([done, failed], "NE");
  assert.match(csv, /820358.910,832590.508,26.009/);
  assert.match(csv, /error,Network failure/);
  const json = JSON.parse(C.resultsJson([done, failed]));
  assert.equal(json[0].pointName, "=SUM(1,2)");
  assert.equal(json[0].hkN, C.EXPECTED.hkN);
  assert.equal(json[1].error, "Network failure");
  assert.equal("hkN" in json[1], false);
});

test("collection date and time are retained without changing coordinate preparation", () => {
  const parsed = C.parseExport(
    "Point name,Latitude,Longitude,Elevation,Date,Time\nP1,22.32224,114.14118,23.128,2026-09-16,10:05:03",
  );
  assert.deepEqual(parsed.points[0].collectedAt, {
    date: "2026-09-16",
    time: "10:05:03",
  });
  assert.match(
    C.preparedCsv(parsed.points),
    /P1,22.32224,114.14118,23.128\r\n$/,
  );
  assert.equal(
    new URL(C.buildUrl(parsed.points[0])).searchParams.has("date"),
    false,
  );
  assert.deepEqual(
    JSON.parse(C.resultsJson(parsed.points))[0].collectedAt,
    parsed.points[0].collectedAt,
  );
  assert.match(C.measurementsCsv(parsed.points), /2026-09-16,10:05:03/);
});

test("collection timestamp parsing rejects invalid civil dates and preserves fractional time order", () => {
  assert.notEqual(C.parseCollectionTimestamp("2024-02-29", "23:59:59"), null);
  for (const [date, time] of [
    ["2026-02-29", "12:00:00"],
    ["2026-04-31", "12:00:00"],
    ["2026-01-01", "24:00:00"],
    ["2026-01-01", "10:60:00"],
    ["2026-01-01", "10:00:60"],
    ["16/09/2026", "10:05:03"],
    ["", "10:05:03"],
    ["2026-09-16", ""],
  ])
    assert.equal(C.parseCollectionTimestamp(date, time), null);
  assert.ok(
    C.parseCollectionTimestamp("2026-09-16", "10:05:03.1") <
      C.parseCollectionTimestamp("2026-09-16", "10:05:03.2"),
  );
});

test("playback sorts all files by collection time, retains ties, and falls back to import order if any time is unusable", () => {
  const a = {
    ...C.EXAMPLE,
    name: "later",
    collectedAt: { date: "2026-09-16", time: "10:05:03" },
  };
  const b = {
    ...C.EXAMPLE,
    name: "earlier",
    collectedAt: { date: "2026-08-26", time: "09:48:49" },
  };
  const c = { ...b, name: "same time" };
  const originals = [a, b, c];
  const sorted = C.collectionSequence(originals);
  assert.equal(sorted.mode, "time");
  assert.equal(sorted.undatedCount, 0);
  assert.deepEqual(
    sorted.points.map((point) => point.name),
    ["earlier", "same time", "later"],
  );
  assert.deepEqual(
    originals.map((point) => point.name),
    ["later", "earlier", "same time"],
  );
  const missing = { ...C.EXAMPLE, name: "undated" };
  const fallback = C.collectionSequence([a, missing, b]);
  assert.equal(fallback.mode, "import");
  assert.equal(fallback.undatedCount, 1);
  assert.deepEqual(fallback.points, [a, missing, b]);
});

test("EN/NE reorder real result values and headers consistently without altering source results", () => {
  const point = { ...C.EXAMPLE, status: "done", result: { ...C.EXPECTED } };
  assert.match(C.resultsCsv([point], "NE"), /ID,Northing,Easting,mPD/);
  assert.match(C.resultsCsv([point], "EN"), /ID,Easting,Northing,mPD/);
  assert.match(C.resultsCsv([point], "EN"), /832590.508,820358.910,26.009/);
  assert.equal(
    C.coordinateText([point], "EN"),
    "Manual Example 3,832590.508,820358.910,26.009\r\n",
  );
  assert.equal(
    C.coordinateText([point], "NE"),
    "Manual Example 3,820358.910,832590.508,26.009\r\n",
  );
  const json = JSON.parse(C.resultsJson([point], "EN"))[0];
  assert.ok(
    Object.keys(json).indexOf("hkE") < Object.keys(json).indexOf("hkN"),
  );
  assert.equal(json.hkE, 832590.508);
  assert.equal(json.hkN, 820358.91);
  assert.deepEqual(point.result, C.EXPECTED);
  assert.throws(() => C.resultsCsv([point], "XY"), /NE or EN/);
});

test("coordinate TXT exports complete point means as TXYZ without BOM, headers or failed groups", () => {
  const done = {
    ...C.EXAMPLE,
    name: "DONE.1",
    result: C.EXPECTED,
    status: "done",
  };
  const failed = { ...C.EXAMPLE, status: "error", error: "Network failure" };
  assert.equal(
    C.coordinateText([done, failed], "EN"),
    "DONE,832590.508,820358.910,26.009\r\n",
  );
  assert.equal(C.coordinateText([failed], "EN"), "");
  assert.throws(
    () => C.coordinateText([{ ...done, result: { hkN: 1, hkE: 2 } }]),
    /hkpd/,
  );
});

test("point identity splits only the final numeric suffix and preserves original identifiers", () => {
  assert.deepEqual(C.pointIdentity("SC43.1"), {
    pointId: "SC43",
    measurementIndex: "1",
  });
  assert.deepEqual(C.pointIdentity("SC43.003"), {
    pointId: "SC43",
    measurementIndex: "003",
  });
  assert.deepEqual(C.pointIdentity("AREA.SC43.2"), {
    pointId: "AREA.SC43",
    measurementIndex: "2",
  });
  assert.deepEqual(C.pointIdentity("SC43"), {
    pointId: "SC43",
    measurementIndex: null,
  });
  assert.deepEqual(C.pointIdentity("SC43.check"), {
    pointId: "SC43.check",
    measurementIndex: null,
  });
  assert.notEqual(
    C.pointIdentity("SC43.1").pointId,
    C.pointIdentity("SC430.1").pointId,
  );
  assert.notEqual(
    C.pointIdentity("SC43.1").pointId,
    C.pointIdentity("sc43.1").pointId,
  );
});

test("grouping retains duplicate measurement names and separate sources without mutating observations", () => {
  const a = { ...C.EXAMPLE, name: "SC43.1", source: "day1.txt", recordId: "a" };
  const b = { ...C.EXAMPLE, name: "SC43.2", source: "day1.txt", recordId: "b" };
  const c = { ...C.EXAMPLE, name: "SC43.1", source: "day2.txt", recordId: "c" };
  const d = { ...C.EXAMPLE, name: "SC44.1", source: "day1.txt", recordId: "d" };
  const groups = C.groupMeasurements([a, b, c, d]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].pointId, "SC43");
  assert.equal(groups[0].count, 3);
  assert.deepEqual(groups[0].measurements, [a, b, c]);
  assert.equal(groups[0].measurements[2].recordId, "c");
  assert.equal(groups[0].statistics, null);
  assert.equal(a.name, "SC43.1");
});

test("converted group statistics use completed measurements with sample SD and explicit partial counts", () => {
  const points = [0, 1, 2].map((index) => ({
    ...C.EXAMPLE,
    name: `SC43.${index + 1}`,
    status: "done",
    result: { hkN: 10 + 2 * index, hkE: 20 + 4 * index, hkpd: 1 + index },
  }));
  points.push(
    { ...C.EXAMPLE, name: "SC43.4", status: "error" },
    { ...C.EXAMPLE, name: "SC43.5", status: "ready" },
  );
  const group = C.groupMeasurements(points)[0];
  assert.equal(group.count, 5);
  assert.equal(group.convertedCount, 3);
  assert.equal(group.errorCount, 1);
  assert.equal(group.pendingCount, 1);
  assert.deepEqual(group.statistics.hkN, {
    mean: 12,
    min: 10,
    max: 14,
    sampleSd: 2,
    range: 4,
  });
  assert.deepEqual(group.statistics.hkE, {
    mean: 24,
    min: 20,
    max: 28,
    sampleSd: 4,
    range: 8,
  });
  assert.deepEqual(group.statistics.hkpd, {
    mean: 2,
    min: 1,
    max: 3,
    sampleSd: 1,
    range: 2,
  });
  const single = C.groupMeasurements(points.slice(0, 1))[0];
  assert.equal(single.statistics.hkN.sampleSd, null);
  assert.equal(single.statistics.hkN.range, 0);
  const csv = C.pointStatisticsCsv(points, "EN");
  assert.match(csv, /Failed measurements,hkE mean \(m\),hkE sample SD \(m\)/);
  assert.match(csv, /SC43,5,3,1,1,24.000000,4.000000,20.000,28.000,8.000000/);
});

test("result exports retain point ID, measurement index and record ID for later statistics", () => {
  const point = {
    ...C.EXAMPLE,
    ...C.pointIdentity("SC43.003"),
    name: "SC43.003",
    recordId: "observation-unique",
    source: "day1.txt",
    line: 7,
    status: "done",
    result: C.EXPECTED,
  };
  const json = JSON.parse(C.resultsJson([point]))[0];
  assert.equal(json.pointId, "SC43");
  assert.equal(json.measurementIndex, "003");
  assert.equal(json.recordId, "observation-unique");
  assert.equal(json.pointName, "SC43.003");
  assert.equal(json.hkN, C.EXPECTED.hkN);
  const csv = C.measurementsCsv([point], "NE");
  assert.match(csv, /Point ID,Measurement index,Record ID/);
  assert.match(csv, /26.009,SC43,003,observation-unique,day1.txt,7/);
  assert.equal(
    C.coordinateText([point], "EN"),
    "SC43,832590.508,820358.910,26.009\r\n",
  );
});

test("mean Results CSV is isolated to ID and three coordinate columns with EN as default", () => {
  const points = [
    {
      ...C.EXAMPLE,
      name: "SC43.1",
      result: { hkN: 820000, hkE: 830000, hkpd: 10 },
    },
    {
      ...C.EXAMPLE,
      name: "SC43.2",
      result: { hkN: 820002, hkE: 830004, hkpd: 12 },
    },
    {
      ...C.EXAMPLE,
      name: "SC44.1",
      result: { hkN: 820100, hkE: 830100, hkpd: 20 },
    },
    { ...C.EXAMPLE, name: "SC44.2", status: "error" },
    { ...C.EXAMPLE, name: "SC45.1", status: "ready" },
  ];
  assert.equal(
    C.resultsCsv(points),
    "\uFEFFID,Easting,Northing,mPD\r\nSC43,830002.000,820001.000,11.000\r\n",
  );
  assert.equal(
    C.resultsCsv(points, "NE"),
    "\uFEFFID,Northing,Easting,mPD\r\nSC43,820001.000,830002.000,11.000\r\n",
  );
  assert.equal(
    C.coordinateText(points),
    "SC43,830002.000,820001.000,11.000\r\n",
  );
  assert.equal(
    C.coordinateText(points, "NE"),
    "SC43,820001.000,830002.000,11.000\r\n",
  );
  assert.equal(C.meanCoordinates(points).length, 1);
  assert.equal(C.groupMeasurements(points)[1].convertedCount, 1);
  assert.equal(JSON.parse(C.resultsJson(points)).length, 5);
});

test("mean exports combine measurements across files and reject unsafe TXYZ delimiters", () => {
  const first = {
    ...C.EXAMPLE,
    name: "P.1",
    source: "one.txt",
    result: { hkN: 820000.001, hkE: 830000.001, hkpd: 10.001 },
  };
  const second = {
    ...C.EXAMPLE,
    name: "P.1",
    source: "two.txt",
    result: { hkN: 820000.003, hkE: 830000.003, hkpd: 10.003 },
  };
  assert.equal(
    C.coordinateText([first, second]),
    "P,830000.002,820000.002,10.002\r\n",
  );
  assert.throws(
    () => C.coordinateText([{ ...first, name: "P,unsafe.1" }]),
    /not supported by TXYZ/,
  );
  assert.match(C.resultsCsv([{ ...first, name: "P,unsafe.1" }]), /"P,unsafe"/);
  assert.equal(C.resultsCsv([]), "\uFEFFID,Easting,Northing,mPD\r\n");
});

const originals = path.resolve(
  __dirname,
  "../../original gnss export",
);
test(
  "every supplied GNSS record matches its four named original columns",
  { skip: !fs.existsSync(originals) },
  () => {
    const files = fs
      .readdirSync(originals)
      .filter((name) => /\.txt$/i.test(name));
    assert.ok(files.length > 0);
    let total = 0;
    for (const file of files) {
      const text = fs.readFileSync(path.join(originals, file), "utf8");
      const lines = text
        .replace(/^\uFEFF/, "")
        .trim()
        .split(/\r\n|\n|\r/)
        .filter((line) => line.trim());
      const headers = lines.shift().split(",");
      const topcon = headers.includes("84H");
      const parsed = C.parseExport(text, file);
      assert.deepEqual(parsed.issues, [], `${file} has no invalid rows`);
      assert.equal(
        parsed.points.length,
        lines.length,
        `${file} keeps every point`,
      );
      assert.equal(
        C.collectionSequence(parsed.points).mode,
        "time",
        `${file} has valid collection timestamps`,
      );
      for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split(",");
        for (const [key, column] of [
          ["name", topcon ? "Name" : "Point name"],
          ["lat", topcon ? "B" : "Latitude"],
          ["long", topcon ? "L" : "Longitude"],
          ["elevation", topcon ? "84H" : "Elevation"],
        ])
          assert.equal(
            parsed.points[i][key],
            cells[headers.indexOf(column)],
            `${file}:${i + 2} ${column}`,
          );
      }
      total += parsed.points.length;
      console.log(`${file}: ${parsed.points.length} points verified`);
    }
    console.log(
      `Verified ${total} points across ${files.length} original exports.`,
    );
  },
);
