#!/usr/bin/env node
// Static file server for the browser harness (test/harness/index.html), so it works the same on every OS.
//   node tools/serve.mjs [port]   then open http://localhost:8765/test/harness/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.argv[2]) || 8765;
const root = process.cwd();
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  if ( path.includes("..") ) { res.writeHead(403).end(); return; }
  if ( !path || path.endsWith("/") ) path = join(path, "index.html");
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}/test/harness/`));
