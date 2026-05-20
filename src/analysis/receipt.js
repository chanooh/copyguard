import { createHash } from "node:crypto";

export function createRecommendationReceipt(input, options = {}) {
  const timestamp = options.now || new Date().toISOString();
  const receipt = {
    schema: "copyguard.recommendation.v1",
    timestamp,
    walletAddress: input.walletAddress,
    decision: input.recommendation.decision,
    copyScore: input.metrics.copyScore,
    riskScore: input.metrics.riskScore,
    portfolioValue: input.metrics.portfolioValue,
    maxAllocationUsdc: input.recommendation.allocation.maxAllocationUsdc,
    summary: input.recommendation.summary,
  };

  const hash = hashReceipt(receipt);
  return { ...receipt, hash };
}

export function hashReceipt(receipt) {
  const canonical = stableStringify(receipt);
  return `0x${createHash("sha256").update(canonical).digest("hex")}`;
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

