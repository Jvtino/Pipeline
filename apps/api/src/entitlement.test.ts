import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateLicenseKeypair, issueLicense } from "@pipeline/license";
import { buildServer } from "./server";

const kp = generateLicenseKeypair();

beforeAll(() => {
  process.env.PIPELINE_LICENSE_PUBLIC_KEY = kp.publicKeyPem;
});
afterAll(() => {
  delete process.env.PIPELINE_LICENSE_PUBLIC_KEY;
});

describe("Pro entitlement gate — GET /api/analytics", () => {
  it("gates out a free user (402)", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/api/analytics" });
      expect(res.statusCode).toBe(402);
      expect(res.json()).toMatchObject({ upgrade: true });
    } finally {
      await app.close();
    }
  });

  it("unlocks analytics with a valid Pro license", async () => {
    const token = issueLicense(kp.privateKeyPem, { sub: "demo-user", plan: "pro", iat: Date.now() });
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { "x-pipeline-license": token } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.plan).toBe("pro");
      expect(body.funnel.total).toBe(9);
      expect(typeof body.offerRate).toBe("number");
    } finally {
      await app.close();
    }
  });

  it("stays gated for a license signed by an untrusted key", async () => {
    const forged = issueLicense(generateLicenseKeypair().privateKeyPem, { sub: "demo-user", plan: "pro", iat: Date.now() });
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { "x-pipeline-license": forged } });
      expect(res.statusCode).toBe(402);
    } finally {
      await app.close();
    }
  });
});
