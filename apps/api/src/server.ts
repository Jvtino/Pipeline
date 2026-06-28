// Pipeline hosted API (Fastify). Now reads the board from PERSISTED, per-user
// derived records (Postgres via @pipeline/db), not a recompute on every call.
// Demo data is seeded for a stand-in dev user. Real OAuth connect, per-user
// auth, encrypted-token storage (the @pipeline/crypto + @pipeline/db plumbing is
// already in place), and incremental sync are the next steps (plan §8/§10).
import Fastify from "fastify";
import cors from "@fastify/cors";
import { boardSchema } from "@pipeline/contracts";
import { getBoardForUser } from "@pipeline/db";
import type { HttpTransport, ProviderId } from "@pipeline/providers";
import { initStore, DEV_USER, resolveMasterKey } from "./store";
import { loadProviderConfigs } from "./config";
import { registerOAuthRoutes } from "./oauth-routes";

export interface ServerOptions {
  transport?: HttpTransport; // injected in tests; defaults to real fetch
}

export async function buildServer(opts: ServerOptions = {}) {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  const store = await initStore();
  app.addHook("onClose", async () => {
    await store.close();
  });

  app.get("/api/health", async () => ({ ok: true, service: "pipeline-api" }));

  app.get("/api/applications", async () => {
    const board = await getBoardForUser(store.db, DEV_USER.id, "demo");
    return boardSchema.parse(board); // validate against the shared contract before returning
  });

  registerOAuthRoutes(app, {
    db: store.db,
    masterKey: resolveMasterKey(),
    userId: DEV_USER.id,
    configs: loadProviderConfigs(process.env),
    transport: opts.transport,
    publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3001",
    webUrl: process.env.WEB_URL ?? "http://localhost:5173",
    pending: new Map<string, { provider: ProviderId; verifier: string }>(),
  });

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
