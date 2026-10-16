"use strict";
const assert = require("node:assert/strict");
const C = require("../converter.js");
(async () => {
  const result = await C.requestConversion(C.EXAMPLE);
  for (const key of Object.keys(C.EXPECTED))
    assert.equal(result[key].toFixed(3), C.EXPECTED[key].toFixed(3), key);
  console.log("Live LandsD Example 3 passed:", JSON.stringify(result));
})().catch((error) => {
  console.error("Live check failed:", error.message);
  process.exitCode = 1;
});
