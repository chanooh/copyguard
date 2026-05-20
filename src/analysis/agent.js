export function buildRecommendation(metrics, options = {}) {
  const portfolioSizeUsdc = normalizePortfolioSize(options.portfolioSizeUsdc);
  const decision = chooseDecision(metrics.copyScore, metrics.riskScore);
  const maxAllocationPct = chooseAllocationPct(decision, metrics.copyScore, metrics.riskScore);
  const maxAllocationUsdc = Math.round(portfolioSizeUsdc * maxAllocationPct);
  const maxPerMarketUsdc = maxAllocationUsdc === 0 ? 0 : Math.max(1, Math.round(Math.min(maxAllocationUsdc * 0.35, portfolioSizeUsdc * 0.05)));

  const strengths = buildStrengths(metrics);
  const risks = buildRisks(metrics);
  const stopCopyTriggers = buildStopCopyTriggers(metrics);

  return {
    decision,
    copyScore: metrics.copyScore,
    riskScore: metrics.riskScore,
    confidence: chooseConfidence(metrics),
    summary: buildSummary(decision, metrics),
    strengths,
    risks,
    allocation: {
      portfolioSizeUsdc,
      maxAllocationUsdc,
      maxAllocationPct: round(maxAllocationPct * 100, 2),
      reserveUsdc: portfolioSizeUsdc - maxAllocationUsdc,
      maxPerMarketUsdc,
    },
    stopCopyTriggers,
  };
}

function chooseDecision(copyScore, riskScore) {
  if (copyScore >= 75 && riskScore <= 45) return "follow";
  if (copyScore >= 55 && riskScore <= 70) return "watch";
  if (copyScore >= 35 && riskScore < 88) return "reduce";
  return "avoid";
}

function chooseAllocationPct(decision, copyScore, riskScore) {
  if (decision === "avoid") return 0;

  const riskAdjusted = Math.max(0, (copyScore - riskScore + 70) / 100);
  const base = (copyScore / 100) * 0.18 * riskAdjusted;

  if (decision === "follow") return clamp(base, 0.08, 0.2);
  if (decision === "watch") return clamp(base, 0.03, 0.1);
  return clamp(base, 0.01, 0.05);
}

function buildSummary(decision, metrics) {
  const label = {
    follow: "This wallet has enough signal quality for a capped copy allocation.",
    watch: "This wallet is interesting, but the risk profile needs a conservative cap.",
    reduce: "This wallet shows useful signal, but current risks are too high for normal copying.",
    avoid: "This wallet is not copy-safe under the current risk profile.",
  }[decision];

  return `${label} Copy score ${metrics.copyScore}/100, risk score ${metrics.riskScore}/100.`;
}

function buildStrengths(metrics) {
  const strengths = [];
  if (metrics.totalPnl > 0) strengths.push(`Positive total PnL of ${formatUsd(metrics.totalPnl)}.`);
  if (metrics.winRate >= 0.55) strengths.push(`Win rate is ${(metrics.winRate * 100).toFixed(0)}% across closed positions.`);
  if (metrics.recent30dPnl > 0) strengths.push(`Recent 30-day realized PnL is positive at ${formatUsd(metrics.recent30dPnl)}.`);
  if (metrics.largestPositionPct > 0 && metrics.largestPositionPct <= 0.35) strengths.push("Current exposure is reasonably diversified.");
  if (strengths.length === 0) strengths.push("No strong copy-trading strengths were detected from the available data.");
  return strengths;
}

function buildRisks(metrics) {
  const risks = [];
  if (metrics.largestPositionPct >= 0.6) risks.push(`Current exposure is highly concentrated: largest position is ${(metrics.largestPositionPct * 100).toFixed(0)}% of portfolio value.`);
  if (metrics.closedPositionCount < 3) risks.push("Limited closed-position sample size makes the historical edge hard to trust.");
  if (metrics.recent30dPnl < 0) risks.push(`Recent 30-day realized PnL is negative at ${formatUsd(metrics.recent30dPnl)}.`);
  if (metrics.strategyDriftScore >= 50) risks.push("Strategy drift detected: current exposure differs from historical behavior.");
  if (metrics.drawdownEstimate >= 0.15) risks.push("Estimated drawdown pressure is material relative to current portfolio value.");
  if (risks.length === 0) risks.push("No severe risk flags were detected, but allocation should remain capped.");
  return risks;
}

function buildStopCopyTriggers(metrics) {
  const triggers = [
    "Stop copying if realized drawdown exceeds 12% from the recommendation timestamp.",
    "Stop copying if three consecutive high-conviction copied trades close at a loss.",
  ];

  if (metrics.largestPositionPct >= 0.5) {
    triggers.push("Stop or reduce if one market remains above 50% of wallet exposure.");
  } else {
    triggers.push("Reduce if any single market grows above 40% of copied exposure.");
  }

  if (metrics.strategyDriftScore >= 50) {
    triggers.push("Re-check before copying new categories that differ from this wallet's historical edge.");
  }

  return triggers;
}

function chooseConfidence(metrics) {
  if (metrics.closedPositionCount >= 20 && metrics.tradeCount >= 40) return "high";
  if (metrics.closedPositionCount >= 5 || metrics.tradeCount >= 10) return "medium";
  return "low";
}

function normalizePortfolioSize(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 1000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatUsd(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}
