"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../converter.js");
const row = "P.1,820359.38900,832591.32000,26.00900";

test("pasted grid points retain names, Z and source precision with optional headers", () => {
  for (const input of [
    row,
    "\uFEFFName,N,E,Z\r\n" + row,
    "ID,Northing,Easting,mPD\n" + row,
  ]) {
    const parsed = C.parseGridText(input);
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.points[0].name, "P.1");
    assert.equal(parsed.points[0].northing, "820359.38900");
    assert.equal(parsed.points[0].easting, "832591.32000");
    assert.equal(parsed.points[0].z, "26.00900");
  }
  assert.equal(C.parseGridText(row + "\n" + row).points.length, 2);
});

test("grid text accepts spreadsheet tabs, spaces, semicolons and quoted CSV names", () => {
  for (const delimiter of ["\t", " ", ";"]) {
    assert.equal(
      C.parseGridText(row.replaceAll(",", delimiter)).points[0].z,
      "26.00900",
    );
  }
  assert.equal(
    C.parseGridText('"Point, with spaces",820359.389,832591.32,26').points[0]
      .name,
    "Point, with spaces",
  );
});

test("grid guardrails report source lines and reject missing, invalid or geographic input", () => {
  const input =
    "Name,N,E,Z\n\nP1,22.3,114.1,20\nP2,820000,832000,NaN\n,820000,832000,20\nP3,820000,832000\nP4,820000,832000,20,extra\nP5,820000,832000,0";
  const parsed = C.parseGridText(input);
  assert.deepEqual(
    parsed.issues.map((issue) => issue.line),
    [3, 4, 5, 6, 7],
  );
  assert.equal(parsed.points.length, 1);
  assert.equal(parsed.points[0].z, "0");
  assert.throws(
    () => C.parseGridText("ID,Easting,Northing,mPD\nP1,832000,820000,20"),
    /Northing before Easting/,
  );
  assert.throws(() => C.parseGridText("Name,N,E,Z"), /no point rows/);
  assert.throws(() => C.parseGridText(" "), /Paste at least/);
});

test("grid map lookup sends only horizontal coordinates and retains original Z in mPD", async () => {
  const point = C.parseGridText(row).points[0];
  let request;
  const mapped = await C.requestGridLocation(point, {
    fetchImpl: async (url, options) => {
      request = new URL(url);
      assert.equal(options.credentials, "omit");
      return {
        ok: true,
        json: async () => ({ wgsLat: 22.322244329, wgsLong: 114.141187898 }),
      };
    },
  });
  assert.equal(request.searchParams.get("inSys"), "hkgrid");
  assert.equal(request.searchParams.get("outSys"), "wgsgeog");
  assert.equal(request.searchParams.get("outUnit"), "decDeg");
  assert.equal(request.searchParams.get("n"), point.northing);
  assert.equal(request.searchParams.get("e"), point.easting);
  assert.equal(request.searchParams.has("h"), false);
  assert.equal(request.searchParams.has("name"), false);
  assert.deepEqual(mapped.gridInput, point);
  assert.equal(mapped.pointId, "P.1");
  assert.equal(mapped.elevation, undefined);
  assert.equal(mapped.mapOnly, true);
  assert.throws(() => C.buildUrl(mapped), /Elevation/);
  assert.deepEqual(C.coordinateBounds([mapped, C.EXAMPLE]), {
    south: 22.32224,
    west: 114.14118,
    north: 22.322244329,
    east: 114.141187898,
  });
});

test("invalid grid lookup responses never become plotted positions", async () => {
  const point = C.parseGridText(row).points[0];
  for (const data of [
    null,
    {},
    { ErrorCode: 4 },
    { wgsLat: "22.32", wgsLong: 114.14 },
    { wgsLat: 100, wgsLong: 114.14 },
    { wgsLat: 22.32, wgsLong: Infinity },
  ]) {
    await assert.rejects(
      C.requestGridLocation(point, {
        fetchImpl: async () => ({ ok: true, json: async () => data }),
      }),
    );
  }
  let called = false;
  await assert.rejects(
    C.requestGridLocation(
      { ...point, northing: "22.3" },
      {
        fetchImpl: async () => {
          called = true;
        },
      },
    ),
    /Northing/,
  );
  assert.equal(called, false);
});
