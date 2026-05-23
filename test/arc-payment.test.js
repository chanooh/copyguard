import assert from "node:assert/strict";
import test from "node:test";

import {
  ArcPaymentVerifier,
  createArcPaymentConfig,
  parseNativeUsdcToWei,
  toChainIdHex,
  toRpcQuantity,
} from "../src/arc/payment.js";
import { MemoryPaymentUsageStore, UpstashPaymentUsageStore } from "../src/arc/payment-store.js";

const payer = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("parseNativeUsdcToWei uses Arc native 18-decimal accounting", () => {
  assert.equal(parseNativeUsdcToWei("0.01").toString(), "10000000000000000");
  assert.equal(parseNativeUsdcToWei("1").toString(), "1000000000000000000");
  assert.equal(toRpcQuantity(parseNativeUsdcToWei("0.01")), "0x2386f26fc10000");
});

test("createArcPaymentConfig exposes Arc payment defaults", () => {
  const config = createArcPaymentConfig({
    ARC_PAYMENT_REQUIRED: "true",
    ARC_PAYMENT_RECIPIENT: recipient,
    ARC_PAYMENT_AMOUNT_USDC: "0.01",
  });

  assert.equal(config.required, true);
  assert.equal(config.configured, true);
  assert.equal(config.recipient, recipient);
  assert.equal(config.amountWei, "10000000000000000");
  assert.equal(config.chainIdDecimal, 5042002);
  assert.equal(config.chainIdHex, "0x4CEF52");
});

test("toChainIdHex converts Arc decimal chain id correctly", () => {
  assert.equal(toChainIdHex(5042002), "0x4CEF52");
});

test("ArcPaymentVerifier verifies and consumes a native Arc USDC transfer once", async () => {
  const verifier = new ArcPaymentVerifier({
    config: createArcPaymentConfig({
      ARC_PAYMENT_REQUIRED: "true",
      ARC_PAYMENT_RECIPIENT: recipient,
      ARC_PAYMENT_AMOUNT_USDC: "0.01",
      ARC_RPC_URL: "https://arc-rpc.example",
    }),
    usageStore: new MemoryPaymentUsageStore(),
    pollAttempts: 1,
    fetchImpl: mockRpcFetch({
      tx: {
        from: payer,
        to: recipient,
        value: toRpcQuantity(parseNativeUsdcToWei("0.02")),
      },
      receipt: {
        status: "0x1",
      },
    }),
  });

  const verified = await verifier.verifyPayment({ txHash, payerAddress: payer });
  assert.equal(verified.status, "verified");
  assert.equal(verified.payer, payer);
  assert.equal(verified.recipient, recipient);

  const consumed = await verifier.consumePayment({ txHash, payerAddress: payer });
  assert.equal(consumed.consumed, true);

  await assert.rejects(
    () => verifier.consumePayment({ txHash, payerAddress: payer }),
    /already been used/,
  );
});

test("ArcPaymentVerifier rejects underpaid transactions", async () => {
  const verifier = new ArcPaymentVerifier({
    config: createArcPaymentConfig({
      ARC_PAYMENT_REQUIRED: "true",
      ARC_PAYMENT_RECIPIENT: recipient,
      ARC_PAYMENT_AMOUNT_USDC: "0.01",
      ARC_RPC_URL: "https://arc-rpc.example",
    }),
    usageStore: new MemoryPaymentUsageStore(),
    pollAttempts: 1,
    fetchImpl: mockRpcFetch({
      tx: {
        from: payer,
        to: recipient,
        value: toRpcQuantity(parseNativeUsdcToWei("0.001")),
      },
      receipt: {
        status: "0x1",
      },
    }),
  });

  await assert.rejects(
    () => verifier.verifyPayment({ txHash, payerAddress: payer }),
    /at least 0.01 USDC/,
  );
});

test("ArcPaymentVerifier fails closed when recipient is missing", async () => {
  const verifier = new ArcPaymentVerifier({
    config: createArcPaymentConfig({
      ARC_PAYMENT_REQUIRED: "true",
      ARC_PAYMENT_RECIPIENT: "",
    }),
    usageStore: new MemoryPaymentUsageStore(),
    fetchImpl: async () => {
      throw new Error("should not call rpc");
    },
  });

  await assert.rejects(
    () => verifier.verifyPayment({ txHash, payerAddress: payer }),
    /ARC_PAYMENT_RECIPIENT/,
  );
});

test("UpstashPaymentUsageStore marks a tx hash atomically", async () => {
  const calls = [];
  const store = new UpstashPaymentUsageStore({
    url: "https://kv.example",
    token: "token",
    ttlSeconds: 60,
    fetchImpl: async (_url, options) => {
      const command = JSON.parse(options.body);
      calls.push({ command, authorization: options.headers.authorization });
      return {
        ok: true,
        async json() {
          if (command[0] === "GET") return { result: null };
          return { result: "OK" };
        },
      };
    },
  });

  assert.equal(await store.isUsed(txHash), false);
  assert.equal(await store.markUsed(txHash, { payer }), true);
  assert.deepEqual(calls[0].command, ["GET", `copyguard:arc-payment-used:${txHash}`]);
  assert.deepEqual(calls[1].command, [
    "SET",
    `copyguard:arc-payment-used:${txHash}`,
    JSON.stringify({ payer }),
    "NX",
    "EX",
    60,
  ]);
  assert.equal(calls[1].authorization, "Bearer token");
});

function mockRpcFetch({ tx, receipt }) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    const result = {
      eth_getTransactionByHash: tx ? { hash: txHash, ...tx } : null,
      eth_getTransactionReceipt: receipt ? { transactionHash: txHash, ...receipt } : null,
    }[body.method];

    return {
      ok: true,
      async json() {
        return {
          jsonrpc: "2.0",
          id: body.id,
          result,
        };
      },
    };
  };
}
