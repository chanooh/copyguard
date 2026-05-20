import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { analyzeWallet } from "./analysis/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const publicDir = resolve(__dirname, "..", "public");

export function createAppServer(options = {}) {
  return createServer(async (req, res) => {
    try {
      setSecurityHeaders(res);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, name: "copyguard" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/analyze") {
        const body = await readJsonBody(req);
        const result = await analyzeWallet(body, { client: options.client });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        await serveStatic(url.pathname, req, res);
        return;
      }

      sendJson(res, 405, { error: "Method not allowed" });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(res, statusCode, {
        error: statusCode >= 500 ? "CopyGuard could not complete the analysis." : error.message,
        detail: statusCode >= 500 ? error.message : undefined,
      });
    }
  });
}

async function serveStatic(pathname, req, res) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = normalize(join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeType(extname(filePath)),
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(body);
    }
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(fallback);
  }
}

function readJsonBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        reject(error);
      }
    });
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("Request body must be valid JSON.");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function setSecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
}

function mimeType(extension) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  }[extension] || "application/octet-stream";
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`CopyGuard listening at http://${host}:${port}`);
  });
}
