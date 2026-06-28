// Persistence wiring. DATABASE_URL → managed Postgres (prod); otherwise in-process
// PGlite (dev/test). New users are seeded with demo data on first login so their
// board isn't empty before they connect a real mailbox.
import { createDb, upsertApplications, countApplications, type Database, type DbHandle } from "@pipeline/db";
import { generateMasterKey, masterKeyFromEnv } from "@pipeline/crypto";
import { threadsToApplications } from "@pipeline/classify";
import { DEMO_THREADS } from "./demo-data";

/** Master key that wraps mail tokens at rest. Required in production; ephemeral (with a warning) in dev. */
export function resolveMasterKey(): Buffer {
  try {
    return masterKeyFromEnv();
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      "[pipeline] PIPELINE_MASTER_KEY not set — using an EPHEMERAL dev key. " +
        "Mail tokens encrypted with it will NOT survive a restart. Set a real key in production.",
    );
    return Buffer.from(generateMasterKey(), "base64");
  }
}

export async function initStore(): Promise<DbHandle> {
  return createDb({ databaseUrl: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR });
}

/** Seed a brand-new user with demo applications (onboarding) — idempotent. */
export async function seedDemoForUser(db: Database, userId: string): Promise<void> {
  if ((await countApplications(db, userId)) === 0) {
    await upsertApplications(db, userId, threadsToApplications(DEMO_THREADS));
  }
}
