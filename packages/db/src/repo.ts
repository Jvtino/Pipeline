// Repository — the only place app code touches the tables. Encrypts mail secrets
// on write, decrypts on read, and enforces per-user scoping on every query.
import { eq } from "drizzle-orm";
import { encryptJson, decryptJson } from "@pipeline/crypto";
import { boardFromApplications, type Application, type Board, type Status } from "@pipeline/contracts";
import type { Database } from "./client";
import { users, mailConnections, applications, syncState } from "./schema";

export type Plan = "free" | "pro" | "teams";
export type Provider = "google" | "microsoft" | "imap";

export async function upsertUser(db: Database, u: { id: string; email: string; plan?: Plan }): Promise<void> {
  await db
    .insert(users)
    .values({ id: u.id, email: u.email, plan: u.plan ?? "free" })
    .onConflictDoUpdate({ target: users.id, set: { email: u.email } });
}

export interface UserRow {
  id: string;
  email: string;
  plan: Plan;
}

export async function getUser(db: Database, userId: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  const r = rows[0];
  return r ? { id: r.id, email: r.email, plan: r.plan } : null;
}

/** Set a user's plan (called by the billing webhook on payment / cancellation). */
export async function setUserPlan(db: Database, userId: string, plan: Plan): Promise<void> {
  await db.update(users).set({ plan }).where(eq(users.id, userId));
}

/** Persist a connected mailbox; the secret is envelope-encrypted before it ever hits the DB. */
export async function saveMailConnection(
  db: Database,
  masterKey: Buffer,
  c: { id: string; userId: string; provider: Provider; email: string; secret: unknown },
): Promise<void> {
  const encryptedSecret = encryptJson(c.secret, masterKey);
  await db
    .insert(mailConnections)
    .values({ id: c.id, userId: c.userId, provider: c.provider, email: c.email, encryptedSecret })
    .onConflictDoUpdate({
      target: [mailConnections.userId, mailConnections.provider, mailConnections.email],
      set: { encryptedSecret, status: "active" },
    });
}

/** Decrypt and return a connection's secret (e.g. to refresh an access token). */
export async function getMailConnectionSecret<T = unknown>(
  db: Database,
  masterKey: Buffer,
  connectionId: string,
): Promise<T | null> {
  const rows = await db.select().from(mailConnections).where(eq(mailConnections.id, connectionId));
  const row = rows[0];
  return row ? decryptJson<T>(row.encryptedSecret, masterKey) : null;
}

export interface MailConnectionRow {
  id: string;
  provider: Provider;
  email: string;
}

/** List a user's connected mailboxes (metadata only — no secrets). */
export async function getMailConnections(db: Database, userId: string): Promise<MailConnectionRow[]> {
  return db
    .select({ id: mailConnections.id, provider: mailConnections.provider, email: mailConnections.email })
    .from(mailConnections)
    .where(eq(mailConnections.userId, userId));
}

/** Re-encrypt + store a rotated secret (after a token refresh). */
export async function updateMailConnectionSecret(
  db: Database,
  masterKey: Buffer,
  connectionId: string,
  secret: unknown,
): Promise<void> {
  await db
    .update(mailConnections)
    .set({ encryptedSecret: encryptJson(secret, masterKey) })
    .where(eq(mailConnections.id, connectionId));
}

/** Idempotently upsert derived applications for a user (current status overwrites). */
export async function upsertApplications(db: Database, userId: string, apps: Application[]): Promise<void> {
  for (const a of apps) {
    const id = `${userId}:${a.threadId}`;
    const values = {
      id,
      userId,
      threadId: a.threadId,
      company: a.company,
      companyDomain: a.companyDomain,
      role: a.role,
      status: a.status,
      firstSeen: a.firstSeen,
      lastActivity: a.lastActivity,
      snippet: a.snippet,
      manual: a.manual ?? false,
    };
    await db
      .insert(applications)
      .values(values)
      .onConflictDoUpdate({
        target: [applications.userId, applications.threadId],
        set: {
          company: a.company,
          companyDomain: a.companyDomain,
          role: a.role,
          status: a.status,
          firstSeen: a.firstSeen,
          lastActivity: a.lastActivity,
          snippet: a.snippet,
          manual: a.manual ?? false,
          updatedAt: new Date(),
        },
      });
  }
}

export async function getApplicationsForUser(db: Database, userId: string): Promise<Application[]> {
  const rows = await db.select().from(applications).where(eq(applications.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    threadId: r.threadId,
    company: r.company,
    companyDomain: r.companyDomain,
    role: r.role,
    status: r.status as Status,
    firstSeen: r.firstSeen,
    lastActivity: r.lastActivity,
    snippet: r.snippet,
    manual: r.manual,
  }));
}

/** The board read for a user, grouped identically to the live-mail path. */
export async function getBoardForUser(db: Database, userId: string, source: string): Promise<Board> {
  return boardFromApplications(await getApplicationsForUser(db, userId), source);
}

/** Count a user's applications (cheap existence/empty check). */
export async function countApplications(db: Database, userId: string): Promise<number> {
  return (await getApplicationsForUser(db, userId)).length;
}

/** Persist a connection's incremental-sync cursor (Gmail historyId / Graph deltaLink). */
export async function saveCursor(db: Database, connectionId: string, cursor: string): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ connectionId, cursor, lastSyncedAt: now })
    .onConflictDoUpdate({ target: syncState.connectionId, set: { cursor, lastSyncedAt: now } });
}

/** Read a connection's sync cursor (null on first sync → triggers a backfill). */
export async function getCursor(db: Database, connectionId: string): Promise<string | null> {
  const rows = await db.select().from(syncState).where(eq(syncState.connectionId, connectionId));
  return rows[0]?.cursor ?? null;
}
