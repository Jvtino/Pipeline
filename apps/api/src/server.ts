// Pipeline hosted API (Fastify). Now reads the board from PERSISTED, per-user
// derived records (Postgres via @pipeline/db), not a recompute on every call.
// Demo data is seeded for a stand-in dev user. Real OAuth connect, per-user
// auth, encrypted-token storage (the @pipeline/crypto + @pipeline/db plumbing is
// already in place), and incremental sync are the next steps (plan §8/§10).
import Fastify from "fastify";
import cors from "@fastify/cors";
import { boardSchema } from "@pipeline/contracts";
import { getBoardForUser, setUserPlan, getMailConnections, rebuildSyncedApplications, deleteMailConnection } from "@pipeline/db";
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
  // Local single-user mode (the desktop launcher): persist the master key,
  // session secret and DB to ~/.pipeline so connected mailboxes survive a
  // restart. Defaults to off, so tests stay ephemeral + isolated. Hosted
  // deployments leave this off and supply the secrets/DATABASE_URL via env.
  local?: boolean;
}

export async function buildServer(opts: ServerOptions = {}) {
  const local = opts.local ?? false;
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  const store = await initStore(local);
  const masterKey = resolveMasterKey(local);
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
  const sessionSecret = resolveSessionSecret(local);
  app.addHook("preHandler", async (req) => {
    const user = verifySession(sessionSecret, readCookie(req, SESSION_COOKIE));
    if (user) (req as RequestWithUser).user = user;
  });

  registerAuthRoutes(app, {
    db: store.db,
    sessionSecret,
    devLoginEnabled: process.env.DISABLE_DEV_LOGIN !== "true",
    onNewUser: seedDemoForUser,
  });

  app.get("/api/health", async () => ({ ok: true, service: "pipeline-api" }));

  app.get("/api/applications", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const board = await getBoardForUser(store.db, user.id, "demo");
    return boardSchema.parse(board); // validate against the shared contract before returning
  });

  // Trigger an incremental sync of the signed-in user's connected mailboxes.
  app.post("/api/sync", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    return syncAllConnections({ db: store.db, masterKey, userId: user.id, configs, transport: opts.transport });
  });

  // Rebuild the board from the connected mailboxes. Clears the AUTO-SYNCED
  // applications (keeping manual + annotated ones), resets the sync cursors, then
  // runs a full sync so only mail that passes the CURRENT relevance gate is
  // re-listed. This is the recovery path after a bad sync floods the board with
  // non-application mail — the gate fix stops new floods; this clears an old one.
  app.post("/api/resync", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    // No mailbox to rebuild from → safe no-op (don't clear the seeded demo board).
    if ((await getMailConnections(store.db, user.id)).length === 0) return { removed: 0, connections: 0, results: [] };
    // The web app annotates applications in a client-side overlay the server
    // can't see; it sends those thread ids so the rebuild keeps them too.
    const rawKeep = (req.body as { keepThreadIds?: unknown } | undefined)?.keepThreadIds;
    const keepThreadIds = Array.isArray(rawKeep)
      ? rawKeep.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 256).slice(0, 5000)
      : [];
    const { removed } = await rebuildSyncedApplications(store.db, user.id, keepThreadIds);
    const summary = await syncAllConnections({ db: store.db, masterKey, userId: user.id, configs, transport: opts.transport });
    return { removed, ...summary };
  });

  // Connected mailboxes (metadata only — no secrets). Powers the header's
  // "Connected: N E-mails" chip and the Settings mailbox list.
  app.get("/api/connections", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const mailboxes = await getMailConnections(store.db, user.id);
    return { count: mailboxes.length, mailboxes: mailboxes.map((m) => ({ id: m.id, provider: m.provider, email: m.email })) };
  });

  // Disconnect a mailbox for real: delete the connection row (the encrypted
  // token goes with it, and sync_state cascades), so background sync stops
  // reading the account. Scoped to the signed-in owner.
  app.delete("/api/connections/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const id = (req.params as { id?: string }).id ?? "";
    const removed = await deleteMailConnection(store.db, user.id, id);
    if (!removed) return reply.code(404).send({ error: "connection not found" });
    return { ok: true };
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
  // Local single-user run (the double-click launcher): no managed Postgres →
  // persist secrets + DB to ~/.pipeline so connected mailboxes survive a restart.
  // A hosted deploy sets DATABASE_URL, which keeps this off (and can opt out
  // explicitly with PIPELINE_LOCAL=false).
  const local = !process.env.DATABASE_URL && process.env.PIPELINE_LOCAL !== "false";
  buildServer({ local })
    .then((app) =>
      app.listen({ port, host: "0.0.0.0" }).then(() => {
        app.log.info(`Pipeline API ready on http://localhost:${port}/api/applications`);
        if (local) app.log.info("Local mode: mailboxes + session persist in ~/.pipeline (set PIPELINE_HOME to change).");
      }),
    )
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
