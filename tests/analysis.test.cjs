"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../converter.js");
function reading(delta, index, id = "TEST") {
  return {
    ...C.EXAMPLE,
    name: `${id}.${(index % 100) + 1}`,
    recordId: `${id}-${index}`,
    source: index % 2 ? "day1.txt" : "day2.txt",
    status: "done",
    result: {
      hkE: 832590.508 + delta,
      hkN: 820358.91 + delta / 2,
      hkpd: 26.009 + delta / 3,
    },
  };
}
function dataset() {
  return Array.from({ length: 200 }, (_, i) =>
    reading(
      i < 180
        ? i % 2
          ? 0.001
          : -0.001
        : (i % 2 ? 1 : -1) * (1 + Math.floor((i - 180) / 2)),
      i,
    ),
  );
}

test("200 readings can preselect exactly the 20 largest departures and retain 180", () => {
  const points = dataset(),
    original = JSON.stringify(points);
  const suggested = C.suggestExclusions(points, 180);
  assert.equal(suggested.length, 20);
  assert.equal(new Set(suggested).size, 20);
  assert.ok(
    suggested.every((point) => Number(point.recordId.split("-")[1]) >= 180),
  );
  assert.equal(
    JSON.stringify(points),
    original,
    "ranking and suggestions do not mutate observations",
  );
  for (const point of suggested) point.excludedFromMean = true;
  const analysis = C.measurementAnalysis(points);
  assert.equal(analysis.count, 200);
  assert.equal(analysis.retainedCount, 180);
  assert.equal(analysis.excludedCount, 20);
  for (const key of ["hkE", "hkN", "hkpd"])
    assert.ok(
      analysis.retainedStatistics[key].sampleSd <
        analysis.baselineStatistics[key].sampleSd / 100,
    );
});

test("metric-specific ranking separates horizontal and vertical departures with stable ties", () => {
  const points = [reading(0, 0), reading(0, 1), reading(0, 2), reading(0, 3)];
  points[0].result.hkE += 20;
  points[1].result.hkE -= 20;
  points[2].result.hkpd += 100;
  points[3].result.hkpd -= 100;
  assert.equal(C.measurementAnalysis(points, "3d").rows[0].point, points[2]);
  assert.equal(
    C.measurementAnalysis(points, "horizontal").rows[0].point,
    points[0],
  );
  assert.equal(
    C.measurementAnalysis(points, "height").rows[0].point,
    points[2],
  );
  assert.equal(
    C.measurementAnalysis(points, "easting").rows[0].point,
    points[0],
  );
  assert.deepEqual(
    C.measurementAnalysis(points, "northing").rows.map((row) => row.index),
    [0, 1, 2, 3],
  );
  points[2].excludedFromMean = true;
  assert.equal(
    C.measurementAnalysis(points, "3d").rows[0].point,
    points[2],
    "baseline ranking remains stable during review",
  );
});

test("retained statistics use sample SD with n minus one and exclude only the selected record", () => {
  const points = [1, 2, 3, 100].map((delta, index) => reading(delta, index));
  points[3].name = points[0].name;
  points[3].excludedFromMean = true;
  const result = C.measurementAnalysis(points);
  assert.equal(result.retainedCount, 3);
  assert.equal(
    result.rows.filter((row) => row.point.name === points[0].name).length,
    2,
  );
  assert.equal(result.retainedStatistics.hkE.sampleSd, 1);
  assert.equal(result.retainedStatistics.hkE.mean, 832592.508);
  assert.ok(result.baselineStatistics.hkE.sampleSd > 40);
  assert.equal(points.length, 4);
});

test("EN/NE CSV and TXYZ use retained means while all raw readings and flags remain available", () => {
  const points = [0, 0, 0, 12].map((delta, index) => reading(delta, index));
  const originalCsv = C.resultsCsv(points);
  points[3].excludedFromMean = true;
  points[3].exclusionReason = "Manually excluded in data analysis";
  assert.equal(
    C.resultsCsv(points),
    "\uFEFFID,Easting,Northing,mPD\r\nTEST,832590.508,820358.910,26.009\r\n",
  );
  assert.equal(
    C.coordinateText(points),
    "TEST,832590.508,820358.910,26.009\r\n",
  );
  assert.equal(
    C.coordinateText(points, "NE"),
    "TEST,820358.910,832590.508,26.009\r\n",
  );
  assert.match(
    C.resultsCsv(points, "NE"),
    /ID,Northing,Easting,mPD\r\nTEST,820358.910,832590.508,26.009/,
  );
  assert.equal(
    C.parseDelimited(C.preparedCsv(points).replace(/^\uFEFF/, ""), ",").length,
    5,
  );
  const measurements = C.parseDelimited(
    C.measurementsCsv(points).replace(/^\uFEFF/, ""),
    ",",
  );
  const excludedIndex = measurements[0].cells.indexOf("Excluded from mean");
  assert.equal(measurements.length, 5);
  assert.deepEqual(
    measurements.slice(1).map((row) => row.cells[excludedIndex]),
    ["no", "no", "no", "yes"],
  );
  const json = JSON.parse(C.resultsJson(points));
  assert.equal(json.length, 4);
  assert.equal(json[3].excludedFromMean, true);
  assert.equal(json[3].exclusionReason, points[3].exclusionReason);
  assert.equal(json[3].hkE, points[3].result.hkE);
  assert.match(
    C.pointStatisticsCsv(points),
    /Retained converted measurements,Excluded converted measurements/,
  );
  points[3].excludedFromMean = false;
  assert.equal(
    C.resultsCsv(points),
    originalCsv,
    "restoring a reading restores the original export",
  );
});

test("selection never merges point groups or silently exports incomplete or empty groups", () => {
  const first = [reading(0, 0), reading(1, 1), reading(20, 2)];
  first[2].excludedFromMean = true;
  const other = [reading(10, 0, "OTHER"), reading(12, 1, "OTHER")];
  assert.throws(
    () => C.measurementAnalysis([...first, ...other]),
    /one unique point/,
  );
  assert.equal(C.meanCoordinates([...first, ...other]).length, 2);
  assert.equal(C.meanCoordinates([...first, ...other])[1].hkE, 832601.508);
  const pending = {
    ...reading(0, 4),
    status: "error",
    result: undefined,
    excludedFromMean: true,
  };
  assert.equal(C.meanCoordinates([...first, pending]).length, 0);
  for (const point of first) point.excludedFromMean = true;
  assert.deepEqual(C.meanCoordinates(first), []);
  assert.equal(C.coordinateText(first), "");
});

test("selection target and conversion guards protect meaningful statistics", () => {
  const points = dataset();
  for (const keep of [-1, 0, 1, 2.5, NaN, 201])
    assert.throws(() => C.suggestExclusions(points, keep), /whole number/);
  assert.deepEqual(C.suggestExclusions([reading(0, 0)], 1), []);
  assert.equal(
    C.measurementAnalysis([reading(0, 0)]).retainedStatistics.hkE.sampleSd,
    null,
  );
  assert.deepEqual(C.measurementAnalysis([]).rows, []);
  assert.throws(() => C.suggestExclusions([], 0), /Convert all/);
  assert.throws(
    () =>
      C.suggestExclusions(
        [...points, { ...reading(0, 200), result: undefined }],
        180,
      ),
    /Convert all/,
  );
  assert.throws(() => C.measurementAnalysis(points, "unknown"), /Unknown/);
});
