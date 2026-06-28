// Background sync scheduler. Periodically syncs every connected mailbox so the
// board stays fresh without a user-initiated /api/sync. Opt-in via SYNC_INTERVAL_MS
// (a real deploy would run this in a separate worker process / queue, but an
// in-process interval is a correct first step). Non-overlapping ticks.
import { syncAllUsers, type SyncDeps } from "./sync-service";

export function startSyncScheduler(
  deps: Omit<SyncDeps, "userId">,
  intervalMs: number,
  log: (msg: string) => void = () => {},
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // skip if the previous tick is still going
    running = true;
    try {
      const r = await syncAllUsers(deps);
      log(`sync scheduler: synced ${r.users} user(s)`);
    } catch (e) {
      log(`sync scheduler error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  if (typeof handle.unref === "function") handle.unref(); // don't keep the process alive on its own
  return () => clearInterval(handle);
}
