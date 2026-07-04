// scripts/serve-out.js
// Tiny zero-dependency static server for LOCAL research review only.
// Serves the repo root so the timeline chart (out/score/*.html) can also reach
// the source WAVs (data/*.wav). Supports HTTP Range so <audio> seeking works on
// large files. Do NOT expose this beyond localhost — it serves raw captures.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const PORT = 8137;
const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".csv": "text/csv", ".png": "image/png",
  ".wav": "audio/wav", ".svg": "image/svg+xml"
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const p = path.join(root, rel);
  if (!p.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }

  fs.stat(p, (err, st) => {
    if (err || st.isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    const type = types[path.extname(p).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end || start >= st.size) {
        res.writeHead(416, { "content-range": "bytes */" + st.size }); res.end(); return;
      }
      res.writeHead(206, {
        "content-type": type, "accept-ranges": "bytes",
        "content-range": "bytes " + start + "-" + end + "/" + st.size,
        "content-length": end - start + 1
      });
      fs.createReadStream(p, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": st.size });
      fs.createReadStream(p).pipe(res);
    }
  });
}).listen(PORT, () => {
  console.log("serving repo root on http://localhost:" + PORT);
  console.log("chart: http://localhost:" + PORT + "/out/score/timeline-134511.html");
});
