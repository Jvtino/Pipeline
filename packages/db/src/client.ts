// DB handle. Two drivers, one schema + migrations:
//   - DATABASE_URL set  → managed Postgres (node-postgres pool)   [production]
//   - otherwise         → PGlite (in-process Postgres)            [dev / test]
// PGlite IS Postgres, so queries/migrations are identical across both.
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { schema } from "./schema";
import { INIT_SQL } from "./migrations";

// Common base type both drivers satisfy, so the repository is driver-agnostic.
export type Database = PgDatabase<any, typeof schema>;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
  client?: PGlite; // present only on the PGlite path (handy in tests)
}

export interface CreateDbOptions {
  databaseUrl?: string; // managed Postgres; defaults to process.env.DATABASE_URL
  dataDir?: string; // PGlite persistence dir; omit for in-memory
}

/** Create a database handle and ensure the schema exists. */
export async function createDb(opts: CreateDbOptions = {}): Promise<DbHandle> {
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;

  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
    await pool.query(INIT_SQL);
    const db = drizzleNodePg(pool, { schema }) as unknown as Database;
    return { db, close: async () => void (await pool.end()) };
  }

  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  await client.waitReady;
  await client.exec(INIT_SQL);
  const db = drizzlePglite(client, { schema }) as unknown as Database;
  return { db, client, close: () => client.close() };
}
