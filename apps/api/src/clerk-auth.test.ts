// Bearer identity (mobile): JWT verification against a local JWKS, first-sight
// user provisioning + demo seed, coexistence with the legacy cookie path,
// fail-closed dev login, and per-route rate limiting.
import { describe, it, expect, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createBearerVerifier, clerkConfigFromEnv } from "./clerk";
import { resolveDevLoginEnabled } from "./auth-routes";
import { buildServer } from "./server";

const ISSUER = "https://test.clerk.accounts.dev";

async function makeSigner() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "k1";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { issuer?: string; expired?: boolean } = {}) => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.issuer ?? ISSUER)
      .setIssuedAt(opts.expired ? Math.floor(Date.now() / 1000) - 7200 : undefined)
      .setExpirationTime(opts.expired ? Math.floor(Date.now() / 1000) - 3600 : "1h");
    return jwt.sign(privateKey);
  };
  return { keys, sign };
}

describe("createBearerVerifier", () => {
  it("accepts a valid token and maps sub/email", async () => {
    const { keys, sign } = await makeSigner();
    const verify = createBearerVerifier({ issuer: ISSUER }, keys);
    const token = await sign({ sub: "user_1", email: "Me@Example.com" });
    expect(await verify(`Bearer ${token}`)).toEqual({ id: "user_1", email: "me@example.com" });
  });

  it("falls back to a per-subject sentinel email when the claim is missing", async () => {
    const { keys, sign } = await makeSigner();
    const verify = createBearerVerifier({ issuer: ISSUER }, keys);
    const token = await sign({ sub: "user_2" });
    expect(await verify(`Bearer ${token}`)).toEqual({ id: "user_2", email: "user_2@clerk.local" });
  });

  it("rejects: expiry, wrong issuer, missing sub, garbage, absent header", async () => {
    const { keys, sign } = await makeSigner();
    const verify = createBearerVerifier({ issuer: ISSUER }, keys);
    expect(await verify(`Bearer ${await sign({ sub: "user_1" }, { expired: true })}`)).toBeNull();
    expect(await verify(`Bearer ${await sign({ sub: "user_1" }, { issuer: "https://evil.example" })}`)).toBeNull();
    expect(await verify(`Bearer ${await sign({})}`)).toBeNull();
    expect(await verify("Bearer not-a-jwt")).toBeNull();
    expect(await verify(undefined)).toBeNull();
    expect(await verify("Basic abc")).toBeNull();
  });

  it("enforces the azp allowlist when configured", async () => {
    const { keys, sign } = await makeSigner();
    const verify = createBearerVerifier({ issuer: ISSUER, authorizedParties: ["https://app.pipeline.example"] }, keys);
    expect(await verify(`Bearer ${await sign({ sub: "u", azp: "https://app.pipeline.example" })}`)).not.toBeNull();
    expect(await verify(`Bearer ${await sign({ sub: "u", azp: "https://evil.example" })}`)).toBeNull();
    expect(await verify(`Bearer ${await sign({ sub: "u" })}`)).toBeNull(); // no azp at all
  });

  it("a signature from a different key never verifies", async () => {
    const a = await makeSigner();
    const b = await makeSigner();
    const verify = createBearerVerifier({ issuer: ISSUER }, a.keys);
    expect(await verify(`Bearer ${await b.sign({ sub: "user_1" })}`)).toBeNull();
  });
});

describe("clerkConfigFromEnv", () => {
  it("is null without CLERK_ISSUER; parses issuer, jwks url and parties", () => {
    expect(clerkConfigFromEnv({})).toBeNull();
    expect(
      clerkConfigFromEnv({
        CLERK_ISSUER: "https://x.clerk.accounts.dev/",
        CLERK_JWKS_URL: "https://x.clerk.accounts.dev/jwks",
        CLERK_AUTHORIZED_PARTIES: "https://a.example, https://b.example",
      }),
    ).toEqual({
      issuer: "https://x.clerk.accounts.dev",
      jwksUrl: "https://x.clerk.accounts.dev/jwks",
      authorizedParties: ["https://a.example", "https://b.example"],
    });
  });
});

describe("bearer path through the server", () => {
  const verifyBearer = async (authz: string | undefined) =>
    authz === "Bearer good" ? { id: "user_1", email: "mobile@example.com" } : null;

  it("provisions on first sight (with demo board), then authenticates /auth/me and reads", async () => {
    const app = await buildServer({ verifyBearer });
    try {
      const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer good" } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user).toMatchObject({ id: "user_1", email: "mobile@example.com", plan: "free" });

      const board = await app.inject({ method: "GET", url: "/api/applications", headers: { authorization: "Bearer good" } });
      expect(board.statusCode).toBe(200);
      expect(board.json().counts.total).toBeGreaterThan(0); // first run is never an empty board
    } finally {
      await app.close();
    }
  });

  it("a bad bearer stays unauthenticated; the legacy cookie path still works beside it", async () => {
    const app = await buildServer({ verifyBearer });
    try {
      const bad = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer evil" } });
      expect(bad.statusCode).toBe(401);

      const login = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email: "web@example.com" } });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"] as string;
      const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.email).toBe("web@example.com");
    } finally {
      await app.close();
    }
  });

  it("parallel first-sight requests share ONE provisioning pass (no duplicate demo seed)", async () => {
    const app = await buildServer({ verifyBearer });
    try {
      // a phone's first launch fires several calls concurrently with the same token
      const [a, b, c] = await Promise.all([
        app.inject({ method: "GET", url: "/api/applications", headers: { authorization: "Bearer good" } }),
        app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer good" } }),
        app.inject({ method: "GET", url: "/api/devices", headers: { authorization: "Bearer good" } }),
      ]);
      expect([a.statusCode, b.statusCode, c.statusCode]).toEqual([200, 200, 200]);
      // duplicated seeding would double every demo application's first event
      const threadId = a.json().groups[0].applications[0].threadId as string;
      const events = await app.inject({
        method: "GET",
        url: `/api/applications/${encodeURIComponent(threadId)}/events`,
        headers: { authorization: "Bearer good" },
      });
      expect(events.json().events).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("keeps identities separate when a legacy account already owns the email", async () => {
    const app = await buildServer({
      verifyBearer: async (authz) => (authz === "Bearer good" ? { id: "user_9", email: "taken@example.com" } : null),
    });
    try {
      // legacy cookie-era account whose id IS the email
      const login = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email: "taken@example.com" } });
      expect(login.statusCode).toBe(200);

      // bearer user with the same address: provisioned under a sentinel, NOT linked
      const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer good" } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user).toMatchObject({ id: "user_9", email: "user_9@clerk.local" });
    } finally {
      await app.close();
    }
  });
});

describe("resolveDevLoginEnabled (fail-closed in production)", () => {
  it("production defaults OFF; explicit enable turns it on; DISABLE always wins; local keeps it", () => {
    expect(resolveDevLoginEnabled({ NODE_ENV: "production" }, false)).toBe(false);
    expect(resolveDevLoginEnabled({ NODE_ENV: "production", ENABLE_DEV_LOGIN: "true" }, false)).toBe(true);
    expect(resolveDevLoginEnabled({ NODE_ENV: "production" }, true)).toBe(true); // local single-user mode
    expect(resolveDevLoginEnabled({ NODE_ENV: "production", ENABLE_DEV_LOGIN: "true", DISABLE_DEV_LOGIN: "true" }, false)).toBe(false);
    expect(resolveDevLoginEnabled({ DISABLE_DEV_LOGIN: "true" }, true)).toBe(false);
    expect(resolveDevLoginEnabled({}, false)).toBe(true); // dev/test default stays on
  });

  it("the server 404s dev login when NODE_ENV=production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = await buildServer();
      try {
        const res = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email: "a@b.com" } });
        expect(res.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe("rate limiting", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_MAX;
  });

  it("throttles dev login past the ceiling with 429", async () => {
    process.env.RATE_LIMIT_MAX = "2";
    const app = await buildServer();
    try {
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email: "rl@example.com" } });
        codes.push(res.statusCode);
      }
      expect(codes).toEqual([200, 200, 429]);
    } finally {
      await app.close();
    }
  });
});
