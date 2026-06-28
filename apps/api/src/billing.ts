// Billing webhook helpers. A Merchant-of-Record (Lemon Squeezy / Paddle) calls
// our webhook on payment events; we verify the HMAC signature over the raw body,
// then upgrade/downgrade the user's plan. The exact provider JSON is mapped to
// this normalized shape by a thin adapter (the MoR passes our userId + plan
// through its custom-data/passthrough field).
import { createHmac, timingSafeEqual } from "node:crypto";

export type Plan = "free" | "pro" | "teams";

export interface BillingEvent {
  type: string;
  userId?: string;
  plan?: "pro" | "teams";
}

/** Constant-time HMAC-SHA256 verification of a webhook signature (hex). */
export function verifyWebhookSignature(rawBody: string, secret: string, signatureHex: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHex, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const ACTIVATE = new Set([
  "order.paid",
  "subscription.created",
  "subscription.active",
  "subscription_payment_success",
]);
const DEACTIVATE = new Set(["subscription.cancelled", "subscription.expired", "refund.issued"]);

/** Resolve a normalized event to the plan change to apply, or null if irrelevant. */
export function planFromEvent(e: BillingEvent): { userId: string; plan: Plan } | null {
  if (!e.userId) return null;
  if (ACTIVATE.has(e.type) && e.plan) return { userId: e.userId, plan: e.plan };
  if (DEACTIVATE.has(e.type)) return { userId: e.userId, plan: "free" };
  return null;
}
