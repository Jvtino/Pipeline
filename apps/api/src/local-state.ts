// Local single-user persistence. When Pipeline runs on your own machine (the
// double-click launcher → `tsx src/server.ts`, no DATABASE_URL), it has no
// secrets manager and no managed Postgres. Without help, every restart would
// regenerate the master key + session secret and spin up a fresh in-memory DB —
// so the app would FORGET every connected mailbox and you'd have to reconnect
// Gmail/Outlook on each launch. (That is the "I keep having to set it up again"
// pain.)
//
// This module gives the local app a stable home OUTSIDE the repo (so the
// launcher's `git reset --hard` / re-clone on update never wipes it):
//
//   ~/.pipeline/secrets.json   { masterKey, sessionSecret }   (0600, created once)
//   ~/.pipeline/db/            persistent PGlite database dir
//
// Hosted deployments are unaffected: they set PIPELINE_MASTER_KEY / SESSION_SECRET
// / DATABASE_URL, which always take precedence, and this module is never consulted.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface LocalSecrets {
  masterKey: string; // base64, 32 bytes — wraps mail tokens at rest (@pipeline/crypto)
  sessionSecret: string; // base64 — signs the login session cookie
}

/** Base directory for the local app's persistent state. Override with PIPELINE_HOME. */
export function localStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PIPELINE_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".pipeline");
}

function isBase64Bytes(s: unknown, bytes: number): boolean {
  if (typeof s !== "string" || s.length === 0) return false;
  try {
    return Buffer.from(s, "base64").length === bytes;
  } catch {
    return false;
  }
}

/**
 * Load the persisted local secrets, creating (and saving) them on first run.
 * Stable across restarts, so tokens encrypted with the master key — and the
 * login session — survive relaunching the app.
 */
export function loadOrCreateLocalSecrets(dir: string = localStateDir()): LocalSecrets {
  const file = join(dir, "secrets.json");
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LocalSecrets>;
    // Only trust a well-formed file; otherwise fall through and regenerate.
    if (isBase64Bytes(parsed.masterKey, 32) && typeof parsed.sessionSecret === "string" && parsed.sessionSecret.length > 0) {
      return { masterKey: parsed.masterKey!, sessionSecret: parsed.sessionSecret };
    }
  } catch {
    /* missing or unreadable — create below */
  }
  const secrets: LocalSecrets = {
    masterKey: randomBytes(32).toString("base64"),
    sessionSecret: randomBytes(32).toString("base64"),
  };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  return secrets;
}

/** Persistent PGlite data directory for the local app (created if missing). */
export function localDbDir(dir: string = localStateDir()): string {
  const db = join(dir, "db");
  mkdirSync(db, { recursive: true, mode: 0o700 });
  return db;
}
