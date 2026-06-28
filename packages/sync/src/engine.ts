// The incremental-sync engine. Provider-agnostic: a MailSource yields changed
// threads since a cursor; the engine reduces them through the shared classifier
// and upserts derived records, then advances the cursor. This is O(changes), not
// O(mailbox) — the fix for the full-rescan path (plan §8). First sync (no cursor)
// does a backfill; every sync after is a delta.
import { threadsToApplications } from "@pipeline/classify";
import type { Thread } from "@pipeline/contracts";
import { upsertApplications, saveCursor, getCursor, type Database } from "@pipeline/db";

export interface FetchResult {
  threads: Thread[];
  cursor: string; // the NEXT cursor (Gmail historyId / Graph deltaLink)
}

export interface MailSource {
  /** Fetch changes since `cursor`. `cursor` undefined = first sync → backfill. */
  fetch(input: { cursor?: string }): Promise<FetchResult>;
}

export interface SyncResult {
  cursor: string;
  fetched: number; // threads returned by the source
  upserted: number; // derived records written
}

/** Run one sync round for a connection and persist the new cursor. */
export async function runSync(
  db: Database,
  params: { userId: string; connectionId: string; source: MailSource },
): Promise<SyncResult> {
  const prev = (await getCursor(db, params.connectionId)) ?? undefined;
  const { threads, cursor } = await params.source.fetch({ cursor: prev });
  const apps = threadsToApplications(threads);
  if (apps.length) await upsertApplications(db, params.userId, apps);
  await saveCursor(db, params.connectionId, cursor);
  return { cursor, fetched: threads.length, upserted: apps.length };
}
