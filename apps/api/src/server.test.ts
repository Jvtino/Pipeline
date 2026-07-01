import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { boardSchema } from "@pipeline/contracts";
import { buildServer } from "./server";

/** Log in via the dev login and return the session cookie pair for subsequent requests. */
export async function login(app: FastifyInstance, email = "demo@pipeline.local"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email } });
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  return raw.split(";")[0]!; // "pipeline_session=..."
}

describe("api server (authenticated)", () => {
  it("GET /api/health is open", async () => {
    const app = await buildServer();
    try {
      expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true, service: "pipeline-api" });
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated access to the board (401)", async () => {
    const app = await buildServer();
    try {
      expect((await app.inject({ method: "GET", url: "/api/applications" })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("a signed-in user gets a seeded, contract-valid board", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app);
      const res = await app.inject({ method: "GET", url: "/api/applications", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(() => boardSchema.parse(body)).not.toThrow();
      expect(body.counts.total).toBe(9); // demo seeded on first login
      expect(body.groups.some((g: { company: string }) => g.company === "Acme Robotics")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("POST /api/sync is a clean no-op for a user with no mailbox", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app);
      const res = await app.inject({ method: "POST", url: "/api/sync", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ connections: 0, results: [] });
    } finally {
      await app.close();
    }
  });

  it("POST /api/resync requires auth and is a safe no-op with no mailbox (keeps the demo board)", async () => {
    const app = await buildServer();
    try {
      expect((await app.inject({ method: "POST", url: "/api/resync" })).statusCode).toBe(401);
      const cookie = await login(app);
      const res = await app.inject({ method: "POST", url: "/api/resync", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ removed: 0, connections: 0, results: [] });
      // the seeded demo board is untouched when there's nothing to rebuild from
      expect((await app.inject({ method: "GET", url: "/api/applications", headers: { cookie } })).json().counts.total).toBe(9);
    } finally {
      await app.close();
    }
  });

  it("GET /api/connections reports connected mailboxes (0 for a fresh user, 401 unauthenticated)", async () => {
    const app = await buildServer();
    try {
      expect((await app.inject({ method: "GET", url: "/api/connections" })).statusCode).toBe(401);
      const cookie = await login(app);
      const res = await app.inject({ method: "GET", url: "/api/connections", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ count: 0, mailboxes: [] });
    } finally {
      await app.close();
    }
  });

  it("dev upgrade flips the plan and unlocks Pro routes", async () => {
    const app = await buildServer();
    try {
      const cookie = await login(app, "upgrader@x.com");
      expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).json().user.plan).toBe("free");
      expect((await app.inject({ method: "GET", url: "/api/reminders", headers: { cookie } })).statusCode).toBe(402);

      const up = await app.inject({ method: "POST", url: "/auth/dev/upgrade", headers: { cookie, "content-type": "application/json" }, payload: { plan: "pro" } });
      expect(up.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).json().user.plan).toBe("pro");
      expect((await app.inject({ method: "GET", url: "/api/reminders", headers: { cookie } })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("isolates two users — each sees only their own board", async () => {
    const app = await buildServer();
    try {
      const a = await login(app, "alice@x.com");
      const b = await login(app, "bob@x.com");
      // both seeded with the same demo set, but as separate rows under separate users
      const boardA = (await app.inject({ method: "GET", url: "/api/applications", headers: { cookie: a } })).json();
      const boardB = (await app.inject({ method: "GET", url: "/api/applications", headers: { cookie: b } })).json();
      expect(boardA.counts.total).toBe(9);
      expect(boardB.counts.total).toBe(9);
      // /auth/me reflects the right identity per cookie
      expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: a } })).json().user.email).toBe("alice@x.com");
      expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: b } })).json().user.email).toBe("bob@x.com");
    } finally {
      await app.close();
    }
  });
});
