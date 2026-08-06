// Dedicated background worker (run: pnpm --filter @pipeline/api worker).
// Owns the periodic mailbox sync so web instances only serve requests — the
// deploy-level fix for the in-process SYNC_INTERVAL_MS interval flagged in
// PRODUCTION-READINESS §C. Phase 4 (push) plugs notification sending into the
// scheduler's onTransitions feed and adds receipt polling + interview reminders
// to this process; nothing else should ever live here.
//
// Same env contract as the server: DATABASE_URL, PIPELINE_MASTER_KEY, provider
// client ids. SYNC_INTERVAL_MS defaults to 5 minutes here (in the web process it
// stays opt-in, so exactly one process syncs — don't set it on both).
import { initStore, resolveMasterKey } from "./store";
import { loadProviderConfigs } from "./config";
import { startSyncScheduler } from "./scheduler";

const log = (msg: string) => console.log(`[pipeline-worker] ${new Date().toISOString()} ${msg}`);

async function main(): Promise<void> {
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS ?? 300_000);
  if (!(intervalMs > 0)) throw new Error("SYNC_INTERVAL_MS must be a positive number of milliseconds");
  const store = await initStore(false);
  const masterKey = resolveMasterKey(false);
  const configs = loadProviderConfigs(process.env);

  const stop = startSyncScheduler({ db: store.db, masterKey, configs }, intervalMs, log);
  log(`sync scheduler running every ${Math.round(intervalMs / 1000)}s`);

  // Interval handles are unref'd — keep the process alive until told to stop.
  const alive = setInterval(() => {}, 1 << 30);
  const shutdown = async (signal: string) => {
    log(`${signal} — shutting down`);
    clearInterval(alive);
    stop();
    await store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[pipeline-worker] fatal:", err);
  process.exit(1);
});
