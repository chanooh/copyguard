import { analyzeWallet } from "../src/analysis/pipeline.js";
import { ArcPaymentVerifier } from "../src/arc/payment.js";
import { enforceMethod, readJsonBody, sendError, sendJson } from "./_utils.js";

const paymentVerifier = new ArcPaymentVerifier();

export default async function handler(req, res) {
  try {
    enforceMethod(req, "POST");
    const body = await readJsonBody(req);
    const payment = await paymentVerifier.consumePayment({
      txHash: body.paymentTxHash,
      payerAddress: body.payerAddress,
    });
    const result = await analyzeWallet(body);

    sendJson(res, 200, {
      ...result,
      arc: {
        ...result.arc,
        payment,
        status: payment.required ? "paid" : result.arc?.status,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
}
