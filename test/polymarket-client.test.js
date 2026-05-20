import assert from "node:assert/strict";
import test from "node:test";

import { PolymarketDataClient } from "../src/polymarket/client.js";

test("PolymarketDataClient aggregates endpoint data and normalizes it", async () => {
  const calls = [];
  const client = new PolymarketDataClient({
    baseUrl: "https://example.test",
    fetchImpl: async (url) => {
      calls.push(String(url));
      const path = url.pathname;
      const payloads = {
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

  assert.equal(calls.length, 5);
  assert.equal(data.sources.every((source) => source.ok), true);
  assert.equal(data.normalized.positions[0].currentValue, 10);
  assert.equal(data.normalized.closedPositions[0].realizedPnl, 5);
  assert.equal(data.normalized.trades[0].value, 10);
  assert.equal(data.normalized.value.portfolioValue, 15);
});

test("PolymarketDataClient tolerates partial source failures", async () => {
  const client = new PolymarketDataClient({
    baseUrl: "https://example.test",
    fetchImpl: async (url) => {
      if (url.pathname === "/trades") return jsonResponse({ error: "down" }, false, 503);
      return jsonResponse([]);
    },
  });

  const data = await client.getWalletData("0x1234567890abcdef1234567890abcdef12345678");

  assert.equal(data.sources.find((source) => source.key === "trades").ok, false);
  assert.equal(data.normalized.positions.length, 0);
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

