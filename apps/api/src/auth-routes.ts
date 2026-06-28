// Auth routes. The dev login is the working identity provider until a hosted IdP
// (Clerk/Auth.js) is wired — it creates/loads a user by email and issues a signed
// session cookie. Disable it in production (DISABLE_DEV_LOGIN=true) once a real
// IdP populates `req.user` in the preHandler instead.
import type { FastifyInstance } from "fastify";
import { getUser, upsertUser, type Database } from "@pipeline/db";
import { signSession, sessionCookie, clearSessionCookie, type RequestWithUser } from "./auth";

export interface AuthRouteDeps {
  db: Database;
  sessionSecret: string;
  devLoginEnabled: boolean;
  onNewUser?: (db: Database, userId: string) => Promise<void>;
}

export function registerAuthRoutes(app: FastifyInstance, d: AuthRouteDeps): void {
  app.post("/auth/dev/login", async (req, reply) => {
    if (!d.devLoginEnabled) return reply.code(404).send({ error: "not found" });
    const email = ((req.body as { email?: string } | undefined)?.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) return reply.code(400).send({ error: "a valid email is required" });

    const existing = await getUser(d.db, email);
    await upsertUser(d.db, { id: email, email });
    if (!existing && d.onNewUser) await d.onNewUser(d.db, email);

    reply.header("Set-Cookie", sessionCookie(signSession(d.sessionSecret, { id: email, email })));
    return { user: { id: email, email } };
  });

  app.get("/auth/me", async (req, reply) => {
    const u = (req as RequestWithUser).user;
    if (!u) return reply.code(401).send({ error: "not authenticated" });
    return { user: u };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.header("Set-Cookie", clearSessionCookie());
    return { ok: true };
  });
}
