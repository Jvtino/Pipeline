// Wires the API to the persistence layer. In dev/test this is an in-process
// Postgres (PGlite) seeded with demo data; in production point it at a managed
// Postgres via DATABASE_URL/PGLITE_DIR and remove the seed. Real per-user data
// arrives once OAuth connect + sync land (the next phase).
import {
  createDb,
  upsertUser,
  upsertApplications,
  countApplications,
  type DbHandle,
} from "@pipeline/db";
import { generateMasterKey, masterKeyFromEnv } from "@pipeline/crypto";
import { threadsToApplications } from "./applications";
import { DEMO_THREADS } from "./demo-data";

/** Stand-in identity until real auth lands — every request maps to this user for now. */
export const DEV_USER = { id: "demo-user", email: "demo@pipeline.local" } as const;

/**
 * The master key that wraps mail tokens at rest. Required in production; in dev we
 * fall back to an ephemeral key (and loudly warn) so the app still boots.
 */
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

/** Create the DB, ensure the dev user exists, and seed demo applications once. */
export async function initStore(): Promise<DbHandle> {
  // DATABASE_URL → managed Postgres (prod); else PGlite (in-memory, or PGLITE_DIR).
  const handle = await createDb({ databaseUrl: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR });
  await upsertUser(handle.db, DEV_USER);
  if ((await countApplications(handle.db, DEV_USER.id)) === 0) {
    await upsertApplications(handle.db, DEV_USER.id, threadsToApplications(DEMO_THREADS));
  }
  return handle;
}
