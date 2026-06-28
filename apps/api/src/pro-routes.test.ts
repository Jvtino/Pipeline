import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";

const SECRET = "whsec_pro_test";
const sign = (raw: string) => createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");

async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email } });
  const sc = res.headers["set-cookie"];
  return (Array.isArray(sc) ? sc[0]! : (sc as string)).split(";")[0]!;
}
async function upgradeToPro(app: FastifyInstance, email: string): Promise<void> {
  const raw = JSON.stringify({ type: "order.paid", userId: email, plan: "pro" });
  await app.inject({ method: "POST", url: "/webhooks/billing", headers: { "content-type": "application/json", "x-signature": sign(raw) }, payload: raw });
}
const json = (cookie: string, payload: unknown) => ({ headers: { cookie, "content-type": "application/json" }, payload: payload as object });

beforeAll(() => {
  process.env.BILLING_WEBHOOK_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.BILLING_WEBHOOK_SECRET;
});

describe("Pro routes", () => {
  it("gate every Pro route behind the entitlement (free → 402)", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app, "free@x.com");
      for (const url of ["/api/reminders", "/api/export.csv", "/api/applications/demo:stripe/notes", "/api/applications/demo:stripe/contacts"]) {
        expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode, url).toBe(402);
      }
    } finally {
      await app.close();
    }
  });

  it("reminders + CSV export work for a Pro user", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app, "pro@x.com");
      await upgradeToPro(app, "pro@x.com");

      const rem = await app.inject({ method: "GET", url: "/api/reminders", headers: { cookie } });
      expect(rem.statusCode).toBe(200);
      expect(Array.isArray(rem.json().nudges)).toBe(true);

      const csv = await app.inject({ method: "GET", url: "/api/export.csv", headers: { cookie } });
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.body).toContain("Company,Role,Status");
      expect(csv.body).toContain("Acme Robotics");
    } finally {
      await app.close();
    }
  });

  it("notes + contacts CRUD, scoped to the user's own application", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app, "pro2@x.com");
      await upgradeToPro(app, "pro2@x.com");

      const addNote = await app.inject({ method: "POST", url: "/api/applications/demo:stripe/notes", ...json(cookie, { body: "called the recruiter" }) });
      expect(addNote.statusCode).toBe(200);
      expect(addNote.json().note.body).toBe("called the recruiter");
      expect((await app.inject({ method: "GET", url: "/api/applications/demo:stripe/notes", headers: { cookie } })).json().notes).toHaveLength(1);

      const addContact = await app.inject({ method: "POST", url: "/api/applications/demo:stripe/contacts", ...json(cookie, { name: "Jane", email: "jane@stripe.com", role: "Recruiter" }) });
      expect(addContact.statusCode).toBe(200);
      expect(addContact.json().contact.name).toBe("Jane");
      expect((await app.inject({ method: "GET", url: "/api/applications/demo:stripe/contacts", headers: { cookie } })).json().contacts).toHaveLength(1);

      // an application the user doesn't own → 404
      const bad = await app.inject({ method: "POST", url: "/api/applications/does-not-exist/notes", ...json(cookie, { body: "x" }) });
      expect(bad.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
