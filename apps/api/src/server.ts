// Pipeline hosted API (Fastify). Now reads the board from PERSISTED, per-user
// derived records (Postgres via @pipeline/db), not a recompute on every call.
// Demo data is seeded for a stand-in dev user. Real OAuth connect, per-user
// auth, encrypted-token storage (the @pipeline/crypto + @pipeline/db plumbing is
// already in place), and incremental sync are the next steps (plan §8/§10).
import Fastify from "fastify";
import cors from "@fastify/cors";
import { boardSchema } from "@pipeline/contracts";
import { getBoardForUser, setUserPlan, getMailConnections, clearSyncedApplications, resetSyncForUser } from "@pipeline/db";
import { issueLicense } from "@pipeline/license";
import type { HttpTransport } from "@pipeline/providers";
import { initStore, seedDemoForUser, resolveMasterKey } from "./store";
import { loadProviderConfigs } from "./config";
import { registerOAuthRoutes } from "./oauth-routes";
import { registerAuthRoutes } from "./auth-routes";
import { registerProRoutes } from "./pro-routes";
import { memoryPendingStore, redisPendingStore } from "./pending-store";
import { startSyncScheduler } from "./scheduler";
import { syncAllConnections } from "./sync-service";
import { verifyWebhookSignature, planFromEvent, type BillingEvent } from "./billing";
import {
  resolveSessionSecret,
  verifySession,
  readCookie,
  requireUser,
  SESSION_COOKIE,
  type RequestWithUser,
} from "./auth";

export interface ServerOptions {
  transport?: HttpTransport; // injected in tests; defaults to real fetch
}

export async function buildServer(opts: ServerOptions = {}) {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  const store = await initStore();
  const masterKey = resolveMasterKey();
  const configs = loadProviderConfigs(process.env);
  app.addHook("onClose", async () => {
    await store.close();
  });

  // Capture the raw JSON body (needed to verify webhook HMAC signatures) while
  // still parsing it normally for every other route.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    (_req as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Resolve the authenticated user from the session cookie on every request.
  const sessionSecret = resolveSessionSecret();
  app.addHook("preHandler", async (req) => {
    const user = verifySession(sessionSecret, readCookie(req, SESSION_COOKIE));
    if (user) (req as RequestWithUser).user = user;
  });

  const allowedEmails = new Set(
    (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  registerAuthRoutes(app, {
    db: store.db,
    sessionSecret,
    devLoginEnabled: process.env.DISABLE_DEV_LOGIN !== "true",
    allowedEmails: allowedEmails.size ? allowedEmails : undefined,
    loginPassphrase: process.env.LOGIN_PASSPHRASE || undefined,
    onNewUser: seedDemoForUser,
  });

  app.get("/api/health", async () => ({ ok: true, service: "pipeline-api" }));

  app.get("/api/applications", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    // Label the board by where the data came from: "synced" once a mailbox is
    // connected, "demo" for the seeded board a brand-new user sees.
    const connected = (await getMailConnections(store.db, user.id)).length > 0;
    const board = await getBoardForUser(store.db, user.id, connected ? "synced" : "demo");
    return boardSchema.parse(board); // validate against the shared contract before returning
  });

  // Sync the signed-in user's connected mailboxes. `{ rebuild: true }` first wipes
  // the auto-synced records and resets cursors, so the board is re-derived from
  // scratch (e.g. to apply an improved noise filter); manual entries are kept.
  app.post("/api/sync", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    if ((req.body as { rebuild?: boolean } | null)?.rebuild === true) {
      await clearSyncedApplications(store.db, user.id);
      await resetSyncForUser(store.db, user.id);
    }
    return syncAllConnections({ db: store.db, masterKey, userId: user.id, configs, transport: opts.transport });
  });

  // Pro-tier routes (analytics, reminders, export, notes/contacts) — all gated.
  const licensePublicKey = process.env.PIPELINE_LICENSE_PUBLIC_KEY;
  registerProRoutes(app, { db: store.db, licensePublicKey });

  // Merchant-of-Record billing webhook: verify HMAC, then upgrade/downgrade the
  // user's plan and (if a signing key is configured) hand back a license token.
  const billingSecret = process.env.BILLING_WEBHOOK_SECRET;
  const licensePrivateKey = process.env.PIPELINE_LICENSE_PRIVATE_KEY;
  app.post("/webhooks/billing", async (req, reply) => {
    if (!billingSecret) return reply.code(503).send({ error: "billing not configured" });
    const raw = (req as { rawBody?: string }).rawBody ?? "";
    const signature = (req.headers["x-signature"] as string) ?? "";
    if (!verifyWebhookSignature(raw, billingSecret, signature)) {
      return reply.code(401).send({ error: "bad signature" });
    }
    const change = planFromEvent(req.body as BillingEvent);
    if (change) await setUserPlan(store.db, change.userId, change.plan);
    let license: string | undefined;
    if (change && change.plan !== "free" && licensePrivateKey) {
      license = issueLicense(licensePrivateKey, { sub: change.userId, plan: change.plan, iat: Date.now() });
    }
    return { ok: true, change, license };
  });

  // OAuth state store: Redis (multi-replica) when configured, else in-memory.
  const pending = process.env.REDIS_URL ? redisPendingStore(process.env.REDIS_URL) : memoryPendingStore();
  registerOAuthRoutes(app, {
    db: store.db,
    masterKey,
    resolveUserId: (req) => (req as RequestWithUser).user?.id ?? null,
    configs,
    transport: opts.transport,
    publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3001",
    webUrl: process.env.WEB_URL ?? "http://localhost:5173",
    pending,
  });

  // Background sync scheduler — opt-in via SYNC_INTERVAL_MS (off in tests/dev by default).
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS ?? 0);
  if (intervalMs > 0) {
    const stop = startSyncScheduler({ db: store.db, masterKey, configs, transport: opts.transport }, intervalMs, (m) => app.log.info(m));
    app.addHook("onClose", async () => stop());
  }

  return app;
}

// Only start a listener when run directly (so tests can import buildServer()).
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3001);
  buildServer()
    .then((app) =>
      app.listen({ port, host: "0.0.0.0" }).then(() => {
        app.log.info(`Pipeline API ready on http://localhost:${port}/api/applications`);
      }),
    )
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
