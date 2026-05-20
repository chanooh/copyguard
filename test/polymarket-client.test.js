import assert from "node:assert/strict";
import test from "node:test";

import {
  extractProxyWalletFromProfileHtml,
  parsePolymarketUsername,
  PolymarketDataClient,
} from "../src/polymarket/client.js";

test("PolymarketDataClient aggregates endpoint data and normalizes it", async () => {
  const calls = [];
  const client = new PolymarketDataClient({
    baseUrl: "https://example.test",
    profileBaseUrl: "https://profile.test",
    fetchImpl: async (url) => {
      calls.push(String(url));
      const path = url.pathname;
      const payloads = {
        "/api/profile/userData": null,
        "/positions": [{ title: "Open", currentValue: "10", category: "politics" }],
        "/closed-positions": [{ title: "Closed", realizedPnl: "5", category: "politics" }],
        "/trades": [{ title: "Trade", side: "BUY", price: "0.5", size: "20" }],
        "/activity": [{ title: "Activity", type: "SELL", value: "3" }],
        "/value": { value: "15" },
      };
      return jsonResponse(payloads[path]);
    },
  });

  const data = await client.getWalletData("0x1234567890abcdef1234567890abcdef12345678");

  assert.equal(calls.length, 6);
  assert.equal(data.sources.every((source) => source.ok), true);
  assert.equal(data.resolvedUser.resolution, "direct-address");
  assert.equal(data.normalized.positions[0].currentValue, 10);
  assert.equal(data.normalized.closedPositions[0].realizedPnl, 5);
  assert.equal(data.normalized.trades[0].value, 10);
  assert.equal(data.normalized.value.portfolioValue, 15);
});

test("PolymarketDataClient tolerates partial source failures", async () => {
  const client = new PolymarketDataClient({
    baseUrl: "https://example.test",
    profileBaseUrl: "https://profile.test",
    fetchImpl: async (url) => {
      if (url.pathname === "/api/profile/userData") return jsonResponse(null);
      if (url.pathname === "/trades") return jsonResponse({ error: "down" }, false, 503);
      return jsonResponse([]);
    },
  });

  const data = await client.getWalletData("0x1234567890abcdef1234567890abcdef12345678");

  assert.equal(data.sources.find((source) => source.key === "trades").ok, false);
  assert.equal(data.normalized.positions.length, 0);
});

test("PolymarketDataClient resolves linked Polymarket profile addresses to proxy wallets", async () => {
  const profileAddress = "0xaf68e51f30a7ea63343b81ce9220ae44a2d6a811";
  const proxyWallet = "0xab1cab72897cb41d07b925107b065a88465b35a7";
  const requestedUsers = [];
  const client = new PolymarketDataClient({
    baseUrl: "https://example.test",
    profileBaseUrl: "https://profile.test",
    fetchImpl: async (url) => {
      if (url.pathname === "/api/profile/userData") {
        return jsonResponse({ name: "bbxiang", proxyWallet });
      }
      requestedUsers.push(url.searchParams.get("user"));
      if (url.pathname === "/value") return jsonResponse([{ value: "1878.23" }]);
      return jsonResponse([]);
    },
  });

  const data = await client.getWalletData(profileAddress);

  assert.equal(data.resolvedUser.resolution, "linked-address");
  assert.equal(data.resolvedUser.queryUser, proxyWallet);
  assert.equal(data.normalized.value.portfolioValue, 1878.23);
  assert.deepEqual([...new Set(requestedUsers)], [proxyWallet]);
});

test("PolymarketDataClient resolves profile URLs from embedded proxyWallet values", async () => {
  const proxyWallet = "0xab1cab72897cb41d07b925107b065a88465b35a7";
  const client = new PolymarketDataClient({
    baseUrl: "https://example.test",
    profileBaseUrl: "https://profile.test",
    fetchImpl: async (url) => {
      if (url.pathname === "/@bbxiang") {
        return textResponse(`{"proxyWallet":"${proxyWallet}"}{"proxyWallet":"${proxyWallet}"}`);
      }
      if (url.pathname === "/value") return jsonResponse([{ value: "100" }]);
      return jsonResponse([]);
    },
  });

  const data = await client.getWalletData("https://polymarket.com/@bbxiang");

  assert.equal(data.resolvedUser.resolution, "profile-page");
  assert.equal(data.resolvedUser.username, "bbxiang");
  assert.equal(data.resolvedUser.queryUser, proxyWallet);
});

test("parsePolymarketUsername and extractProxyWalletFromProfileHtml support profile inputs", () => {
  assert.equal(parsePolymarketUsername("@bbxiang"), "bbxiang");
  assert.equal(parsePolymarketUsername("https://polymarket.com/@bbxiang"), "bbxiang");
  assert.equal(parsePolymarketUsername("https://polymarket.com/profile/%40bbxiang"), "bbxiang");
  assert.equal(
    extractProxyWalletFromProfileHtml(
      '{"proxyWallet":"0x1111111111111111111111111111111111111111"}{"proxyWallet":"0x2222222222222222222222222222222222222222"}{"proxyWallet":"0x2222222222222222222222222222222222222222"}',
    ),
    "0x2222222222222222222222222222222222222222",
  );
});

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

function textResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return body;
    },
  };
}
