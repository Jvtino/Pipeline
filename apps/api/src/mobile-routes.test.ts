// Mobile endpoints: devices, server-side application writes, the review queue,
// connect tokens, account deletion (with provider-side revocation), and meta.
// Bare-Fastify harness (like oauth-routes.test.ts) so the DB can be seeded
// directly; one buildServer smoke test proves the wiring.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  createDb,
  upsertUser,
  upsertApplications,
  saveMailConnection,
  getApplicationForUser,
  listStatusEvents,
  getUser,
  type DbHandle,
} from "@pipeline/db";
import { generateMasterKey } from "@pipeline/crypto";
import type { HttpTransport } from "@pipeline/providers";
import type { Application, ClassificationAudit, Status } from "@pipeline/contracts";
import { registerMobileRoutes, gmailConnectEnabled, CONNECT_TOKEN_PREFIX } from "./mobile-routes";
import { memoryPendingStore, type PendingStore } from "./pending-store";
import { buildServer } from "./server";

const mk = Buffer.from(generateMasterKey(), "base64");

function appFixture(threadId: string, company: string, status: Status, extra: Partial<Application> = {}): Application {
  return {
    id: "ignored",
    threadId,
    company,
    companyDomain: `${company.toLowerCase()}.com`,
    role: "Engineer",
    status,
    firstSeen: "2026-01-01",
    lastActivity: "2026-02-01",
    snippet: "snippet",
    manual: false,
    ...extra,
  };
}

const flaggedAudit: ClassificationAudit = {
  eventType: "applied",
  confidence: 0.3,
  evidence: [],
  negativeEvidence: [],
  requiresManualReview: true,
  reason: "low signal",
};

let h: DbHandle;
let app: FastifyInstance;
let pending: PendingStore;
let authedUser: { id: string; email: string } | null;
let forgotten: string[];
let revokeCalls: { url: string; form: Record<string, string> }[];
let identityDeleted: string[];

const transport: HttpTransport = {
  async postForm(url, form) {
    revokeCalls.push({ url, form });
    return {};
  },
  async getJson() {
    return {};
  },
};

beforeEach(async () => {
  h = await createDb();
  await upsertUser(h.db, { id: "u1", email: "u1@x.com" });
  await upsertUser(h.db, { id: "u2", email: "u2@x.com" });
  authedUser = { id: "u1", email: "u1@x.com" };
  forgotten = [];
  revokeCalls = [];
  identityDeleted = [];
  pending = memoryPendingStore();
  app = Fastify();
  app.addHook("preHandler", async (req) => {
    if (authedUser) (req as { user?: typeof authedUser }).user = authedUser;
  });
  registerMobileRoutes(app, {
    db: h.db,
    masterKey: mk,
    configs: { microsoft: { clientId: "ms-cid" }, google: { clientId: "g-cid", clientSecret: "g-sec" } },
    transport,
    pending,
    forgetUser: (id) => void forgotten.push(id),
    deleteIdentity: async (id) => void identityDeleted.push(id),
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await h.close();
  delete process.env.FEATURE_GMAIL_CONNECT;
});

describe("devices routes", () => {
  it("registers, lists, updates prefs, deletes", async () => {
    const post = await app.inject({ method: "POST", url: "/api/devices", payload: { expoPushToken: "tok-1", platform: "ios", deviceName: "iPhone" } });
    expect(post.statusCode).toBe(200);
    const device = post.json().device;
    expect(device).toMatchObject({ platform: "ios", expoPushToken: "tok-1", notifyStatusChanges: true, disabled: false });

    expect((await app.inject({ method: "GET", url: "/api/devices" })).json().devices).toHaveLength(1);

    const patch = await app.inject({ method: "PATCH", url: `/api/devices/${device.id}`, payload: { notifyReminders: false } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().device.notifyReminders).toBe(false);

    expect((await app.inject({ method: "DELETE", url: `/api/devices/${device.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/devices" })).json().devices).toHaveLength(0);
  });

  it("validates input and requires auth", async () => {
    expect((await app.inject({ method: "POST", url: "/api/devices", payload: { expoPushToken: "t", platform: "windows" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/devices", payload: { platform: "ios" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/devices/x", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/devices/nope", payload: { notifyReminders: true } })).statusCode).toBe(404);
    authedUser = null;
    expect((await app.inject({ method: "POST", url: "/api/devices", payload: { expoPushToken: "t", platform: "ios" } })).statusCode).toBe(401);
  });
});

describe("application writes", () => {
  it("PATCH overrides status, records a user event, 404s on foreign threads", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    const res = await app.inject({ method: "PATCH", url: "/api/applications/t1", payload: { status: "offer" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().application.status).toBe("offer");
    expect((await listStatusEvents(h.db, "u1", "t1")).map((e) => e.source)).toEqual(["sync", "user"]);

    expect((await app.inject({ method: "PATCH", url: "/api/applications/t1", payload: { status: "nope" } })).statusCode).toBe(400);
    authedUser = { id: "u2", email: "u2@x.com" };
    expect((await app.inject({ method: "PATCH", url: "/api/applications/t1", payload: { status: "offer" } })).statusCode).toBe(404);
  });

  it("POST creates a manual application visible to reads", async () => {
    const res = await app.inject({ method: "POST", url: "/api/applications", payload: { company: "  Acme  ", role: "Engineer", status: "interview", appliedOn: "2026-07-01" } });
    expect(res.statusCode).toBe(201);
    const created = res.json().application;
    expect(created).toMatchObject({ company: "Acme", role: "Engineer", status: "interview", manual: true, firstSeen: "2026-07-01" });
    expect(created.threadId).toMatch(/^manual:/);
    expect((await getApplicationForUser(h.db, "u1", created.threadId))?.company).toBe("Acme");
    // manual adds enter the timeline as the user's own action
    expect((await listStatusEvents(h.db, "u1", created.threadId)).map((e) => e.source)).toEqual(["user"]);
  });

  it("POST validates company/role/status", async () => {
    expect((await app.inject({ method: "POST", url: "/api/applications", payload: { role: "E" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/applications", payload: { company: "A", role: "E", status: "bogus" } })).statusCode).toBe(400);
  });
});

describe("review queue routes", () => {
  beforeEach(async () => {
    await upsertApplications(h.db, "u1", [
      appFixture("t-flagged", "Acme", "applied", { classification: flaggedAudit, confidence: 0.3 }),
      appFixture("t-fine", "Initech", "applied", { confidence: 0.95 }),
    ]);
  });

  it("lists the queue, confirm resolves without changing status", async () => {
    const before = await app.inject({ method: "GET", url: "/api/review" });
    expect(before.json().applications.map((a: Application) => a.threadId)).toEqual(["t-flagged"]);

    const res = await app.inject({ method: "POST", url: "/api/review/t-flagged", payload: { action: "confirm" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().application.status).toBe("applied"); // unchanged
    expect((await app.inject({ method: "GET", url: "/api/review" })).json().applications).toEqual([]);
  });

  it("'set' resolves AND overrides; validates input; scopes to owner", async () => {
    const res = await app.inject({ method: "POST", url: "/api/review/t-flagged", payload: { action: "set", status: "interview" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().application.status).toBe("interview");
    expect((await app.inject({ method: "GET", url: "/api/review" })).json().applications).toEqual([]);

    expect((await app.inject({ method: "POST", url: "/api/review/t-fine", payload: { action: "set" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/review/t-fine", payload: { action: "bogus" } })).statusCode).toBe(400);
    authedUser = { id: "u2", email: "u2@x.com" };
    expect((await app.inject({ method: "POST", url: "/api/review/t-flagged", payload: { action: "confirm" } })).statusCode).toBe(404);
  });
});

describe("connect tokens", () => {
  it("mints a one-time nonce bound to the user and provider", async () => {
    const res = await app.inject({ method: "POST", url: "/api/connect-token", payload: { provider: "microsoft" } });
    expect(res.statusCode).toBe(200);
    const { connectToken, startPath, expiresInSeconds } = res.json();
    expect(startPath).toBe(`/auth/microsoft/start?ct=${connectToken}`);
    expect(expiresInSeconds).toBe(600);
    const entry = await pending.take(`${CONNECT_TOKEN_PREFIX}${connectToken}`);
    expect(entry).toMatchObject({ provider: "microsoft", userId: "u1" });
    // one-time use
    expect(await pending.take(`${CONNECT_TOKEN_PREFIX}${connectToken}`)).toBeNull();
  });

  it("rejects unknown providers and honors the Gmail launch flag", async () => {
    expect((await app.inject({ method: "POST", url: "/api/connect-token", payload: { provider: "imap" } })).statusCode).toBe(400);
    process.env.FEATURE_GMAIL_CONNECT = "false";
    expect((await app.inject({ method: "POST", url: "/api/connect-token", payload: { provider: "google" } })).statusCode).toBe(403);
    delete process.env.FEATURE_GMAIL_CONNECT;
    expect((await app.inject({ method: "POST", url: "/api/connect-token", payload: { provider: "google" } })).statusCode).toBe(200);
  });
});

describe("gmailConnectEnabled", () => {
  it("override wins; default follows configuration", () => {
    expect(gmailConnectEnabled({}, { google: { clientId: "x", clientSecret: "y" } })).toBe(true);
    expect(gmailConnectEnabled({}, {})).toBe(false);
    expect(gmailConnectEnabled({ FEATURE_GMAIL_CONNECT: "false" }, { google: { clientId: "x", clientSecret: "y" } })).toBe(false);
    expect(gmailConnectEnabled({ FEATURE_GMAIL_CONNECT: "true" }, {})).toBe(true);
  });
});

describe("account deletion", () => {
  it("revokes Google tokens, erases the user, evicts caches, deletes the identity", async () => {
    await saveMailConnection(h.db, mk, {
      id: "c-g",
      userId: "u1",
      provider: "google",
      email: "a@gmail.com",
      secret: { access_token: "AT", refresh_token: "RT-secret", expires_in: 3600 },
    });
    await saveMailConnection(h.db, mk, { id: "c-m", userId: "u1", provider: "microsoft", email: "a@outlook.com", secret: { access_token: "AT2" } });
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);

    const res = await app.inject({ method: "DELETE", url: "/api/account" });
    expect(res.statusCode).toBe(200);

    // Google revoked with the refresh token; Microsoft has no revoke endpoint
    expect(revokeCalls).toEqual([{ url: "https://oauth2.googleapis.com/revoke", form: { token: "RT-secret" } }]);
    expect(await getUser(h.db, "u1")).toBeNull();
    expect(await getApplicationForUser(h.db, "u1", "t1")).toBeNull();
    expect(forgotten).toEqual(["u1"]);
    expect(identityDeleted).toEqual(["u1"]);
    // bystander untouched
    expect(await getUser(h.db, "u2")).not.toBeNull();
  });
});

describe("meta", () => {
  it("reports version gate and feature flags without auth", async () => {
    authedUser = null;
    const res = await app.inject({ method: "GET", url: "/api/meta" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      minMobileVersion: "0.0.0",
      features: { gmailConnect: true, microsoftConnect: true },
    });
  });
});

describe("buildServer wiring", () => {
  it("mobile routes ride the real server auth (cookie path)", async () => {
    const server = await buildServer();
    try {
      const login = await server.inject({ method: "POST", url: "/auth/dev/login", payload: { email: "w@x.com" } });
      const cookie = login.headers["set-cookie"] as string;
      const dev = await server.inject({ method: "POST", url: "/api/devices", headers: { cookie }, payload: { expoPushToken: "tok", platform: "android" } });
      expect(dev.statusCode).toBe(200);
      expect((await server.inject({ method: "GET", url: "/api/meta" })).statusCode).toBe(200);
      // demo board is seeded, so a demo thread accepts an override end-to-end
      const board = await server.inject({ method: "GET", url: "/api/applications", headers: { cookie } });
      const threadId = board.json().groups[0].applications[0].threadId as string;
      const patch = await server.inject({ method: "PATCH", url: `/api/applications/${encodeURIComponent(threadId)}`, headers: { cookie }, payload: { status: "cancelled" } });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().application.status).toBe("cancelled");
    } finally {
      await server.close();
    }
  });
});
