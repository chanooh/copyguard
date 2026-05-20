import { buildRecommendation } from "./agent.js";
import { computeWalletMetrics } from "./metrics.js";
import { createRecommendationReceipt } from "./receipt.js";
import { PolymarketDataClient } from "../polymarket/client.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

export function validateWalletAddress(walletAddress) {
  return typeof walletAddress === "string" && WALLET_RE.test(walletAddress.trim());
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
    receipt,
    sources: walletData.sources,
    data: {
      positions: walletData.normalized.positions,
      closedPositions: walletData.normalized.closedPositions,
      trades: walletData.normalized.trades,
      activities: walletData.normalized.activities,
    },
    arc: {
      status: "planned",
      label: "Arc recommendation receipt can record this hash on testnet.",
    },
  };
}

