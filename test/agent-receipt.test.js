import assert from "node:assert/strict";
import test from "node:test";

import { buildRecommendation } from "../src/analysis/agent.js";
import { createRecommendationReceipt } from "../src/analysis/receipt.js";

test("buildRecommendation returns a structured allocation decision", () => {
  const recommendation = buildRecommendation(
    {
      copyScore: 78,
      riskScore: 38,
      portfolioValue: 1200,
      largestPositionPct: 0.24,
      closedPositionCount: 28,
      recent30dPnl: 90,
      strategyDriftScore: 12,
      winRate: 0.61,
    },
    { portfolioSizeUsdc: 1000 },
  );

  assert.equal(recommendation.decision, "follow");
  assert.ok(recommendation.allocation.maxAllocationUsdc > 100);
  assert.equal(recommendation.allocation.portfolioSizeUsdc, 1000);
  assert.ok(recommendation.stopCopyTriggers.length >= 2);
});

test("buildRecommendation avoids high-risk wallets", () => {
  const recommendation = buildRecommendation(
    {
      copyScore: 36,
      riskScore: 91,
      portfolioValue: 80,
      largestPositionPct: 0.92,
      closedPositionCount: 1,
      recent30dPnl: -40,
      strategyDriftScore: 80,
      winRate: 0,
    },
    { portfolioSizeUsdc: 1000 },
  );

  assert.equal(recommendation.decision, "avoid");
  assert.equal(recommendation.allocation.maxAllocationUsdc, 0);
  assert.ok(recommendation.risks.some((risk) => risk.includes("concentrated")));
});

test("createRecommendationReceipt is deterministic and decision-sensitive", () => {
  const baseInput = {
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    metrics: {
      copyScore: 70,
      riskScore: 42,
      portfolioValue: 500,
    },
    recommendation: {
      decision: "watch",
      allocation: { maxAllocationUsdc: 75 },
      summary: "Worth monitoring.",
    },
  };

  const first = createRecommendationReceipt(baseInput, { now: "2026-05-20T00:00:00.000Z" });
  const second = createRecommendationReceipt(baseInput, { now: "2026-05-20T00:00:00.000Z" });
  const changed = createRecommendationReceipt(
    {
      ...baseInput,
      recommendation: {
        ...baseInput.recommendation,
        decision: "avoid",
      },
    },
    { now: "2026-05-20T00:00:00.000Z" },
  );

  assert.equal(first.hash, second.hash);
  assert.notEqual(first.hash, changed.hash);
  assert.match(first.hash, /^0x[a-f0-9]{64}$/);
});

