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
  type Database,
} from "@pipeline/db";
import type { ProviderConfigs } from "./config";

export type SourceFactory = (provider: ProviderId, token: string, transport?: HttpTransport) => MailSource;

const defaultSourceFactory: SourceFactory = (p, token, transport) =>
  p === "google" ? gmailSource(token, transport) : graphSource(token, transport);

export interface SyncSummary {
  connections: number;
  results: { email: string; provider: string; result?: SyncResult; error?: string }[];
}

export interface SyncDeps {
  db: Database;
  masterKey: Buffer;
  userId: string;
  configs: ProviderConfigs;
  transport?: HttpTransport;
  makeSource?: SourceFactory; // injectable for tests
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
    } catch (e) {
      results.push({ email: c.email, provider, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { connections: conns.length, results };
}

/** Sync every user that has a connected mailbox (used by the background scheduler). */
export async function syncAllUsers(deps: Omit<SyncDeps, "userId">): Promise<{ users: number; summaries: SyncSummary[] }> {
  const userIds = await listUserIdsWithConnections(deps.db);
  const summaries: SyncSummary[] = [];
  for (const userId of userIds) {
    summaries.push(await syncAllConnections({ ...deps, userId }));
  }
  return { users: userIds.length, summaries };
}
