import { loadEnv } from "../src/config/env.js";

loadEnv();

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const text = await new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(httpError(413, "Request body is too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

export function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    error: statusCode >= 500 ? "CopyGuard could not complete the request." : error.message,
    detail: statusCode >= 500 ? error.message : undefined,
  });
}

export function enforceMethod(req, method) {
  if (req.method === method) return;
  throw httpError(405, "Method not allowed.");
}

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
