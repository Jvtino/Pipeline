import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDb, type DbHandle } from "@pipeline/db";
import { registerAuthRoutes } from "./auth-routes";

let h: DbHandle;
let app: FastifyInstance;

async function makeApp(opts: { allowedEmails?: Set<string>; loginPassphrase?: string }): Promise<FastifyInstance> {
  const a = Fastify();
  registerAuthRoutes(a, {
    db: h.db,
    sessionSecret: "test-secret",
    devLoginEnabled: true,
    allowedEmails: opts.allowedEmails,
    loginPassphrase: opts.loginPassphrase,
  });
  await a.ready();
  return a;
}

const login = (email: string, passphrase?: string) =>
  app.inject({ method: "POST", url: "/auth/dev/login", payload: { email, passphrase } });

beforeEach(async () => {
  h = await createDb();
});
afterEach(async () => {
  await app?.close();
  await h.close();
});

describe("hosted login gate", () => {
  it("ungated: any email logs in (local dev unchanged)", async () => {
    app = await makeApp({});
    const res = await login("x@y.com");
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeTruthy();
  });

  it("requires the passphrase when one is configured", async () => {
    app = await makeApp({ loginPassphrase: "s3cret" });
    expect((await login("x@y.com")).statusCode).toBe(401); // missing
    expect((await login("x@y.com", "nope")).statusCode).toBe(401); // wrong
    expect((await login("x@y.com", "s3cret")).statusCode).toBe(200); // right
  });

  it("enforces the email allowlist (case-insensitively)", async () => {
    app = await makeApp({ allowedEmails: new Set(["me@pipeline.app"]) });
    expect((await login("stranger@x.com")).statusCode).toBe(403);
    expect((await login("ME@pipeline.app")).statusCode).toBe(200);
  });
});
