// Persistence wiring. DATABASE_URL → managed Postgres (prod); otherwise in-process
// PGlite (dev/test). New users are seeded with demo data on first login so their
// board isn't empty before they connect a real mailbox.
import { createDb, upsertApplications, countApplications, type Database, type DbHandle } from "@pipeline/db";
import { generateMasterKey, masterKeyFromEnv } from "@pipeline/crypto";
import { threadsToApplications } from "@pipeline/classify";
import { DEMO_THREADS } from "./demo-data";
import { loadOrCreateLocalSecrets, localDbDir } from "./local-state";

/**
 * Master key that wraps mail tokens at rest.
 *   - PIPELINE_MASTER_KEY set            → use it (production / explicit).
 *   - else `local` (single-user desktop) → a STABLE key persisted under ~/.pipeline,
 *                                           so connected mailboxes survive a restart.
 *   - else (tests)                       → an ephemeral key (with a warning).
 */
export function resolveMasterKey(local = false): Buffer {
  try {
    return masterKeyFromEnv();
  } catch {
    if (local) return Buffer.from(loadOrCreateLocalSecrets().masterKey, "base64");
    // eslint-disable-next-line no-console
    console.warn(
      "[pipeline] PIPELINE_MASTER_KEY not set — using an EPHEMERAL dev key. " +
        "Mail tokens encrypted with it will NOT survive a restart. Set a real key in production.",
    );
    return Buffer.from(generateMasterKey(), "base64");
  }
}

/**
 * Open the database.
 *   - DATABASE_URL set → managed Postgres (production).
 *   - else `local`     → a PERSISTENT PGlite dir (PGLITE_DIR or ~/.pipeline/db), so the
 *                        local app remembers users/connections/applications across restarts.
 *   - else (tests)     → in-memory PGlite (fresh + isolated per buildServer()).
 */
export async function initStore(local = false): Promise<DbHandle> {
  const databaseUrl = process.env.DATABASE_URL;
  const dataDir = databaseUrl ? undefined : process.env.PGLITE_DIR ?? (local ? localDbDir() : undefined);
  return createDb({ databaseUrl, dataDir });
}

/** Seed a brand-new user with demo applications (onboarding) — idempotent. */
export async function seedDemoForUser(db: Database, userId: string): Promise<void> {
  if ((await countApplications(db, userId)) === 0) {
    await upsertApplications(db, userId, threadsToApplications(DEMO_THREADS));
  }
}
