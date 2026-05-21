import assert from "node:assert/strict";
import test from "node:test";

import {
  DeepSeekInsightClient,
  buildAiInsight,
  buildAiInsightContext,
} from "../src/analysis/deepseek.js";

test("buildAiInsight disables cleanly when analyzer is null", async () => {
  const insight = await buildAiInsight({}, null);

  assert.equal(insight.enabled, false);
  assert.equal(insight.status, "disabled");
});

test("buildAiInsight converts analyzer errors into unavailable insight", async () => {
  const insight = await buildAiInsight(
    {},
    {
      async buildInsight() {
        throw new Error("provider down");
      },
    },
  );

  assert.equal(insight.enabled, false);
  assert.equal(insight.status, "failed");
  assert.match(insight.riskNarrative[0], /deterministic scoring/);
  assert.match(insight.error, /provider down/);
});

test("DeepSeekInsightClient posts a JSON-mode chat completion request", async () => {
  const calls = [];
  const client = new DeepSeekInsightClient({
    apiKey: "test-key",
    baseUrl: "https://deepseek.example",
    model: "deepseek-test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            model: "deepseek-test",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    thesis: "Strong realized PnL, but copy sizing should stay capped.",
                    walletStyle: "Crypto-heavy event trader",
                    keyTakeaways: ["Profits are concentrated in event markets."],
                    riskNarrative: ["Open exposure is still crypto-heavy."],
                    copyPlan: ["Follow only below the recommended allocation cap."],
                    dataCaveats: ["Polymarket public data may lag live execution."],
                  }),
                },
              },
            ],
          };
        },
      };
    },
  });

  const insight = await client.buildInsight({ metrics: { copyScore: 77, riskScore: 29 } });

  assert.equal(insight.status, "ready");
  assert.equal(insight.provider, "deepseek");
  assert.equal(insight.walletStyle, "Crypto-heavy event trader");
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url), "https://deepseek.example/chat/completions");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].options.headers.authorization, "Bearer test-key");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.model, "deepseek-test");
  assert.match(body.messages[0].content, /json/i);
});

test("DeepSeekInsightClient retries malformed JSON once", async () => {
  let callCount = 0;
  const client = new DeepSeekInsightClient({
    apiKey: "test-key",
    baseUrl: "https://deepseek.example",
    model: "deepseek-test",
    fetchImpl: async () => {
      callCount += 1;
      return {
        ok: true,
        async json() {
          return {
            model: "deepseek-test",
            choices: [
              {
                message: {
                  content:
                    callCount === 1
                      ? '{"thesis":"unterminated'
                      : JSON.stringify({
                          thesis: "Recovered JSON.",
                          walletStyle: "Recovered",
                          keyTakeaways: [],
                          riskNarrative: [],
                          copyPlan: [],
                          dataCaveats: [],
                        }),
                },
              },
            ],
          };
        },
      };
    },
  });

  const insight = await client.buildInsight({ metrics: {} });

  assert.equal(callCount, 2);
  assert.equal(insight.status, "ready");
  assert.equal(insight.thesis, "Recovered JSON.");
});

test("buildAiInsightContext keeps prompt payload compact and sorted", () => {
  const context = buildAiInsightContext({
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    metrics: { copyScore: 80, riskScore: 20 },
    recommendation: {
      decision: "follow",
      confidence: "high",
      copyScore: 80,
      riskScore: 20,
      allocation: { maxAllocationUsdc: 120 },
      strengths: [],
      risks: [],
      stopCopyTriggers: [],
    },
    walletData: {
      resolvedUser: { proxyWallet: "0x1234567890abcdef1234567890abcdef12345678" },
      sources: [{ key: "positions", ok: true, count: 2 }],
      normalized: {
        positions: [
          { title: "Small", currentValue: 1, cashPnl: 0, unrealizedPnl: 0, category: "sports" },
          { title: "Large", currentValue: 20, cashPnl: 2, unrealizedPnl: 1, category: "crypto" },
        ],
        closedPositions: [
          { title: "Win", realizedPnl: 50, category: "crypto" },
          { title: "Loss", realizedPnl: -10, category: "politics" },
        ],
        trades: [{ title: "Trade", value: 5, timestamp: "2026-05-20T00:00:00.000Z" }],
        activities: [],
      },
    },
  });

  assert.equal(context.samples.largestOpenPositions[0].title, "Large");
  assert.equal(context.samples.largestClosedWins[0].title, "Win");
  assert.equal(context.samples.largestClosedLosses[0].title, "Loss");
  assert.equal(context.dataCounts.positions, 2);
});
