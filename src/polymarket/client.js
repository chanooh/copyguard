import {
  normalizeActivities,
  normalizeClosedPositions,
  normalizePositions,
  normalizeTrades,
  normalizeValue,
} from "./normalizers.js";

const DEFAULT_BASE_URL = "https://data-api.polymarket.com";

export class PolymarketDataClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.POLYMARKET_API_BASE || DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 10000;
  }

  async getWalletData(walletAddress) {
    const endpoints = [
      ["positions", "/positions", { user: walletAddress, limit: "100" }],
      ["closedPositions", "/closed-positions", { user: walletAddress, limit: "100" }],
      ["trades", "/trades", { user: walletAddress, limit: "150" }],
      ["activities", "/activity", { user: walletAddress, limit: "150" }],
      ["value", "/value", { user: walletAddress }],
    ];

    const settled = await Promise.allSettled(
      endpoints.map(async ([key, path, params]) => [key, await this.fetchJson(path, params)]),
    );

    const raw = {};
    const sources = [];

    for (let index = 0; index < settled.length; index += 1) {
      const [key] = endpoints[index];
      const result = settled[index];
      if (result.status === "fulfilled") {
        raw[key] = result.value[1];
        sources.push({ key, ok: true });
      } else {
        raw[key] = null;
        sources.push({ key, ok: false, error: result.reason?.message || "Request failed" });
      }
    }

    if (!sources.some((source) => source.ok)) {
      throw new Error("Polymarket data API did not return any usable wallet data.");
    }

    return {
      raw,
      normalized: {
        positions: normalizePositions(raw.positions),
        closedPositions: normalizeClosedPositions(raw.closedPositions),
        trades: normalizeTrades(raw.trades),
        activities: normalizeActivities(raw.activities),
        value: normalizeValue(raw.value),
      },
      sources,
    };
  }

  async fetchJson(path, params = {}) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation is available.");
    }

    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Polymarket ${path} returned ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

