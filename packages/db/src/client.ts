// DB handle. Uses PGlite (in-process Postgres) so dev/test need no external DB;
// the same schema + SQL runs on managed Postgres in production (swap the driver,
// point at DATABASE_URL). PGlite IS Postgres, so queries/migrations are real.
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { schema } from "./schema";
import { INIT_SQL } from "./migrations";

export type Database = PgliteDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  client: PGlite;
  close: () => Promise<void>;
}

/**
 * Create a database handle and ensure the schema exists.
 * @param dataDir omit (or pass "memory://") for an in-memory DB (dev/test);
 *                pass a filesystem path to persist across restarts.
 */
export async function createDb(dataDir?: string): Promise<DbHandle> {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  await client.exec(INIT_SQL);
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.close() };
}
