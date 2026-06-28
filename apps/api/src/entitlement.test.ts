import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { generateLicenseKeypair, issueLicense } from "@pipeline/license";
import { buildServer } from "./server";

const kp = generateLicenseKeypair();

async function login(app: FastifyInstance, email = "free@x.com"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email } });
  const sc = res.headers["set-cookie"];
  return (Array.isArray(sc) ? sc[0]! : (sc as string)).split(";")[0]!;
}

beforeAll(() => {
  process.env.PIPELINE_LICENSE_PUBLIC_KEY = kp.publicKeyPem;
});
afterAll(() => {
  delete process.env.PIPELINE_LICENSE_PUBLIC_KEY;
});

describe("Pro entitlement gate — GET /api/analytics", () => {
  it("401 without a session", async () => {
    const app = await buildServer();
    try {
      expect((await app.inject({ method: "GET", url: "/api/analytics" })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("gates out a free user (402)", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app);
      const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { cookie } });
      expect(res.statusCode).toBe(402);
      expect(res.json()).toMatchObject({ upgrade: true });
    } finally {
      await app.close();
    }
  });

  it("unlocks analytics with a valid Pro license", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app, "lic@x.com");
      const token = issueLicense(kp.privateKeyPem, { sub: "lic@x.com", plan: "pro", iat: Date.now() });
      const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { cookie, "x-pipeline-license": token } });
      expect(res.statusCode).toBe(200);
      expect(res.json().plan).toBe("pro");
      expect(res.json().funnel.total).toBe(9);
    } finally {
      await app.close();
    }
  });

  it("stays gated for a license signed by an untrusted key", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app);
      const forged = issueLicense(generateLicenseKeypair().privateKeyPem, { sub: "free@x.com", plan: "pro", iat: Date.now() });
      const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { cookie, "x-pipeline-license": forged } });
      expect(res.statusCode).toBe(402);
    } finally {
      await app.close();
    }
  });
});
