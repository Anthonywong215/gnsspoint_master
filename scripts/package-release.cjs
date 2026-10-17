"use strict";
// Dependency-free ZIP builder with an explicit source/documentation allowlist.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
if (
  !/^[a-z0-9][a-z0-9._-]*$/i.test(pkg.name) ||
  !/^[0-9][a-z0-9.+-]*$/i.test(pkg.version)
)
  throw new Error("Unsafe package name/version.");
const prefix = `${pkg.name}-v${pkg.version}`;
const out = path.join(root, "release");
const rootFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "converter.js",
  "map.js",
  "server.js",
  "start.cmd",
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "THIRD_PARTY_NOTICES.md",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
];
const directories = [
  "docs",
  "samples",
  "scripts",
  "tests",
  ".github",
  "vendor/leaflet",
];
const files = rootFiles.slice();
function collect(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink())
    throw new Error(`Symlinks are not packaged: ${relative}`);
  if (stat.isDirectory())
    for (const child of fs.readdirSync(absolute).sort())
      collect(`${relative}/${child}`);
  else if (stat.isFile()) files.push(relative);
}
for (const directory of directories) collect(directory);
for (const required of [
  "docs/USER_GUIDE.html",
  "docs/images/overview.png",
  "docs/images/mean-export.png",
])
  if (!files.includes(required))
    throw new Error(`Missing release artifact: ${required}`);
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const local = [],
  central = [],
  manifest = [];
let offset = 0;
for (const relative of files.sort()) {
  const absolute = path.join(root, relative);
  if (fs.lstatSync(absolute).isSymbolicLink())
    throw new Error(`Symlinks are not packaged: ${relative}`);
  const data = fs.readFileSync(absolute),
    packed = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(`${prefix}/${relative}`, "utf8"),
    crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0x21, 12); // Fixed DOS date keeps repeated builds reproducible.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, packed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50);
  entry.writeUInt16LE(0x314, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(0x21, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + packed.length;
  manifest.push({
    path: relative,
    bytes: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
  });
}
const directory = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, directory, end]);
fs.mkdirSync(out, { recursive: true });
const archiveName = `${prefix}.zip`,
  checksum = crypto.createHash("sha256").update(archive).digest("hex");
fs.writeFileSync(path.join(out, archiveName), archive);
fs.writeFileSync(
  path.join(out, `${archiveName}.sha256`),
  `${checksum}  ${archiveName}\n`,
);
fs.writeFileSync(
  path.join(out, `${prefix}-manifest.json`),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      author: pkg.author,
      archive: archiveName,
      archiveSha256: checksum,
      files: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Created release/${archiveName} (${files.length} files, ${archive.length.toLocaleString()} bytes), checksum and manifest.`,
);
