const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export class DeepSeekInsightClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
    this.model = options.model || process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 15000;
  }

  isConfigured() {
    return Boolean(this.apiKey && typeof this.fetchImpl === "function");
  }

  async buildInsight(context) {
    if (!this.isConfigured()) {
      return unavailableInsight("not_configured", "DeepSeek API key is not configured.");
    }

    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await this.requestInsight(context);
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt === 2) break;
        await delay(300 * attempt);
      }
    }

    throw lastError;
  }

  async requestInsight(context) {
    let response;
    try {
      response = await this.fetchWithTimeout(joinUrl(this.baseUrl, "chat/completions"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: buildMessages(context),
          response_format: { type: "json_object" },
          max_tokens: 1400,
        }),
      });
    } catch (error) {
      error.retryable = true;
      throw error;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = new Error(`DeepSeek returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    if (!content.trim()) {
      const error = new Error("DeepSeek returned empty content.");
      error.retryable = true;
      throw error;
    }

    const parsed = parseInsightJson(content);
    return normalizeInsight(parsed, {
      provider: "deepseek",
      model: payload.model || this.model,
    });
  }

  async fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function buildAiInsight(context, analyzer = new DeepSeekInsightClient()) {
  if (analyzer === null) {
    return unavailableInsight("disabled", "AI thesis is disabled for this run.");
  }

  try {
    return await analyzer.buildInsight(context);
  } catch (error) {
    return unavailableInsight(
      "failed",
      "AI thesis is unavailable; deterministic scoring is still complete.",
      error?.message || "AI thesis failed.",
    );
  }
}

export function buildAiInsightContext({ walletAddress, walletData, metrics, recommendation }) {
  const normalized = walletData.normalized;

  return {
    walletAddress,
    resolvedUser: walletData.resolvedUser,
    sources: walletData.sources,
    dataCounts: {
      positions: normalized.positions.length,
      closedPositions: normalized.closedPositions.length,
      trades: normalized.trades.length,
      activities: normalized.activities.length,
    },
    metrics,
    recommendation: {
      decision: recommendation.decision,
      confidence: recommendation.confidence,
      copyScore: recommendation.copyScore,
      riskScore: recommendation.riskScore,
      allocation: recommendation.allocation,
      strengths: recommendation.strengths,
      risks: recommendation.risks,
      stopCopyTriggers: recommendation.stopCopyTriggers,
    },
    samples: {
      largestOpenPositions: normalized.positions
        .slice()
        .sort((a, b) => b.currentValue - a.currentValue)
        .slice(0, 10)
        .map(pickPositionForPrompt),
      largestClosedWins: normalized.closedPositions
        .filter((position) => position.realizedPnl > 0)
        .sort((a, b) => b.realizedPnl - a.realizedPnl)
        .slice(0, 6)
        .map(pickClosedPositionForPrompt),
      largestClosedLosses: normalized.closedPositions
        .filter((position) => position.realizedPnl < 0)
        .sort((a, b) => a.realizedPnl - b.realizedPnl)
        .slice(0, 6)
        .map(pickClosedPositionForPrompt),
      recentTrades: normalized.trades
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10)
        .map(pickTradeForPrompt),
    },
  };
}

export function unavailableInsight(status, message, error = "") {
  return {
    enabled: false,
    provider: "none",
    status,
    thesis: "",
    walletStyle: "",
    keyTakeaways: [],
    riskNarrative: [message],
    copyPlan: [],
    dataCaveats: [],
    error,
  };
}

function buildMessages(context) {
  const system = [
    "You are CopyGuard's Polymarket copy-trading analyst.",
    "Return only valid json. Do not include markdown.",
    "Treat the deterministic metrics, decision, risk score, copy score, and allocation as source of truth.",
    "Do not invent markets or trades. Explain what the data suggests and where the data is weak.",
    "Write concise English for a dashboard.",
    "Required JSON shape:",
    JSON.stringify({
      thesis: "one or two sentences",
      walletStyle: "short style label",
      keyTakeaways: ["2-3 concise observations, each under 160 characters"],
      riskNarrative: ["2-3 concise risks, each under 160 characters"],
      copyPlan: ["2-3 concrete copy-trading rules, each under 160 characters"],
      dataCaveats: ["1-3 data limitations"],
    }),
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Analyze this wallet context and output json:\n${JSON.stringify(context)}`,
    },
  ];
}

function parseInsightJson(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const retryableError = new Error(`DeepSeek returned malformed JSON: ${error.message}`);
    retryableError.retryable = true;
    throw retryableError;
  }
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl).endsWith("/") ? String(baseUrl) : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), base);
}

function normalizeInsight(raw, meta) {
  return {
    enabled: true,
    provider: meta.provider,
    model: meta.model,
    status: "ready",
    thesis: cleanText(raw.thesis, "No AI thesis returned."),
    walletStyle: cleanText(raw.walletStyle, "Mixed strategy wallet"),
    keyTakeaways: cleanList(raw.keyTakeaways, 4),
    riskNarrative: cleanList(raw.riskNarrative, 4),
    copyPlan: cleanList(raw.copyPlan, 4),
    dataCaveats: cleanList(raw.dataCaveats, 3),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickPositionForPrompt(position) {
  return {
    title: position.title,
    outcome: position.outcome,
    currentValue: position.currentValue,
    cashPnl: position.cashPnl,
    unrealizedPnl: position.unrealizedPnl,
    category: position.category,
    endDate: position.endDate,
  };
}

function pickClosedPositionForPrompt(position) {
  return {
    title: position.title,
    outcome: position.outcome,
    realizedPnl: position.realizedPnl,
    category: position.category,
    closedAt: position.closedAt,
  };
}

function pickTradeForPrompt(trade) {
  return {
    title: trade.title,
    outcome: trade.outcome,
    side: trade.side,
    value: trade.value,
    price: trade.price,
    category: trade.category,
    timestamp: trade.timestamp,
  };
}

function cleanList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, "")).filter(Boolean).slice(0, limit);
}

function cleanText(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}
