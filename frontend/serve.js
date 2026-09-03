/* Minimal static file server (zero deps) — preview the real site locally:
   node serve.js  →  http://localhost:8123/  */
const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json"
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(__dirname, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found: " + p); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}).listen(8123, () => console.log("Static server: http://localhost:8123/"));