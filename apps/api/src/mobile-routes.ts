// Mobile-facing endpoints (all additive — nothing existing moves):
//   POST/GET/PATCH/DELETE /api/devices      push registration + prefs
//   PATCH /api/applications/:threadId       sticky status override
//   POST  /api/applications                 manual add (server-side, not overlay)
//   GET   /api/review, POST /api/review/:id the simplified review queue
//   POST  /api/connect-token                one-time nonce so the SYSTEM BROWSER
//                                           (no cookie, no bearer) can start mail
//                                           OAuth for a token-authenticated phone
//   DELETE /api/account                     in-app account deletion (App Store 5.1.1(v))
//   GET   /api/meta                         min-version gate + feature flags
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { statusSchema, type Application, type Status } from "@pipeline/contracts";
import {
  upsertApplications,
  getApplicationForUser,
  setStatusOverride,
  listReviewQueue,
  markReviewed,
  upsertDevice,
  listDevices,
  updateDevice,
  deleteDevice,
  getMailConnections,
  getMailConnectionSecret,
  deleteUser,
  type Database,
} from "@pipeline/db";
import { fetchTransport, type HttpTransport, type OAuthTokens } from "@pipeline/providers";
import { requireUser, rateLimited, clearSessionCookie } from "./auth";
import type { ProviderConfigs } from "./config";
import { CONNECT_TOKEN_PREFIX, type PendingStore } from "./pending-store";

export interface MobileRouteDeps {
  db: Database;
  masterKey: Buffer;
  configs: ProviderConfigs;
  transport?: HttpTransport;
  /** Shared with the OAuth routes: connect tokens ride the same store (Redis-safe). */
  pending: PendingStore;
  /** Evict a deleted user from the server's provisioning cache. */
  forgetUser?: (userId: string) => void;
  /** Delete the user at the IdP (Clerk backend API). Absent → identity outlives
   *  the data, which is safe (a fresh sign-in just re-provisions an empty board). */
  deleteIdentity?: (userId: string) => Promise<void>;
}

const CONNECT_TOKEN_TTL_MS = 10 * 60 * 1000;
export { CONNECT_TOKEN_PREFIX } from "./pending-store";

const PLATFORMS = new Set(["ios", "android", "web"]);

/** Gmail's restricted-scope verification gates public availability: the flag lets
 *  the app launch Microsoft-first and flip Gmail on the day Google approves.
 *  FEATURE_GMAIL_CONNECT overrides; default = whether Google OAuth is configured. */
export function gmailConnectEnabled(env: NodeJS.ProcessEnv, configs: ProviderConfigs): boolean {
  if (env.FEATURE_GMAIL_CONNECT === "true") return true;
  if (env.FEATURE_GMAIL_CONNECT === "false") return false;
  return Boolean(configs.google?.clientId);
}

const asTrimmed = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= max ? s : null;
};

const parseStatus = (v: unknown): Status | null => {
  const r = statusSchema.safeParse(v);
  return r.success ? r.data : null;
};

export function registerMobileRoutes(app: FastifyInstance, d: MobileRouteDeps): void {
  const transport = d.transport ?? fetchTransport;

  // ── Devices ────────────────────────────────────────────────────────────────
  app.post("/api/devices", rateLimited(60), async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const body = (req.body ?? {}) as { expoPushToken?: unknown; platform?: unknown; deviceName?: unknown };
    const expoPushToken = asTrimmed(body.expoPushToken, 512);
    const platform = typeof body.platform === "string" && PLATFORMS.has(body.platform) ? (body.platform as "ios" | "android" | "web") : null;
    if (!expoPushToken || !platform) return reply.code(400).send({ error: "expoPushToken and platform (ios|android|web) are required" });
    const device = await upsertDevice(d.db, {
      userId: user.id,
      platform,
      expoPushToken,
      deviceName: asTrimmed(body.deviceName, 120),
    });
    return { device };
  });

  app.get("/api/devices", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    return { devices: await listDevices(d.db, user.id) };
  });

  app.patch("/api/devices/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const id = (req.params as { id?: string }).id ?? "";
    const body = (req.body ?? {}) as { notifyStatusChanges?: unknown; notifyReminders?: unknown };
    const prefs: { notifyStatusChanges?: boolean; notifyReminders?: boolean } = {};
    if (typeof body.notifyStatusChanges === "boolean") prefs.notifyStatusChanges = body.notifyStatusChanges;
    if (typeof body.notifyReminders === "boolean") prefs.notifyReminders = body.notifyReminders;
    if (Object.keys(prefs).length === 0) return reply.code(400).send({ error: "nothing to update" });
    const device = await updateDevice(d.db, user.id, id, prefs);
    if (!device) return reply.code(404).send({ error: "device not found" });
    return { device };
  });

  app.delete("/api/devices/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const id = (req.params as { id?: string }).id ?? "";
    if (!(await deleteDevice(d.db, user.id, id))) return reply.code(404).send({ error: "device not found" });
    return { ok: true };
  });

  // ── Application writes ─────────────────────────────────────────────────────
  // Rate-limited like every other write surface: each status change inserts an
  // events row and each create is a new record — self-scoped, but unbounded
  // write amplification deserves a ceiling.
  app.patch("/api/applications/:threadId", rateLimited(60), async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const threadId = (req.params as { threadId?: string }).threadId ?? "";
    const status = parseStatus((req.body as { status?: unknown } | undefined)?.status);
    if (!status) return reply.code(400).send({ error: "a valid status is required" });
    const application = await setStatusOverride(d.db, user.id, threadId, status);
    if (!application) return reply.code(404).send({ error: "application not found" });
    return { application };
  });

  app.post("/api/applications", rateLimited(30), async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const body = (req.body ?? {}) as { company?: unknown; role?: unknown; status?: unknown; appliedOn?: unknown };
    const company = asTrimmed(body.company, 200);
    const role = asTrimmed(body.role, 200);
    if (!company || !role) return reply.code(400).send({ error: "company and role are required" });
    const status = body.status === undefined ? "applied" : parseStatus(body.status);
    if (!status) return reply.code(400).send({ error: "a valid status is required" });
    const appliedOnRaw = asTrimmed(body.appliedOn, 40);
    // Strict YYYY-MM-DD, validated as a real calendar date — every other record
    // upholds that shape, and storing "June 2026" or a full timestamp verbatim
    // would corrupt board activity sorting.
    const appliedOnDay = appliedOnRaw ? /^(\d{4}-\d{2}-\d{2})/.exec(appliedOnRaw)?.[1] : undefined;
    const appliedOn =
      appliedOnDay && !Number.isNaN(Date.parse(`${appliedOnDay}T00:00:00Z`)) ? appliedOnDay : new Date().toISOString().slice(0, 10);

    const threadId = `manual:${randomUUID()}`;
    const application: Application = {
      id: threadId, // rewritten to `${userId}:${threadId}` by the upsert
      threadId,
      company,
      companyDomain: "", // no mail thread → no sender domain; grouping falls back to the company name
      role,
      status,
      firstSeen: appliedOn,
      lastActivity: appliedOn,
      snippet: "",
      manual: true,
    };
    await upsertApplications(d.db, user.id, [application], { eventSource: "user" });
    return reply.code(201).send({ application: await getApplicationForUser(d.db, user.id, threadId) });
  });

  // ── Review queue ───────────────────────────────────────────────────────────
  app.get("/api/review", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    return { applications: await listReviewQueue(d.db, user.id) };
  });

  app.post("/api/review/:threadId", rateLimited(60), async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const threadId = (req.params as { threadId?: string }).threadId ?? "";
    const body = (req.body ?? {}) as { action?: unknown; status?: unknown };
    if (body.action !== "confirm" && body.action !== "set") {
      return reply.code(400).send({ error: "action must be 'confirm' or 'set'" });
    }
    let application: Application | null = null;
    if (body.action === "set") {
      const status = parseStatus(body.status);
      if (!status) return reply.code(400).send({ error: "a valid status is required with action 'set'" });
      application = await setStatusOverride(d.db, user.id, threadId, status);
      if (!application) return reply.code(404).send({ error: "application not found" });
    }
    if (!(await markReviewed(d.db, user.id, threadId))) return reply.code(404).send({ error: "application not found" });
    application ??= await getApplicationForUser(d.db, user.id, threadId);
    return { ok: true, application };
  });

  // ── Connect token (mail OAuth from a phone) ────────────────────────────────
  // The phone authenticates with a Bearer header, but the mail OAuth flow runs in
  // the SYSTEM BROWSER, which carries neither the header nor a cookie. So the
  // phone first trades its bearer auth for a one-time, short-lived nonce, then
  // opens /auth/:provider/start?ct=<nonce> — the start route resolves the user
  // from the nonce. Same PKCE + server-side token custody as web; the phone never
  // sees a mail token.
  app.post("/api/connect-token", rateLimited(10), async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const provider = (req.body as { provider?: unknown } | undefined)?.provider;
    if (provider !== "google" && provider !== "microsoft") {
      return reply.code(400).send({ error: "provider must be 'google' or 'microsoft'" });
    }
    if (!d.configs[provider]?.clientId) return reply.code(400).send({ error: "provider not configured" });
    if (provider === "google" && !gmailConnectEnabled(process.env, d.configs)) {
      return reply.code(403).send({ error: "gmail connect is not yet available" });
    }
    const connectToken = randomBytes(32).toString("base64url");
    await d.pending.set(`${CONNECT_TOKEN_PREFIX}${connectToken}`, { provider, verifier: "", userId: user.id, returnTo: "mobile" }, CONNECT_TOKEN_TTL_MS);
    return { connectToken, expiresInSeconds: CONNECT_TOKEN_TTL_MS / 1000, startPath: `/auth/${provider}/start?ct=${connectToken}` };
  });

  // ── Account deletion (App Store guideline 5.1.1(v)) ────────────────────────
  app.delete("/api/account", rateLimited(5), async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;

    // Best-effort provider-side revocation BEFORE the rows (and their encrypted
    // secrets) disappear. Google exposes a revoke endpoint; Microsoft consumer
    // accounts don't — users revoke at account.live.com (documented in PRIVACY).
    for (const conn of await getMailConnections(d.db, user.id)) {
      if (conn.provider !== "google") continue;
      try {
        const secret = await getMailConnectionSecret<OAuthTokens>(d.db, d.masterKey, conn.id);
        const token = secret?.refresh_token ?? secret?.access_token;
        if (token) await transport.postForm("https://oauth2.googleapis.com/revoke", { token });
      } catch (err) {
        req.log.warn({ err, connection: conn.id }, "token revocation failed (continuing with deletion)");
      }
    }

    await deleteUser(d.db, user.id); // cascades every owned row
    d.forgetUser?.(user.id);
    if (d.deleteIdentity) {
      try {
        await d.deleteIdentity(user.id);
      } catch (err) {
        req.log.error({ err }, "IdP user deletion failed — data is gone, identity remains");
      }
    }
    reply.header("Set-Cookie", clearSessionCookie());
    return { ok: true };
  });

  // ── Meta (min-version gate + feature flags; public, no secrets) ────────────
  app.get("/api/meta", async () => ({
    ok: true,
    minMobileVersion: process.env.MIN_MOBILE_VERSION ?? "0.0.0",
    features: {
      gmailConnect: gmailConnectEnabled(process.env, d.configs),
      microsoftConnect: Boolean(d.configs.microsoft?.clientId),
    },
  }));
}
