import assert from "node:assert/strict";
import test from "node:test";

import { analyzeWallet, validateWalletAddress } from "../src/analysis/pipeline.js";

test("validateWalletAddress accepts wallets and Polymarket profile identifiers", () => {
  assert.equal(validateWalletAddress("0x1234567890abcdef1234567890abcdef12345678"), true);
  assert.equal(validateWalletAddress("@bbxiang"), true);
  assert.equal(validateWalletAddress("https://polymarket.com/@bbxiang"), true);
  assert.equal(validateWalletAddress("x"), false);
  assert.equal(validateWalletAddress("0xnothex7890abcdef1234567890abcdef12345678"), false);
});

test("analyzeWallet returns the full dashboard contract", async () => {
  const result = await analyzeWallet(
    {
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      portfolioSizeUsdc: 1000,
    },
    {
      now: "2026-05-20T00:00:00.000Z",
      client: {
        async getWalletData() {
          return {
            normalized: {
              positions: [{ id: "p1", title: "Market", currentValue: 200, category: "politics" }],
              closedPositions: [{ id: "c1", title: "Closed", realizedPnl: 20, category: "politics" }],
              trades: [{ id: "t1", value: 100, side: "buy", timestamp: "2026-05-19T00:00:00.000Z" }],
              activities: [],
              value: { portfolioValue: 300 },
            },
            sources: [{ key: "positions", ok: true }],
            resolvedUser: {
              input: "0x1234567890abcdef1234567890abcdef12345678",
              queryUser: "0x1234567890abcdef1234567890abcdef12345678",
              proxyWallet: "0x1234567890abcdef1234567890abcdef12345678",
              resolution: "direct-address",
            },
          };
        },
      },
    },
  );

  assert.equal(result.walletAddress, "0x1234567890abcdef1234567890abcdef12345678");
  assert.equal(result.metrics.portfolioValue, 300);
  assert.ok(["follow", "watch", "reduce", "avoid"].includes(result.recommendation.decision));
  assert.match(result.receipt.hash, /^0x[a-f0-9]{64}$/);
  assert.equal(result.arc.status, "planned");
  assert.equal(result.resolvedUser.resolution, "direct-address");
});
