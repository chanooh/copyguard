export function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const key of ["data", "positions", "closedPositions", "trades", "activity", "activities", "result", "results"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return [];
}

export function toNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (cleaned === "") return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

export function normalizePositions(payload) {
  return toArray(payload).map((raw, index) => {
    const title = pickString(raw, ["title", "marketTitle", "question", "name"], "Unknown market");
    const currentValue = pickNumber(raw, ["currentValue", "value", "positionValue", "marketValue", "amount"], 0);
    const cashPnl = pickNumber(raw, ["cashPnl", "pnl", "profit", "totalPnl"], 0);
    const realizedPnl = pickNumber(raw, ["realizedPnl", "realized", "realizedProfit"], 0);
    const unrealizedPnl = pickNumber(raw, ["unrealizedPnl", "unrealized", "cashPnl"], cashPnl - realizedPnl);

    return {
      id: pickString(raw, ["id", "asset", "assetId", "conditionId", "marketId", "tokenId"], `position-${index}`),
      title,
      marketId: pickString(raw, ["marketId", "conditionId", "condition_id", "market"], ""),
      slug: pickString(raw, ["slug", "marketSlug"], ""),
      outcome: pickString(raw, ["outcome", "outcomeName", "side", "token"], "Unknown"),
      currentValue,
      cashPnl,
      realizedPnl,
      unrealizedPnl,
      size: pickNumber(raw, ["size", "shares", "quantity", "balance"], 0),
      avgPrice: pickNumber(raw, ["avgPrice", "averagePrice", "average_price"], 0),
      curPrice: pickNumber(raw, ["curPrice", "price", "currentPrice"], 0),
      category: normalizeCategory(raw),
      endDate: pickString(raw, ["endDate", "endDateIso", "end_date"], ""),
      raw,
    };
  });
}

export function normalizeClosedPositions(payload) {
  return toArray(payload).map((raw, index) => {
    const realizedPnl = pickNumber(raw, ["realizedPnl", "cashPnl", "pnl", "profit", "totalPnl"], 0);

    return {
      id: pickString(raw, ["id", "asset", "assetId", "conditionId", "marketId", "tokenId"], `closed-${index}`),
      title: pickString(raw, ["title", "marketTitle", "question", "name"], "Unknown market"),
      marketId: pickString(raw, ["marketId", "conditionId", "condition_id", "market"], ""),
      outcome: pickString(raw, ["outcome", "outcomeName", "side", "token"], "Unknown"),
      realizedPnl,
      cashPnl: pickNumber(raw, ["cashPnl", "pnl", "profit"], realizedPnl),
      value: pickNumber(raw, ["value", "currentValue", "proceeds", "amount"], 0),
      category: normalizeCategory(raw),
      closedAt: pickTimestamp(raw, ["closedAt", "closedTime", "timestamp", "createdAt", "updatedAt", "endDate"]),
      win: realizedPnl > 0,
      raw,
    };
  });
}

export function normalizeTrades(payload) {
  return toArray(payload).map((raw, index) => {
    const price = pickNumber(raw, ["price", "avgPrice", "executionPrice"], 0);
    const size = pickNumber(raw, ["size", "shares", "quantity", "amount"], 0);
    const value = pickNumber(raw, ["value", "usdcValue", "usdcSize", "notional", "collateral"], price * size);

    return {
      id: pickString(raw, ["id", "transactionHash", "txHash", "hash"], `trade-${index}`),
      title: pickString(raw, ["title", "marketTitle", "question", "name"], "Unknown market"),
      marketId: pickString(raw, ["marketId", "conditionId", "condition_id", "market"], ""),
      outcome: pickString(raw, ["outcome", "outcomeName", "token"], "Unknown"),
      side: normalizeSide(pickString(raw, ["side", "action", "type"], "")),
      price,
      size,
      value,
      timestamp: pickTimestamp(raw, ["timestamp", "createdAt", "created_at", "time"]),
      category: normalizeCategory(raw),
      raw,
    };
  });
}

export function normalizeActivities(payload) {
  return toArray(payload).map((raw, index) => ({
    id: pickString(raw, ["id", "transactionHash", "txHash", "hash"], `activity-${index}`),
    type: normalizeSide(pickString(raw, ["type", "action", "side"], "activity")),
    title: pickString(raw, ["title", "marketTitle", "question", "name"], "Unknown market"),
    value: pickNumber(raw, ["value", "amount", "usdcValue", "usdcSize", "collateral"], 0),
    timestamp: pickTimestamp(raw, ["timestamp", "createdAt", "created_at", "time"]),
    category: normalizeCategory(raw),
    raw,
  }));
}

function pickTimestamp(raw, keys) {
  for (const key of keys) {
    if (Object.hasOwn(raw, key)) {
      return normalizeTimestamp(raw[key]);
    }
  }
  return "";
}

export function normalizeValue(payload) {
  if (typeof payload === "number" || typeof payload === "string") {
    return { portfolioValue: toNumber(payload, 0) };
  }

  const candidate = Array.isArray(payload) ? payload[0] : payload;
  if (!candidate || typeof candidate !== "object") {
    return { portfolioValue: 0 };
  }

  return {
    portfolioValue: pickNumber(candidate, ["portfolioValue", "value", "totalValue", "currentValue", "amount"], 0),
  };
}

function pickNumber(raw, keys, fallback) {
  for (const key of keys) {
    if (Object.hasOwn(raw, key)) {
      return toNumber(raw[key], fallback);
    }
  }
  return fallback;
}

function pickString(raw, keys, fallback) {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function normalizeSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (["buy", "bought", "purchase"].includes(side)) return "buy";
  if (["sell", "sold", "redeem"].includes(side)) return "sell";
  if (["merge", "split", "claim"].includes(side)) return side;
  return side || "unknown";
}

function normalizeCategory(raw) {
  const direct = raw?.category || raw?.categoryName || raw?.eventCategory;
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim().toLowerCase();

  const tags = raw?.tags || raw?.tag;
  if (Array.isArray(tags) && tags.length > 0) {
    const tag = typeof tags[0] === "string" ? tags[0] : tags[0]?.label || tags[0]?.name;
    if (tag) return String(tag).trim().toLowerCase();
  }

  return inferCategoryFromText([raw?.title, raw?.slug, raw?.eventSlug, raw?.icon].filter(Boolean).join(" "));
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const number = Number(trimmed);
      const millis = number > 10_000_000_000 ? number : number * 1000;
      return new Date(millis).toISOString();
    }

    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return "";
}

function inferCategoryFromText(text) {
  const value = String(text || "").toLowerCase();

  if (/\b(bitcoin|btc|ethereum|eth|solana|crypto|token|fdv|airdrop|stablecoin|defi|dex|cex|binance|coinbase|grvt|ostium|edgex|standx|printr|predict\.fun|probable|spacex ipo)\b/.test(value)) {
    return "crypto";
  }

  if (/\b(nba|nfl|mlb|nhl|soccer|football|tennis|ufc|boxing|f1|formula|drivers'? champion|lol|league of legends|lck|t1|drx|kiwoom|hawks|pistons|esports)\b/.test(value)) {
    return "sports";
  }

  if (/\b(election|mayor|senate|congress|trump|biden|netanyahu|iran|israel|lebanon|ukraine|russia|ceasefire|government|democratic|republican|presidential|prime minister|head of state|governor|military action|ground offensive|seoul)\b/.test(value)) {
    return "politics";
  }

  if (/\b(fed|rate|rates|interest|nasdaq|ndx|s&p|dow|stock|market cap|inflation|cpi|gdp|unemployment|treasury|ipo|crude oil|oil|gold|silver|commodity|commodities)\b/.test(value)) {
    return "finance";
  }

  if (/\b(movie|oscar|grammy|music|album|celebrity|nobel|ufo|anthropic ceo)\b/.test(value)) {
    return "culture";
  }

  if (/\b(weather|hurricane|temperature|rain|snow|storm)\b/.test(value)) {
    return "weather";
  }

  return "uncategorized";
}
