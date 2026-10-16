// Optional local preview server. Opening index.html directly also works.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const host = "127.0.0.1";
const port = Number(process.env.PORT || 8080);
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/converter.js": ["converter.js", "text/javascript; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};
files["/map.js"] = ["map.js", "text/javascript; charset=utf-8"];
files["/vendor/leaflet/leaflet.js"] = [
  "vendor/leaflet/leaflet.js",
  "text/javascript; charset=utf-8",
];
files["/vendor/leaflet/leaflet.css"] = [
  "vendor/leaflet/leaflet.css",
  "text/css; charset=utf-8",
];
files["/docs/USER_GUIDE.md"] = [
  "docs/USER_GUIDE.md",
  "text/plain; charset=utf-8",
];
files["/docs/USER_GUIDE.html"] = [
  "docs/USER_GUIDE.html",
  "text/html; charset=utf-8",
];
files["/docs/images/mean-export.png"] = [
  "docs/images/mean-export.png",
  "image/png",
];
files["/docs/images/overview.png"] = ["docs/images/overview.png", "image/png"];
const server = http.createServer((request, response) => {
  const requestHost = request.headers.host;
  if (
    requestHost !== `${host}:${port}` &&
    requestHost !== `localhost:${port}`
  ) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  const pathname = new URL(request.url, `http://${host}`).pathname;
  const entry = Object.hasOwn(files, pathname) ? files[pathname] : null;
  if (!entry) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  fs.readFile(path.join(__dirname, entry[0]), (error, content) => {
    if (error) {
      response.writeHead(500);
      response.end("Could not read application file.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": entry[1],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
});
server.on("error", (error) => {
  console.error(
    `Could not start: ${error.message}. Open index.html directly, or choose another PORT.`,
  );
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(
    `GNSS converter: ${url}\nKeep this window open while using the local server. Press Ctrl+C to stop.`,
  );
  if (process.argv.includes("--open") && process.platform === "win32") {
    const browser = spawn("explorer.exe", [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    browser.on("error", () => console.log(`Open ${url} in your browser.`));
    browser.unref();
  }
});
