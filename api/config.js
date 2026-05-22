import { ArcPaymentVerifier } from "../src/arc/payment.js";
import { enforceMethod, sendError, sendJson } from "./_utils.js";

const paymentVerifier = new ArcPaymentVerifier();

export default async function handler(req, res) {
  try {
    enforceMethod(req, "GET");
    sendJson(res, 200, {
      payment: paymentVerifier.publicConfig(),
    });
  } catch (error) {
    sendError(res, error);
  }
}
