// Auth routes. The dev login is the working identity provider until a hosted IdP
// (Clerk/Auth.js) is wired — it creates/loads a user by email and issues a signed
// session cookie. Disable it in production (DISABLE_DEV_LOGIN=true) once a real
// IdP populates `req.user` in the preHandler instead.
import type { FastifyInstance } from "fastify";
import { getUser, upsertUser, setUserPlan, type Database } from "@pipeline/db";
import { signSession, sessionCookie, clearSessionCookie, type RequestWithUser } from "./auth";

export interface AuthRouteDeps {
  db: Database;
  sessionSecret: string;
  devLoginEnabled: boolean;
  onNewUser?: (db: Database, userId: string) => Promise<void>;
}

const PLANS = new Set(["free", "pro", "teams"]);

export function registerAuthRoutes(app: FastifyInstance, d: AuthRouteDeps): void {
  app.post("/auth/dev/login", async (req, reply) => {
    if (!d.devLoginEnabled) return reply.code(404).send({ error: "not found" });
    const email = ((req.body as { email?: string } | undefined)?.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) return reply.code(400).send({ error: "a valid email is required" });

    const existing = await getUser(d.db, email);
    await upsertUser(d.db, { id: email, email });
    if (!existing && d.onNewUser) await d.onNewUser(d.db, email);

    reply.header("Set-Cookie", sessionCookie(signSession(d.sessionSecret, { id: email, email })));
    return { user: { id: email, email, plan: "free" } };
  });

  app.get("/auth/me", async (req, reply) => {
    const u = (req as RequestWithUser).user;
    if (!u) return reply.code(401).send({ error: "not authenticated" });
    // The session cookie is signed and valid, but the user row can be gone — e.g.
    // the local PGlite DB was reset while the browser kept its cookie. Report that
    // as unauthenticated so the client re-runs its login (recreating the user +
    // demo seed); otherwise the first user-scoped write — saving a mail connection
    // — fails the users foreign key ("...is not present in table users").
    const dbUser = await getUser(d.db, u.id);
    if (!dbUser) return reply.code(401).send({ error: "not authenticated" });
    return { user: { ...u, plan: dbUser.plan ?? "free" } };
  });

  // Dev-only plan toggle (so the demo can show Pro features without a real
  // purchase). Disabled with DISABLE_DEV_LOGIN — production upgrades go through
  // the billing webhook.
  app.post("/auth/dev/upgrade", async (req, reply) => {
    if (!d.devLoginEnabled) return reply.code(404).send({ error: "not found" });
    const u = (req as RequestWithUser).user;
    if (!u) return reply.code(401).send({ error: "not authenticated" });
    const plan = (req.body as { plan?: string } | undefined)?.plan ?? "pro";
    if (!PLANS.has(plan)) return reply.code(400).send({ error: "invalid plan" });
    await setUserPlan(d.db, u.id, plan as "free" | "pro" | "teams");
    return { user: { ...u, plan } };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.header("Set-Cookie", clearSessionCookie());
    return { ok: true };
  });
}
