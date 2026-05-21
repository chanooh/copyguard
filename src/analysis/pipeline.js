import { buildRecommendation } from "./agent.js";
import { buildAiInsight, buildAiInsightContext } from "./deepseek.js";
import { computeWalletMetrics } from "./metrics.js";
import { createRecommendationReceipt } from "./receipt.js";
import { PolymarketDataClient } from "../polymarket/client.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const USERNAME_RE = /^@?[a-zA-Z0-9_.-]{2,40}$/;

export function validateWalletAddress(walletAddress) {
  const value = String(walletAddress || "").trim();
  if (WALLET_RE.test(value)) return true;
  if (USERNAME_RE.test(value)) return true;
  try {
    const url = new URL(value);
    return url.hostname.endsWith("polymarket.com");
  } catch {
    return false;
  }
}

export async function analyzeWallet(input, options = {}) {
  const walletAddress = String(input.walletAddress || "").trim();
  if (!validateWalletAddress(walletAddress)) {
    const error = new Error("Enter a valid EVM wallet address beginning with 0x.");
    error.statusCode = 400;
    throw error;
  }

  const client = options.client || new PolymarketDataClient();
  const now = options.now || new Date().toISOString();
  const walletData = await client.getWalletData(walletAddress);
  const metrics = computeWalletMetrics(walletData.normalized, { asOf: now });
  const recommendation = buildRecommendation(metrics, {
    portfolioSizeUsdc: input.portfolioSizeUsdc,
  });
  const aiInsight = await buildAiInsight(
    buildAiInsightContext({
      walletAddress,
      walletData,
      metrics,
      recommendation,
    }),
    options.aiAnalyzer,
  );
  const receipt = createRecommendationReceipt(
    {
      walletAddress,
      metrics,
      recommendation,
    },
    { now },
  );

  return {
    walletAddress,
    fetchedAt: now,
    metrics,
    recommendation,
    aiInsight,
    receipt,
    sources: walletData.sources,
    resolvedUser: walletData.resolvedUser,
    dataCounts: {
      positions: walletData.normalized.positions.length,
      closedPositions: walletData.normalized.closedPositions.length,
      trades: walletData.normalized.trades.length,
      activities: walletData.normalized.activities.length,
    },
    data: {
      positions: compactRecords(walletData.normalized.positions, 100),
      closedPositions: compactRecords(walletData.normalized.closedPositions, 100),
      trades: compactRecords(walletData.normalized.trades, 250),
      activities: compactRecords(walletData.normalized.activities, 250),
    },
    arc: {
      status: "planned",
      label: "Arc recommendation receipt can record this hash on testnet.",
    },
  };
}

function compactRecords(records, limit) {
  return records.slice(0, limit).map(({ raw, ...record }) => record);
}
