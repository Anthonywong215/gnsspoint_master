"use strict";
// Build a standalone, printable guide from this project's small Markdown subset.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const markdown = fs.readFileSync(path.join(root, "docs/USER_GUIDE.md"), "utf8");
const escape = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const inline = (value) =>
  escape(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
const html = [],
  contents = [];
let paragraph = [],
  list = false,
  code = null;
function flush() {
  if (paragraph.length) {
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  }
  if (list) {
    html.push("</ul>");
    list = false;
  }
}
for (const line of markdown.split(/\r?\n/)) {
  if (line.startsWith("```")) {
    if (code !== null) {
      html.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      code = null;
    } else {
      flush();
      code = [];
    }
    continue;
  }
  if (code !== null) {
    code.push(line);
    continue;
  }
  const heading = line.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    flush();
    const id = heading[2]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    html.push(
      `<h${heading[1].length} id="${id}">${inline(heading[2])}</h${heading[1].length}>`,
    );
    if (heading[1].length === 2)
      contents.push(`<a href="#${id}">${inline(heading[2])}</a>`);
  } else if (line.startsWith("- ")) {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
    if (!list) {
      html.push("<ul>");
      list = true;
    }
    html.push(`<li>${inline(line.slice(2))}</li>`);
  } else if (!line.trim()) flush();
  else paragraph.push(line.trim());
}
flush();
const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="author" content="Anthony Wong"><title>User guide · GNSS converter · Anthony Wong</title>
<style>body{font:18px/1.8 "Segoe UI",Arial,sans-serif;color:#203831;background:#f4f6f2;margin:0}main{max-width:940px;margin:40px auto;padding:40px;background:white;border:1px solid #dfe6df;border-radius:12px}h1{font-size:38px;line-height:1.2}h2{margin-top:42px;font-size:25px}a{color:#17664d}nav{display:flex;gap:10px 22px;flex-wrap:wrap;padding:20px;background:#edf2e9;border-radius:8px;font-size:16px}code{font-family:Consolas,monospace;background:#edf2e9;padding:1px 4px;border-radius:3px}pre{background:#edf2e9;padding:18px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px}pre code{padding:0}img{max-width:100%;height:auto;border:1px solid #dfe6df;border-radius:8px}li{margin:9px 0}.top{display:flex;gap:24px;flex-wrap:wrap;font-size:16px}footer{margin-top:40px;border-top:1px solid #dfe6df;padding-top:18px;font-size:16px}@media(max-width:700px){body{font-size:17px}main{margin:0;padding:24px;border:0;border-radius:0}h1{font-size:31px}nav{display:block}nav a{display:block;margin:6px 0}}@media print{body{background:white;font-size:12pt}main{margin:0;padding:0;border:0;max-width:none}.top,nav{display:none}h2{break-after:avoid}pre,img{break-inside:avoid}a{color:inherit}}</style></head><body><main><div class="top"><a href="../index.html">Open converter</a><a href="USER_GUIDE.md">Markdown guide</a><span>Anthony Wong · v1.1.0 · Print with your browser</span></div><nav aria-label="Guide contents">${contents.join("\n")}</nav>${html.join("\n")}<footer>Anthony Wong · GNSS → HK1980 coordinate converter</footer></main></body></html>`;
fs.writeFileSync(path.join(root, "docs/USER_GUIDE.html"), document);
console.log("Built docs/USER_GUIDE.html");
