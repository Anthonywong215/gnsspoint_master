"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../converter.js");
function points() {
  return [0, 1, 2, 3, 100].map((delta, i) => ({
    ...C.EXAMPLE,
    name: `TEST.${i + 1}`,
    recordId: `record-${i}`,
    source: "20261106_Topcon.txt",
    status: "done",
    result: { hkN: 820000 + delta, hkE: 830000 + delta, hkpd: 10 + delta },
    excludedFromMean: i === 4,
    exclusionReason: i === 4 ? "Reviewed outlier" : "",
  }));
}
const rows = (csv) =>
  C.parseDelimited(csv.replace(/^\uFEFF/, ""), ",").map((row) => row.cells);

test("spreadsheet layout matches ten columns and puts retained statistics in its first five data rows", () => {
  const input = points(),
    original = JSON.stringify(input),
    sheet = rows(C.surveySheetCsv(input));
  assert.equal(sheet.length, 6);
  assert.ok(sheet.every((row) => row.length === 10));
  assert.deepEqual(sheet[0], [
    "Point name",
    "Northing",
    "Easting",
    "Height (mPD)",
    "",
    "",
    "",
    "",
    "Remark",
    "Original Point Name",
  ]);
  assert.deepEqual(
    sheet.slice(1).map((row) => row[4]),
    ["Average:", "Max:", "Min:", "Max-Min:", "SD:"],
  );
  assert.deepEqual(sheet[1].slice(5, 8), [
    "820001.500",
    "830001.500",
    "11.500",
  ]);
  assert.deepEqual(sheet[2].slice(5, 8), [
    "820003.000",
    "830003.000",
    "13.000",
  ]);
  assert.deepEqual(sheet[3].slice(5, 8), [
    "820000.000",
    "830000.000",
    "10.000",
  ]);
  assert.deepEqual(sheet[4].slice(5, 8), ["3.000", "3.000", "3.000"]);
  assert.deepEqual(sheet[5].slice(5, 8), ["1.291", "1.291", "1.291"]);
  assert.equal(sheet[1][0], "TEST");
  assert.ok(sheet.slice(2).every((row) => row[0] === ""));
  assert.equal(sheet[5][8], "Excluded from mean: Reviewed outlier");
  assert.equal(sheet[5][9], "TEST.5");
  assert.equal(JSON.stringify(input), original);
});

test("spreadsheet layout retains all observations, placing exclusions last without sorting the original names", () => {
  const input = points();
  input[1].excludedFromMean = true;
  input[4].name = input[0].name;
  const sheet = rows(C.surveySheetCsv(input));
  assert.deepEqual(
    sheet.slice(1).map((row) => row[9]),
    ["TEST.1", "TEST.3", "TEST.4", "TEST.2", "TEST.1"],
  );
  assert.deepEqual(sheet[4].slice(1, 4), [
    "820001.000",
    "830001.000",
    "11.000",
  ]);
  assert.match(sheet[4][8], /Excluded from mean/);
});

test("short spreadsheet groups are padded for all five statistics and singleton SD stays blank", () => {
  const one = points().slice(0, 1);
  const sheet = rows(C.surveySheetCsv(one));
  assert.equal(sheet.length, 6);
  assert.equal(sheet[1][9], "TEST.1");
  assert.deepEqual(sheet[5].slice(5, 8), ["", "", ""]);
  assert.deepEqual(sheet[2].slice(1, 4), ["", "", ""]);
  assert.equal(rows(C.surveySheetCsv([])).length, 1);
  assert.throws(
    () => C.surveySheetCsv([{ ...one[0], result: undefined }]),
    /Convert all/,
  );
  assert.throws(
    () => C.surveySheetCsv([{ ...one[0], excludedFromMean: true }]),
    /Retain at least/,
  );
});

test("spreadsheet point blocks remain separate and CSV identifiers are safely escaped", () => {
  const a = points().slice(0, 1),
    b = [{ ...a[0], name: 'OTHER, "point".1' }];
  const sheet = rows(C.surveySheetCsv([...a, ...b]));
  assert.equal(sheet.length, 11);
  assert.equal(sheet[1][0], 'OTHER, "point"');
  assert.equal(sheet[1][9], 'OTHER, "point".1');
  assert.equal(sheet[6][0], "TEST");
  const formula = rows(C.surveySheetCsv([{ ...a[0], name: "=DANGEROUS.1" }]));
  assert.equal(formula[1][0], "'=DANGEROUS");
  assert.equal(formula[1][9], "'=DANGEROUS.1");
});

test("export filenames keep the original stem and append reduced or converted", () => {
  const input = points();
  assert.equal(
    C.exportFilename(input, "reduced", "csv"),
    "20261106_Topcon_reduced.csv",
  );
  assert.equal(
    C.exportFilename(input, "reduced", "txt"),
    "20261106_Topcon_reduced.txt",
  );
  assert.equal(
    C.exportFilename(input, "converted", "csv"),
    "20261106_Topcon_converted.csv",
  );
  assert.equal(
    C.exportFilename(input, "converted", "txt"),
    "20261106_Topcon_converted.txt",
  );
  assert.equal(
    C.exportFilename(input, "converted", "csv", "spreadsheet"),
    "20261106_Topcon_converted_spreadsheet.csv",
  );
  assert.equal(
    C.exportBaseName([{ source: "C:\\survey\\Job.v2.CSV" }]),
    "Job.v2",
  );
  assert.equal(
    C.exportBaseName([
      { source: "a.txt" },
      { source: "b.csv" },
      { source: "a.txt" },
    ]),
    "a_b",
  );
  assert.equal(
    C.exportBaseName([{ isExample: true, source: "LandsD manual" }]),
    "manual_example",
  );
  assert.equal(C.exportBaseName([]), "gnss");
  assert.ok(
    C.exportFilename([{ source: "a".repeat(300) + ".txt" }], "converted", "csv")
      .length < 200,
  );
  assert.throws(() => C.exportFilename(input, "converted", "exe"), /Invalid/);
  assert.throws(() => C.exportFilename(input, "unknown", "csv"), /Invalid/);
});
