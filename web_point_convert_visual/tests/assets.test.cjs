"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("all local page scripts and styles exist beside the root entry point", () => {
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g)]
    .map(match => match[1]).filter(url => !/^(?:https?:|data:|\/\/)/i.test(url));
  assert.ok(assets.includes("vendor/leaflet/leaflet.js"));
  assert.ok(assets.includes("vendor/leaflet/leaflet.css"));
  for (const asset of assets) {
    const absolute = path.resolve(root, asset);
    assert.ok(absolute.startsWith(root + path.sep), `Asset stays inside project: ${asset}`);
    assert.ok(fs.existsSync(absolute), `Missing root page asset: ${asset}. Keep vendor and other assets beside index.html.`);
    assert.ok(fs.statSync(absolute).isFile(), `${asset} is a file`);
  }
});

test("deferred scripts load Leaflet and converter before map and app", () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(match => ({
    attributes: match[1], src: match[1].match(/\bsrc="([^"]+)"/)?.[1]
  })).filter(script => script.src);
  for (const script of scripts) {
    assert.match(script.attributes, /\bdefer\b/, script.src);
    assert.doesNotMatch(script.attributes, /\basync\b/, script.src);
  }
  const order = scripts.map(script => script.src);
  for (const [dependency, consumer] of [["vendor/leaflet/leaflet.js", "map.js"], ["converter.js", "map.js"], ["map.js", "app.js"]]) {
    assert.ok(order.includes(dependency) && order.includes(consumer));
    assert.ok(order.indexOf(dependency) < order.indexOf(consumer), `${dependency} loads before ${consumer}`);
  }
});

test("bundled Leaflet files match the official 1.9.4 release", () => {
  // Git may normalize checkout line endings; verify the release content as LF.
  for (const [file, expected] of [["leaflet.js", "20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="], ["leaflet.css", "M3v8pcq9A7OYFbJwD+vis7ft9VkhxZzUn4jssyghIwM="]]) {
    const data = fs.readFileSync(path.join(root, "vendor/leaflet", file), "utf8").replace(/\r\n/g, "\n");
    assert.equal(crypto.createHash("sha256").update(data).digest("base64"), expected, file);
  }
  assert.ok(fs.existsSync(path.join(root, "vendor/leaflet/LICENSE")));
});

test("guide, sample and packaging files referenced from root are included", () => {
  for (const file of ["docs/USER_GUIDE.html", "docs/USER_GUIDE.md", "docs/images/overview.png", "docs/images/mean-export.png", "samples/demo_decimal.txt", "scripts/build-guide.cjs", "scripts/package-release.cjs"]) {
    assert.ok(fs.existsSync(path.join(root, file)), `Missing supporting file: ${file}`);
  }
});
