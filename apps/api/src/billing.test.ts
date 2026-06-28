import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { buildServer } from "./server";

const SECRET = "whsec_test_secret";
const sign = (raw: string) => createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
const post = (raw: string, sig: string) => ({
  method: "POST" as const,
  url: "/webhooks/billing",
  headers: { "content-type": "application/json", "x-signature": sig },
  payload: raw,
});

beforeAll(() => {
  process.env.BILLING_WEBHOOK_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.BILLING_WEBHOOK_SECRET;
});

describe("billing webhook → entitlement", () => {
  it("rejects a forged signature (401)", async () => {
    const app = await buildServer();
    try {
      const raw = JSON.stringify({ type: "order.paid", userId: "demo-user", plan: "pro" });
      const res = await app.inject(post(raw, "deadbeef"));
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("a valid paid event upgrades the user and unlocks Pro analytics", async () => {
    const app = await buildServer();
    try {
      expect((await app.inject({ method: "GET", url: "/api/analytics" })).statusCode).toBe(402); // free first
      const raw = JSON.stringify({ type: "order.paid", userId: "demo-user", plan: "pro" });
      const res = await app.inject(post(raw, sign(raw)));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, change: { userId: "demo-user", plan: "pro" } });
      expect((await app.inject({ method: "GET", url: "/api/analytics" })).statusCode).toBe(200); // unlocked
    } finally {
      await app.close();
    }
  });

  it("a cancellation downgrades back to free", async () => {
    const app = await buildServer();
    try {
      const up = JSON.stringify({ type: "order.paid", userId: "demo-user", plan: "pro" });
      await app.inject(post(up, sign(up)));
      const down = JSON.stringify({ type: "subscription.cancelled", userId: "demo-user" });
      const res = await app.inject(post(down, sign(down)));
      expect(res.json()).toMatchObject({ change: { userId: "demo-user", plan: "free" } });
      expect((await app.inject({ method: "GET", url: "/api/analytics" })).statusCode).toBe(402);
    } finally {
      await app.close();
    }
  });
});
