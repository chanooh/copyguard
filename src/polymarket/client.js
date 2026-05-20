import {
  normalizeActivities,
  normalizeClosedPositions,
  normalizePositions,
  normalizeTrades,
  normalizeValue,
} from "./normalizers.js";

const DEFAULT_BASE_URL = "https://data-api.polymarket.com";
const DEFAULT_PROFILE_BASE_URL = "https://polymarket.com";
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export class PolymarketDataClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.POLYMARKET_API_BASE || DEFAULT_BASE_URL;
    this.profileBaseUrl = options.profileBaseUrl || process.env.POLYMARKET_PROFILE_BASE || DEFAULT_PROFILE_BASE_URL;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 10000;
  }

  async getWalletData(walletIdentifier) {
    const resolvedUser = await this.resolveUser(walletIdentifier);
    const queryUser = resolvedUser.queryUser;
    const endpoints = [
      ["positions", "/positions", { user: queryUser, limit: "100" }],
      ["closedPositions", "/closed-positions", { user: queryUser, limit: "100" }],
      ["trades", "/trades", { user: queryUser, limit: "150" }],
      ["activities", "/activity", { user: queryUser, limit: "150" }],
      ["value", "/value", { user: queryUser }],
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
      resolvedUser,
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

  async resolveUser(walletIdentifier) {
    const input = String(walletIdentifier || "").trim();
    const username = parsePolymarketUsername(input);

    if (username) {
      const profile = await this.fetchProfilePage(username);
      const proxyWallet = extractProxyWalletFromProfileHtml(profile.html);
      if (proxyWallet) {
        return {
          input,
          queryUser: proxyWallet,
          proxyWallet,
          username,
          resolution: "profile-page",
        };
      }
    }

    if (EVM_ADDRESS_RE.test(input)) {
      const profile = await this.fetchProfileUserData(input).catch(() => null);
      if (profile?.proxyWallet && EVM_ADDRESS_RE.test(profile.proxyWallet)) {
        return {
          input,
          queryUser: profile.proxyWallet,
          proxyWallet: profile.proxyWallet,
          username: profile.name || "",
          profile,
          resolution: profile.proxyWallet.toLowerCase() === input.toLowerCase() ? "proxy-wallet" : "linked-address",
        };
      }

      return {
        input,
        queryUser: input,
        proxyWallet: input,
        username: "",
        resolution: "direct-address",
      };
    }

    return {
      input,
      queryUser: input,
      proxyWallet: input,
      username: username || "",
      resolution: "raw",
    };
  }

  async fetchProfileUserData(address) {
    const url = new URL("/api/profile/userData", this.profileBaseUrl);
    url.searchParams.set("address", address);
    return this.fetchJsonUrl(url);
  }

  async fetchProfilePage(username) {
    const cleanUsername = username.replace(/^@/, "");
    const url = new URL(`/@${encodeURIComponent(cleanUsername)}`, this.profileBaseUrl);
    return { html: await this.fetchTextUrl(url) };
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

    return this.fetchJsonUrl(url, `Polymarket ${path}`);
  }

  async fetchJsonUrl(url, label = "Polymarket") {
    const response = await this.fetchWithTimeout(url, { accept: "application/json" });
    if (!response.ok) {
      throw new Error(`${label} returned ${response.status}`);
    }
    return response.json();
  }

  async fetchTextUrl(url, label = "Polymarket profile") {
    const response = await this.fetchWithTimeout(url, { accept: "text/html" });
    if (!response.ok) {
      throw new Error(`${label} returned ${response.status}`);
    }
    return response.text();
  }

  async fetchWithTimeout(url, headers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parsePolymarketUsername(input) {
  const value = String(input || "").trim();
  if (!value) return "";

  if (value.startsWith("@")) return value.slice(1);

  try {
    const url = new URL(value);
    if (!url.hostname.endsWith("polymarket.com")) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    const profileIndex = parts.findIndex((part) => part === "profile");
    const candidate = profileIndex >= 0 ? parts[profileIndex + 1] : parts.find((part) => part.startsWith("@"));
    return candidate ? decodeURIComponent(candidate).replace(/^@/, "") : "";
  } catch {
    if (/^[a-zA-Z0-9_.-]{2,40}$/.test(value) && !EVM_ADDRESS_RE.test(value)) return value;
    return "";
  }
}

export function extractProxyWalletFromProfileHtml(html) {
  const counts = new Map();
  for (const match of String(html || "").matchAll(/"proxyWallet"\s*:\s*"(0x[a-fA-F0-9]{40})"/g)) {
    const address = match[1].toLowerCase();
    counts.set(address, (counts.get(address) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
