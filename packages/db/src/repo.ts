// Repository — the only place app code touches the tables. Encrypts mail secrets
// on write, decrypts on read, and enforces per-user scoping on every query.
import { eq } from "drizzle-orm";
import { encryptJson, decryptJson } from "@pipeline/crypto";
import { boardFromApplications, type Application, type Board, type Status } from "@pipeline/contracts";
import type { Database } from "./client";
import { users, mailConnections, applications } from "./schema";

export type Plan = "free" | "pro" | "teams";
export type Provider = "google" | "microsoft" | "imap";

export async function upsertUser(db: Database, u: { id: string; email: string; plan?: Plan }): Promise<void> {
  await db
    .insert(users)
    .values({ id: u.id, email: u.email, plan: u.plan ?? "free" })
    .onConflictDoUpdate({ target: users.id, set: { email: u.email } });
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
