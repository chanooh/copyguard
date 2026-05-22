import { ArcPaymentVerifier } from "../../src/arc/payment.js";
import { enforceMethod, readJsonBody, sendError, sendJson } from "../_utils.js";

const paymentVerifier = new ArcPaymentVerifier();

export default async function handler(req, res) {
  try {
    enforceMethod(req, "POST");
    const body = await readJsonBody(req);
    const payment = await paymentVerifier.verifyPayment(body);
    sendJson(res, 200, { payment });
  } catch (error) {
    sendError(res, error);
  }
}
