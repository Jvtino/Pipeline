// Connect the persisted, encrypted connections to the sync engine: for each of a
// user's OAuth mailboxes, get a valid access token (refreshing + re-encrypting if
// needed), build the right MailSource, and run an incremental sync round.
import { validAccessToken, type HttpTransport, type OAuthTokens, type ProviderId } from "@pipeline/providers";
import { gmailSource, graphSource, runSync, type MailSource, type SyncResult } from "@pipeline/sync";
import {
  getMailConnections,
  getMailConnectionSecret,
  updateMailConnectionSecret,
  listUserIdsWithConnections,
  deleteDemoApplications,
  type Database,
  type StatusTransition,
} from "@pipeline/db";
import type { ProviderConfigs } from "./config";

export type SourceFactory = (provider: ProviderId, token: string, transport?: HttpTransport) => MailSource;

const defaultSourceFactory: SourceFactory = (p, token, transport) =>
  p === "google" ? gmailSource(token, transport) : graphSource(token, transport);

export interface SyncSummary {
  connections: number;
  results: { email: string; provider: string; result?: SyncResult; error?: string }[];
  /** A whole-user failure, outside any single mailbox — no provider to blame. */
  error?: string;
}

export interface SyncDeps {
  db: Database;
  masterKey: Buffer;
  userId: string;
  configs: ProviderConfigs;
  transport?: HttpTransport;
  makeSource?: SourceFactory; // injectable for tests
  /** Called with each round's observed status changes (push-notification feed).
   *  Never invoked for backfill rounds — a first sync would "transition" every
   *  record at once and flood the phone. */
  onTransitions?: (userId: string, transitions: StatusTransition[]) => void | Promise<void>;
  /** Operator log. Isolating a per-user failure keeps the tick alive, but a
   *  swallowed error nobody can see is its own bug — this is how it surfaces. */
  log?: (msg: string) => void;
}

export async function syncAllConnections(deps: SyncDeps): Promise<SyncSummary> {
  const makeSource = deps.makeSource ?? defaultSourceFactory;
  const conns = await getMailConnections(deps.db, deps.userId);
  const results: SyncSummary["results"] = [];

  for (const c of conns) {
    if (c.provider !== "google" && c.provider !== "microsoft") continue; // IMAP isn't OAuth-synced here
    const provider: ProviderId = c.provider;
    try {
      const conf = deps.configs[provider];
      if (!conf) {
        results.push({ email: c.email, provider, error: "provider not configured" });
        continue;
      }
      const secret = await getMailConnectionSecret<OAuthTokens>(deps.db, deps.masterKey, c.id);
      if (!secret) {
        results.push({ email: c.email, provider, error: "missing secret" });
        continue;
      }
      const token = await validAccessToken(provider, conf, secret, {
        transport: deps.transport,
        onRefresh: (nt) => updateMailConnectionSecret(deps.db, deps.masterKey, c.id, nt),
      });
      if (!token) {
        results.push({ email: c.email, provider, error: "reauth required" });
        continue;
      }
      const source = makeSource(provider, token, deps.transport);
      const result = await runSync(deps.db, { userId: deps.userId, connectionId: c.id, source });
      results.push({ email: c.email, provider, result });
      if (deps.onTransitions && !result.backfill && result.transitions.length) {
        try {
          await deps.onTransitions(deps.userId, result.transitions);
        } catch {
          // A notification failure must never fail (or retry) the sync itself —
          // the board is already updated; the in-app list backstops missed pushes.
        }
      }
    } catch (e) {
      results.push({ email: c.email, provider, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Once a real mailbox has SYNCED, drop the seeded demo applications so the
  // board reflects the user's actual mail (idempotent — a no-op after the first).
  // Deliberately after the loop: a failed first sync must not leave the user
  // staring at an empty board with no data and no visible error.
  if (results.some((r) => r.result)) {
    await deleteDemoApplications(deps.db, deps.userId);
  }
  return { connections: conns.length, results };
}

/** Sync every user that has a connected mailbox (used by the background scheduler). */
export async function syncAllUsers(deps: Omit<SyncDeps, "userId">): Promise<{ users: number; summaries: SyncSummary[] }> {
  const userIds = await listUserIdsWithConnections(deps.db);
  const summaries: SyncSummary[] = [];
  for (const userId of userIds) {
    // Per-user isolation: syncAllConnections already guards each mailbox, but a
    // failure OUTSIDE that loop (connection lookup, the demo-data cleanup) would
    // otherwise abort every remaining user's sync for this tick. It is LOGGED,
    // not just captured — the scheduler doesn't read summaries, so a user
    // failing every tick would otherwise be completely silent.
    try {
      summaries.push(await syncAllConnections({ ...deps, userId }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.log?.(`sync: user ${userId} failed outside any mailbox — ${error}`);
      // No provider is attributable here (the failure is outside the provider
      // loop), so the summary says so rather than naming an innocent one.
      summaries.push({ connections: 0, results: [], error });
    }
  }
  return { users: userIds.length, summaries };
}
