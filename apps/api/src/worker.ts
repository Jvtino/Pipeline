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
import { expoPushGateway } from "./push";
import { notifyTransitions, notifyInterviewReminders, sweepReceipts, type NotifyDeps } from "./notifications";

const log = (msg: string) => console.log(`[pipeline-worker] ${new Date().toISOString()} ${msg}`);

async function main(): Promise<void> {
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS ?? 300_000);
  if (!(intervalMs > 0)) throw new Error("SYNC_INTERVAL_MS must be a positive number of milliseconds");
  const store = await initStore(false);
  const masterKey = resolveMasterKey(false);
  const configs = loadProviderConfigs(process.env);

  const notify: NotifyDeps = { db: store.db, gateway: expoPushGateway(), log };
  const stop = startSyncScheduler(
    {
      db: store.db,
      masterKey,
      configs,
      onTransitions: (userId, transitions) => notifyTransitions(notify, userId, transitions),
    },
    intervalMs,
    log,
  );
  log(`sync scheduler running every ${Math.round(intervalMs / 1000)}s (push notifications on)`);

  // Reminder scan + receipt sweep ride their own interval so a slow mailbox
  // sync can never delay an interview ping. Every send is dedupe-guarded, so
  // overlap with the web process's scheduler is harmless.
  const notifyTick = async () => {
    try {
      await notifyInterviewReminders(notify);
      await sweepReceipts(notify);
    } catch (e) {
      log(`notify tick error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  void notifyTick();
  const notifyHandle = setInterval(() => void notifyTick(), Math.min(intervalMs, 5 * 60 * 1000));
  if (typeof notifyHandle.unref === "function") notifyHandle.unref();

  // Interval handles are unref'd — keep the process alive until told to stop.
  const alive = setInterval(() => {}, 1 << 30);
  const shutdown = async (signal: string) => {
    log(`${signal} — shutting down`);
    clearInterval(alive);
    clearInterval(notifyHandle);
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
