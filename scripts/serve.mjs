import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".svg": "image/svg+xml", ".txt": "text/plain" };
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
const port = Number(args.includes("--port") ? arg("--port") : process.env.PORT || 4173);
const host = args.includes("--host") ? arg("--host") : process.env.HOST || "127.0.0.1";

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !(await stat(path)).isFile()) throw Error();
    res.writeHead(200, { "Content-Type": (types[extname(path)] ?? "application/octet-stream") + "; charset=utf-8", "Cache-Control": "no-cache" });
    if (req.method === "HEAD") res.end();
    else createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end("File unavailable");
  }
}).listen(port, host, function () { console.log(`DraftBridge listening on http://${host}:${this.address().port}/`); });
