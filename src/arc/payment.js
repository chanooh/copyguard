const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export const ARC_TESTNET = {
  chainIdDecimal: 5042002,
  chainIdHex: "0x4CF4B2",
  chainName: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
  },
};

export function createArcPaymentConfig(env = process.env) {
  const recipient = normalizeAddress(env.ARC_PAYMENT_RECIPIENT || "");
  const amountUsdc = String(env.ARC_PAYMENT_AMOUNT_USDC || "0.01").trim();
  const amountWei = parseNativeUsdcToWei(amountUsdc);
  const required = parseBoolean(env.ARC_PAYMENT_REQUIRED, false);

  return {
    required,
    configured: !required || Boolean(recipient),
    recipient,
    amountUsdc,
    amountWei: amountWei.toString(),
    chainIdDecimal: Number(env.ARC_CHAIN_ID || ARC_TESTNET.chainIdDecimal),
    chainIdHex: env.ARC_CHAIN_ID_HEX || ARC_TESTNET.chainIdHex,
    chainName: env.ARC_CHAIN_NAME || ARC_TESTNET.chainName,
    rpcUrl: env.ARC_RPC_URL || ARC_TESTNET.rpcUrl,
    explorerUrl: env.ARC_EXPLORER_URL || ARC_TESTNET.explorerUrl,
    nativeCurrency: ARC_TESTNET.nativeCurrency,
  };
}

export class ArcPaymentVerifier {
  constructor(options = {}) {
    this.config = options.config || createArcPaymentConfig();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.pollAttempts = options.pollAttempts || 20;
    this.pollDelayMs = options.pollDelayMs || 750;
    this.verifiedPayments = new Map();
    this.usedPayments = new Set();
  }

  publicConfig() {
    const config = this.config;
    return {
      required: config.required,
      configured: config.configured,
      recipient: config.recipient,
      amountUsdc: config.amountUsdc,
      amountWei: config.amountWei,
      chainIdDecimal: config.chainIdDecimal,
      chainIdHex: config.chainIdHex,
      chainName: config.chainName,
      rpcUrl: config.rpcUrl,
      explorerUrl: config.explorerUrl,
      nativeCurrency: config.nativeCurrency,
    };
  }

  async verifyPayment(input) {
    if (!this.config.required) {
      return {
        ok: true,
        required: false,
        status: "not_required",
      };
    }

    this.assertConfigured();
    const txHash = normalizeTxHash(input?.txHash);
    const payer = normalizeAddress(input?.payerAddress || input?.payer || "");

    if (!txHash) {
      throw httpError(400, "A valid Arc payment transaction hash is required.");
    }

    if (!payer) {
      throw httpError(400, "A valid payer wallet address is required.");
    }

    if (this.usedPayments.has(txHash)) {
      throw httpError(409, "This Arc payment has already been used for an analysis.");
    }

    const cached = this.verifiedPayments.get(txHash);
    if (cached) {
      if (cached.payer !== payer) {
        throw httpError(400, "Payment transaction does not match the connected wallet.");
      }
      return cached;
    }

    const [tx, receipt] = await Promise.all([
      this.rpc("eth_getTransactionByHash", [txHash]),
      this.waitForReceipt(txHash),
    ]);

    if (!tx) {
      throw httpError(404, "Arc payment transaction was not found.");
    }

    const verification = this.verifyTransaction({ tx, receipt, payer, txHash });
    this.verifiedPayments.set(txHash, verification);
    return verification;
  }

  async consumePayment(input) {
    const verification = await this.verifyPayment(input);
    if (!this.config.required) return verification;

    if (this.usedPayments.has(verification.txHash)) {
      throw httpError(409, "This Arc payment has already been used for an analysis.");
    }

    this.usedPayments.add(verification.txHash);
    this.verifiedPayments.delete(verification.txHash);

    return {
      ...verification,
      consumed: true,
    };
  }

  verifyTransaction({ tx, receipt, payer, txHash }) {
    if (!receipt) {
      throw httpError(408, "Arc payment is not confirmed yet. Try again in a few seconds.");
    }

    if (String(receipt.status).toLowerCase() !== "0x1") {
      throw httpError(400, "Arc payment transaction failed onchain.");
    }

    const txFrom = normalizeAddress(tx.from);
    const txTo = normalizeAddress(tx.to);
    const recipient = normalizeAddress(this.config.recipient);

    if (txFrom !== payer) {
      throw httpError(400, "Payment sender does not match the connected wallet.");
    }

    if (txTo !== recipient) {
      throw httpError(400, "Payment recipient does not match CopyGuard configuration.");
    }

    const paidWei = parseRpcQuantity(tx.value);
    const requiredWei = BigInt(this.config.amountWei);
    if (paidWei < requiredWei) {
      throw httpError(400, `Arc payment must be at least ${this.config.amountUsdc} USDC.`);
    }

    return {
      ok: true,
      required: true,
      status: "verified",
      txHash,
      payer,
      recipient,
      amountWei: paidWei.toString(),
      requiredAmountWei: requiredWei.toString(),
      requiredAmountUsdc: this.config.amountUsdc,
      chainIdDecimal: this.config.chainIdDecimal,
      explorerUrl: `${this.config.explorerUrl}/tx/${txHash}`,
    };
  }

  async waitForReceipt(txHash) {
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const receipt = await this.rpc("eth_getTransactionReceipt", [txHash]);
      if (receipt) return receipt;
      if (attempt < this.pollAttempts - 1) {
        await delay(this.pollDelayMs);
      }
    }

    return null;
  }

  async rpc(method, params) {
    if (typeof this.fetchImpl !== "function") {
      throw httpError(500, "No fetch implementation is available for Arc RPC.");
    }

    const response = await this.fetchImpl(this.config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw httpError(502, `Arc RPC returned ${response.status}.`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw httpError(502, payload.error.message || "Arc RPC returned an error.");
    }

    return payload.result;
  }

  assertConfigured() {
    if (!this.config.configured) {
      throw httpError(428, "Arc payment is required, but ARC_PAYMENT_RECIPIENT is not configured.");
    }
  }
}

export function parseNativeUsdcToWei(value) {
  const text = String(value || "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) {
    throw new Error("ARC_PAYMENT_AMOUNT_USDC must be a non-negative decimal with up to 18 decimals.");
  }

  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

export function toRpcQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function parseRpcQuantity(value) {
  if (typeof value !== "string" || !value.startsWith("0x")) return 0n;
  return BigInt(value);
}

function normalizeAddress(value) {
  const text = String(value || "").trim();
  return ADDRESS_RE.test(text) ? text.toLowerCase() : "";
}

function normalizeTxHash(value) {
  const text = String(value || "").trim();
  return TX_HASH_RE.test(text) ? text.toLowerCase() : "";
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
