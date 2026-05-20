export function computeWalletMetrics(input, options = {}) {
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const closedPositions = Array.isArray(input.closedPositions) ? input.closedPositions : [];
  const trades = Array.isArray(input.trades) ? input.trades : [];
  const value = input.value || {};
  const asOf = options.asOf ? new Date(options.asOf) : new Date();

  const positionValue = sum(positions, (position) => position.currentValue);
  const portfolioValue = positiveNumber(value.portfolioValue) || positionValue;
  const largestPositionValue = positions.reduce((max, position) => Math.max(max, positiveNumber(position.currentValue)), 0);
  const largestPositionPct = portfolioValue > 0 ? round(largestPositionValue / portfolioValue, 4) : 0;

  const realizedPnl = round(sum(closedPositions, (position) => position.realizedPnl), 2);
  const unrealizedPnl = round(sum(positions, (position) => position.unrealizedPnl), 2);
  const totalPnl = round(realizedPnl + unrealizedPnl, 2);
  const wins = closedPositions.filter((position) => positiveOrNegative(position.realizedPnl) > 0).length;
  const winRate = closedPositions.length > 0 ? round(wins / closedPositions.length, 4) : 0;
  const recent30dTradeCount = trades.filter((trade) => isWithinDays(trade.timestamp, asOf, 30)).length;
  const recent30dPnl = round(
    sum(
      closedPositions.filter((position) => isWithinDays(position.closedAt, asOf, 30)),
      (position) => position.realizedPnl,
    ),
    2,
  );

  const categoryExposure = buildCategoryExposure(positions, portfolioValue);
  const marketConcentration = round(herfindahl(positions.map((position) => positiveNumber(position.currentValue)), portfolioValue), 4);
  const strategyDriftScore = computeStrategyDriftScore(positions, closedPositions, trades);
  const drawdownEstimate = computeDrawdownEstimate(totalPnl, recent30dPnl, portfolioValue);
  const hasWalletActivity = positions.length > 0 || closedPositions.length > 0 || trades.length > 0;
  const samplePenalty = closedPositions.length < 3 ? 25 : closedPositions.length < 10 ? 10 : 0;
  const concentrationPenalty = largestPositionPct >= 0.8 ? 32 : largestPositionPct >= 0.6 ? 22 : largestPositionPct >= 0.4 ? 12 : 0;
  const recentLossPenalty = recent30dPnl < 0 ? Math.min(18, Math.abs(recent30dPnl) / Math.max(portfolioValue, 1) * 100) : 0;
  const profitabilityScore = scoreProfitability(totalPnl, portfolioValue);
  const consistencyScore = closedPositions.length > 0 ? winRate * 22 : 0;
  const diversificationScore = positions.length === 0 ? 0 : Math.max(0, 16 - concentrationPenalty / 2);
  const activityScore = recent30dTradeCount > 0 ? 8 : positions.length > 0 ? 4 : 0;

  const copyScore = hasWalletActivity
    ? clampScore(
        20 +
          profitabilityScore +
          consistencyScore +
          diversificationScore +
          activityScore -
          samplePenalty -
          concentrationPenalty / 2 -
          recentLossPenalty -
          strategyDriftScore / 8,
      )
    : 20;

  const riskScore = hasWalletActivity
    ? clampScore(
        20 +
          samplePenalty +
          concentrationPenalty +
          recentLossPenalty +
          strategyDriftScore / 2 +
          drawdownEstimate * 40,
      )
    : 75;

  return {
    portfolioValue: round(portfolioValue, 2),
    openPositionCount: positions.length,
    closedPositionCount: closedPositions.length,
    tradeCount: trades.length,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    winRate,
    largestPositionValue: round(largestPositionValue, 2),
    largestPositionPct,
    marketConcentration,
    recent30dTradeCount,
    recent30dPnl,
    categoryExposure,
    strategyDriftScore: round(strategyDriftScore, 2),
    drawdownEstimate: round(drawdownEstimate, 4),
    copyScore,
    riskScore,
  };
}

function buildCategoryExposure(positions, portfolioValue) {
  const buckets = new Map();
  for (const position of positions) {
    const category = position.category || "uncategorized";
    buckets.set(category, (buckets.get(category) || 0) + positiveNumber(position.currentValue));
  }

  return [...buckets.entries()]
    .map(([category, value]) => ({
      category,
      value: round(value, 2),
      pct: portfolioValue > 0 ? round(value / portfolioValue, 4) : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

function computeStrategyDriftScore(positions, closedPositions, trades) {
  const current = dominantCategory(positions);
  const historical = dominantCategory([...closedPositions, ...trades]);

  if (!current.category || !historical.category) return 35;
  if (current.category === historical.category) return current.pct >= 0.75 ? 18 : 8;
  if (current.pct >= 0.65 && historical.pct >= 0.45) return 75;
  return 55;
}

function dominantCategory(records) {
  const totals = new Map();
  let total = 0;

  for (const record of records) {
    const category = record.category || "uncategorized";
    const value = positiveNumber(record.currentValue) || Math.abs(positiveOrNegative(record.realizedPnl)) || positiveNumber(record.value) || 1;
    totals.set(category, (totals.get(category) || 0) + value);
    total += value;
  }

  const [category, value] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0] || ["", 0];
  return { category, pct: total > 0 ? value / total : 0 };
}

function computeDrawdownEstimate(totalPnl, recent30dPnl, portfolioValue) {
  if (portfolioValue <= 0) {
    return totalPnl < 0 || recent30dPnl < 0 ? 0.4 : 0;
  }
  const loss = Math.abs(Math.min(totalPnl, recent30dPnl, 0));
  return Math.min(1, loss / portfolioValue);
}

function scoreProfitability(totalPnl, portfolioValue) {
  if (portfolioValue <= 0) return 0;
  const pnlPct = totalPnl / portfolioValue;
  if (pnlPct >= 0.25) return 28;
  if (pnlPct >= 0.1) return 22;
  if (pnlPct >= 0.03) return 14;
  if (pnlPct >= 0) return 8;
  if (pnlPct >= -0.08) return 0;
  return -12;
}

function herfindahl(values, total) {
  if (total <= 0) return 0;
  return values.reduce((acc, value) => {
    const pct = positiveNumber(value) / total;
    return acc + pct * pct;
  }, 0);
}

function isWithinDays(value, asOf, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const ms = asOf.getTime() - date.getTime();
  return ms >= 0 && ms <= days * 24 * 60 * 60 * 1000;
}

function sum(records, selector) {
  return records.reduce((total, record) => total + positiveOrNegative(selector(record)), 0);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function positiveOrNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}
