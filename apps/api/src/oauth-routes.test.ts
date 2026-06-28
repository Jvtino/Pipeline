import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDb, upsertUser, getMailConnectionSecret, mailConnections, type DbHandle } from "@pipeline/db";
import { generateMasterKey } from "@pipeline/crypto";
import type { HttpTransport, OAuthTokens } from "@pipeline/providers";
import { registerOAuthRoutes } from "./oauth-routes";
import { memoryPendingStore } from "./pending-store";

const tokens: OAuthTokens = { access_token: "AT", refresh_token: "RT-secret", expires_in: 3600 };
const transport: HttpTransport = {
  async postForm() {
    return { ...tokens };
  },
  async getJson() {
    return { emailAddress: "me@gmail.com" };
  },
};

let h: DbHandle;
let app: FastifyInstance;
const masterKey = () => Buffer.from(generateMasterKey(), "base64");
const mk = masterKey();

beforeEach(async () => {
  h = await createDb();
  await upsertUser(h.db, { id: "u1", email: "u1@x.com" });
  app = Fastify();
  registerOAuthRoutes(app, {
    db: h.db,
    masterKey: mk,
    resolveUserId: () => "u1",
    configs: { google: { clientId: "cid", clientSecret: "sec" } }, // microsoft intentionally absent
    transport,
    publicUrl: "http://localhost:3001",
    webUrl: "http://localhost:5173",
    pending: memoryPendingStore(),
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await h.close();
});

describe("OAuth connect routes", () => {
  it("start → 302 to the provider with PKCE + state", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/google/start" });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("client_id")).toBe("cid");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("state")).toBeTruthy();
  });

  it("start → 400 when the provider is not configured", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/microsoft/start" });
    expect(res.statusCode).toBe(400);
  });

  it("callback exchanges the code and persists an ENCRYPTED connection", async () => {
    const start = await app.inject({ method: "GET", url: "/auth/google/start" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    const cb = await app.inject({ method: "GET", url: `/auth/google/callback?code=abc&state=${state}` });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain("connect=ok");

    const rows = await h.db.select().from(mailConnections);
    expect(rows.length).toBe(1);
    expect(rows[0]!.email).toBe("me@gmail.com");
    expect(rows[0]!.encryptedSecret).not.toContain("RT-secret"); // token not stored in plaintext

    const secret = await getMailConnectionSecret<OAuthTokens>(h.db, mk, rows[0]!.id);
    expect(secret?.access_token).toBe("AT");
    expect(secret?.refresh_token).toBe("RT-secret");
  });

  it("callback with an unknown/expired state redirects with an error and saves nothing", async () => {
    const cb = await app.inject({ method: "GET", url: "/auth/google/callback?code=abc&state=bogus" });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain("connect=error");
    const rows = await h.db.select().from(mailConnections);
    expect(rows.length).toBe(0);
  });
});
