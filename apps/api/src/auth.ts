// Sessions + identity. Every request resolves to an authenticated user; routes
// are scoped to that user's id (no more single stand-in). The dev login issues a
// signed session cookie so the app is usable + testable without an external IdP;
// a Clerk/Auth.js adapter slots in behind the same `req.user` seam for production
// (verify the provider's session token in the preHandler instead of our cookie).
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

// MUST be "__session": Firebase Hosting strips every cookie except this exact
// name from requests it forwards to Cloud Run, so any other name breaks sessions
// behind Hosting. The name is otherwise arbitrary and works fine locally too.
export const SESSION_COOKIE = "__session";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: string;
  email: string;
}

interface SessionPayload extends AuthUser {
  iat: number;
  exp: number;
}

export type RequestWithUser = FastifyRequest & { user?: AuthUser };

/** Session signing secret from env, or an ephemeral dev key (sessions won't survive a restart). */
export function resolveSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // eslint-disable-next-line no-console
  console.warn("[pipeline] SESSION_SECRET not set — using an EPHEMERAL dev key; sessions reset on restart.");
  return randomBytes(32).toString("base64");
}

export function signSession(secret: string, user: AuthUser, now: number = Date.now(), ttlMs: number = DEFAULT_TTL_MS): string {
  const payload: SessionPayload = { id: user.id, email: user.email, iat: now, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(secret: string, token: string | undefined, now: number = Date.now()): AuthUser | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: SessionPayload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (p.exp && now > p.exp) return null;
  return { id: p.id, email: p.email };
}

/** Read a named cookie from the request (Fastify doesn't parse cookies by default). */
export function readCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, secure = process.env.NODE_ENV === "production"): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(DEFAULT_TTL_MS / 1000)}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Resolve the authenticated user or send 401. Returns null when unauthenticated. */
export function requireUser(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const u = (req as RequestWithUser).user;
  if (!u) {
    reply.code(401).send({ error: "authentication required" });
    return null;
  }
  return u;
}
