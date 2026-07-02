// Thin client for the Pipeline API. Same-origin paths (the Vite dev server
// proxies /api and /auth to the Fastify API on :3001). It reads the board,
// triggers sync/rebuild, lists and disconnects mailboxes, and starts OAuth
// connect; everything else the UI needs is derived client-side.
import type { Board } from "@pipeline/contracts";
import type { Plan } from "./types";

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

/** Ensure a session exists (dev-login the stand-in user if not signed in). */
export async function ensureSession(): Promise<void> {
  const me = await fetch("/auth/me");
  if (me.status === 401) {
    await fetch("/auth/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@pipeline.local" }),
    });
  }
}

export async function getMe(): Promise<Plan> {
  const res = await getJson<{ user: Plan }>("/auth/me");
  return res.user;
}

export function getBoard(): Promise<Board> {
  return getJson<Board>("/api/applications");
}

/** Per-mailbox outcome of a sync round. `error` set means that mailbox did NOT sync. */
export interface SyncOutcome {
  email: string;
  provider: string;
  error?: string;
  result?: { cursor: string; fetched: number; relevant: number; upserted: number };
}

export interface SyncSummary {
  connections: number;
  results: SyncOutcome[];
}

/** Trigger an incremental sync of connected mailboxes. */
export function runSync(): Promise<SyncSummary> {
  return postJson<SyncSummary>("/api/sync");
}

/**
 * Rebuild the board from the connected mailboxes: clear auto-synced applications
 * (manual + annotated ones are kept — `keepThreadIds` carries the ids annotated
 * in the client-side overlay, which the server can't see), reset cursors, then
 * re-scan from scratch. `removed` is how many stale synced rows were cleared.
 */
export function resync(keepThreadIds: string[]): Promise<{ removed: number } & SyncSummary> {
  return postJson<{ removed: number } & SyncSummary>("/api/resync", { keepThreadIds });
}

export interface Mailbox {
  id: string;
  provider: string;
  email: string;
}

export interface Connections {
  count: number;
  mailboxes: Mailbox[];
}

/** Connected mailboxes (metadata only) — the header chip + the Settings list. */
export function getConnections(): Promise<Connections> {
  return getJson<Connections>("/api/connections");
}

/** Disconnect a mailbox for real: the server deletes the connection + its tokens. */
export async function deleteConnection(id: string): Promise<void> {
  const r = await fetch(`/api/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`/api/connections/${id} → ${r.status}`);
}

/** One stored message preview (Email tab): <=600 chars + attachment metadata, never the raw mail. */
export interface ThreadMessage {
  date: string;
  from: string;
  bodyPreview: string;
  attachments: { name: string; contentType?: string | null; size?: number | null }[];
}

/** A thread's stored message previews, oldest first. */
export function getMessages(threadId: string): Promise<{ messages: ThreadMessage[] }> {
  return getJson<{ messages: ThreadMessage[] }>(`/api/applications/${encodeURIComponent(threadId)}/messages`);
}

/** A synced attachment (METADATA only — name/type/size, no file content). */
export interface SyncedDoc {
  threadId: string;
  company: string;
  role: string;
  date: string;
  name: string;
  contentType: string | null;
  size: number | null;
}

/** Every synced attachment across the user's applications, newest first. */
export function getDocuments(): Promise<{ documents: SyncedDoc[] }> {
  return getJson<{ documents: SyncedDoc[] }>("/api/documents");
}
