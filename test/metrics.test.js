import assert from "node:assert/strict";
import test from "node:test";

import { computeWalletMetrics } from "../src/analysis/metrics.js";

const asOf = new Date("2026-05-20T00:00:00.000Z");

test("computeWalletMetrics summarizes portfolio, PnL, win rate, and concentration", () => {
  const metrics = computeWalletMetrics(
    {
      positions: [
        {
          id: "p1",
          title: "Market A",
          currentValue: 700,
          cashPnl: 100,
          unrealizedPnl: 80,
          category: "politics",
        },
        {
          id: "p2",
          title: "Market B",
          currentValue: 300,
          cashPnl: -20,
          unrealizedPnl: -20,
          category: "macro",
        },
      ],
      closedPositions: [
        { id: "c1", realizedPnl: 40, category: "politics", closedAt: "2026-05-16T00:00:00.000Z" },
        { id: "c2", realizedPnl: -10, category: "politics", closedAt: "2026-04-01T00:00:00.000Z" },
      ],
      trades: [
        { id: "t1", side: "buy", value: 100, timestamp: "2026-05-19T00:00:00.000Z" },
        { id: "t2", side: "sell", value: 50, timestamp: "2026-03-01T00:00:00.000Z" },
      ],
      activities: [],
      value: { portfolioValue: 1000 },
    },
    { asOf },
  );

  assert.equal(metrics.portfolioValue, 1000);
  assert.equal(metrics.openPositionCount, 2);
  assert.equal(metrics.closedPositionCount, 2);
  assert.equal(metrics.realizedPnl, 30);
  assert.equal(metrics.unrealizedPnl, 60);
  assert.equal(metrics.winRate, 0.5);
  assert.equal(metrics.largestPositionPct, 0.7);
  assert.equal(metrics.recent30dTradeCount, 1);
  assert.ok(metrics.riskScore > metrics.copyScore - 20);
  assert.ok(metrics.copyScore >= 0 && metrics.copyScore <= 100);
  assert.ok(metrics.riskScore >= 0 && metrics.riskScore <= 100);
});

test("computeWalletMetrics penalizes limited samples and strategy drift", () => {
  const metrics = computeWalletMetrics(
    {
      positions: [
        { id: "p1", title: "Sports market", currentValue: 100, category: "sports" },
      ],
      closedPositions: [
        { id: "c1", realizedPnl: 15, category: "politics", closedAt: "2026-05-18T00:00:00.000Z" },
      ],
      trades: [],
      activities: [],
      value: { portfolioValue: 100 },
    },
    { asOf },
  );

  assert.equal(metrics.closedPositionCount, 1);
  assert.ok(metrics.strategyDriftScore >= 50);
  assert.ok(metrics.riskScore >= 55);
  assert.ok(metrics.copyScore <= 60);
});

test("computeWalletMetrics handles empty wallets without NaN scores", () => {
  const metrics = computeWalletMetrics(
    {
      positions: [],
      closedPositions: [],
      trades: [],
      activities: [],
      value: { portfolioValue: 0 },
    },
    { asOf },
  );

  assert.equal(metrics.portfolioValue, 0);
  assert.equal(metrics.copyScore, 20);
  assert.equal(metrics.riskScore, 75);
  assert.equal(Number.isNaN(metrics.winRate), false);
});

