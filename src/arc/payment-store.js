const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

const memoryStore = new Map();

export function createPaymentUsageStore(env = process.env, options = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "";
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "";

  if (url && token) {
    return new UpstashPaymentUsageStore({
      url,
      token,
      ttlSeconds: options.ttlSeconds || DEFAULT_TTL_SECONDS,
      fetchImpl: options.fetchImpl,
    });
  }

  return new MemoryPaymentUsageStore({
    store: options.store || memoryStore,
    ttlSeconds: options.ttlSeconds || DEFAULT_TTL_SECONDS,
  });
}

export class MemoryPaymentUsageStore {
  constructor(options = {}) {
    this.type = "memory";
    this.durable = false;
    this.store = options.store || new Map();
    this.ttlSeconds = options.ttlSeconds || DEFAULT_TTL_SECONDS;
  }

  async isUsed(txHash) {
    this.deleteIfExpired(txHash);
    return this.store.has(txHash);
  }

  async markUsed(txHash, payload) {
    this.deleteIfExpired(txHash);
    if (this.store.has(txHash)) return false;

    this.store.set(txHash, {
      payload,
      expiresAt: Date.now() + this.ttlSeconds * 1000,
    });
    return true;
  }

  deleteIfExpired(txHash) {
    const record = this.store.get(txHash);
    if (record && record.expiresAt <= Date.now()) {
      this.store.delete(txHash);
    }
  }
}

export class UpstashPaymentUsageStore {
  constructor(options = {}) {
    this.type = "upstash";
    this.durable = true;
    this.url = String(options.url || "").replace(/\/$/, "");
    this.token = options.token || "";
    this.ttlSeconds = options.ttlSeconds || DEFAULT_TTL_SECONDS;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async isUsed(txHash) {
    const result = await this.command(["GET", keyFor(txHash)]);
    return result !== null && result !== undefined;
  }

  async markUsed(txHash, payload) {
    const result = await this.command([
      "SET",
      keyFor(txHash),
      JSON.stringify(payload),
      "NX",
      "EX",
      this.ttlSeconds,
    ]);

    return result === "OK";
  }

  async command(command) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation is available for payment storage.");
    }

    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Payment storage returned ${response.status}.`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload.result;
  }
}

function keyFor(txHash) {
  return `copyguard:arc-payment-used:${String(txHash).toLowerCase()}`;
}
