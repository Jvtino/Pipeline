// Repository — the only place app code touches the tables. Encrypts mail secrets
// on write, decrypts on read, and enforces per-user scoping on every query.
import { and, asc, eq, like, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { encryptJson, decryptJson } from "@pipeline/crypto";
import {
  boardFromApplications,
  type Application,
  type AttachmentMeta,
  type Board,
  type ClassificationAudit,
  type ClassificationEvent,
  type Enrichment,
  type Message,
  type Status,
  type Thread,
} from "@pipeline/contracts";
import type { Database } from "./client";
import { users, mailConnections, applications, applicationEvents, applicationMessages, syncState, notes, contacts, devices, pushLog } from "./schema";

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

/** All user ids that have at least one connected mailbox (for the sync scheduler). */
export async function listUserIdsWithConnections(db: Database): Promise<string[]> {
  const rows = await db.select({ userId: mailConnections.userId }).from(mailConnections);
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Delete a mailbox connection (scoped to its owner) — the real "Disconnect".
 * Cascades to sync_state via FK, so the cursor goes with it; the envelope-encrypted
 * secret row is gone and background sync no longer sees the mailbox. Returns
 * whether a row was actually removed.
 */
export async function deleteMailConnection(db: Database, userId: string, connectionId: string): Promise<boolean> {
  const rows = await db
    .delete(mailConnections)
    .where(and(eq(mailConnections.id, connectionId), eq(mailConnections.userId, userId)))
    .returning({ id: mailConnections.id });
  return rows.length > 0;
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

/** One classified-status change observed by an upsert batch — the raw material
 *  for push notifications. `overridden` flags records the user has manually
 *  corrected (their word outranks the classifier, so notifiers should skip). */
export interface StatusTransition {
  threadId: string;
  company: string;
  role: string;
  from?: Status;
  to: Status;
  isNew: boolean;
  overridden: boolean;
}

/** Idempotently upsert derived applications for a user (current status overwrites).
 *  Status TRANSITIONS are recorded as application_events rows (the real per-stage
 *  timeline): one event when a row first appears, one whenever its status changes.
 *  Returns the batch's transitions (additive — existing callers ignore it). */
export async function upsertApplications(
  db: Database,
  userId: string,
  apps: Application[],
  opts: { eventSource?: string } = {},
): Promise<StatusTransition[]> {
  // Previous statuses, read once — the transition detector for the whole batch.
  const existing = await db
    .select({ threadId: applications.threadId, status: applications.status, overrideStatus: applications.overrideStatus })
    .from(applications)
    .where(eq(applications.userId, userId));
  const prev = new Map(existing.map((r) => [r.threadId, r.status as Status]));
  const overridden = new Set(existing.filter((r) => r.overrideStatus != null).map((r) => r.threadId));
  const transitions: StatusTransition[] = [];
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
      confidence: a.confidence ?? null,
      enrichment: a.enrichment ? JSON.stringify(a.enrichment) : null,
      classification: a.classification ? JSON.stringify(a.classification) : null,
      classificationEvents: a.classificationEvents ? JSON.stringify(a.classificationEvents) : null,
      platformFallback: a.platformFallback ?? null,
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
          confidence: a.confidence ?? null,
          enrichment: a.enrichment ? JSON.stringify(a.enrichment) : null,
          classification: a.classification ? JSON.stringify(a.classification) : null,
          classificationEvents: a.classificationEvents ? JSON.stringify(a.classificationEvents) : null,
          platformFallback: a.platformFallback ?? null,
          updatedAt: new Date(),
        },
      });
    // After the row exists (FK target): record the transition, if any.
    const was = prev.get(a.threadId);
    if (was !== a.status) {
      await db.insert(applicationEvents).values({
        id: randomUUID(),
        applicationId: id,
        status: a.status,
        // occurred_at: the activity that carried the change (first sight uses firstSeen).
        occurredAt: (was === undefined ? a.firstSeen : a.lastActivity) || a.lastActivity || a.firstSeen,
        source: opts.eventSource ?? "sync",
      });
      transitions.push({
        threadId: a.threadId,
        company: a.company,
        role: a.role,
        from: was,
        to: a.status,
        isNew: was === undefined,
        overridden: overridden.has(a.threadId),
      });
    }
  }
  return transitions;
}

export interface StatusEventRow {
  status: Status;
  occurredAt: string;
  source: string;
}

/** The recorded status timeline for one application, oldest first (user-scoped via join). */
export async function listStatusEvents(db: Database, userId: string, threadId: string): Promise<StatusEventRow[]> {
  const rows = await db
    .select({ status: applicationEvents.status, occurredAt: applicationEvents.occurredAt, source: applicationEvents.source })
    .from(applicationEvents)
    .innerJoin(applications, eq(applicationEvents.applicationId, applications.id))
    .where(and(eq(applications.userId, userId), eq(applications.threadId, threadId)))
    .orderBy(asc(applicationEvents.occurredAt));
  return rows.map((r) => ({ status: r.status as Status, occurredAt: r.occurredAt, source: r.source }));
}

/** Row → contract mapper. The user's sticky override, when set, IS the status
 *  everywhere downstream (board, analytics, export) — the classifier's word only
 *  shows through where no correction exists. */
function rowToApplication(r: typeof applications.$inferSelect): Application {
  return {
    id: r.id,
    threadId: r.threadId,
    company: r.company,
    companyDomain: r.companyDomain,
    role: r.role,
    status: (r.overrideStatus ?? r.status) as Status,
    firstSeen: r.firstSeen,
    lastActivity: r.lastActivity,
    snippet: r.snippet,
    manual: r.manual,
    confidence: r.confidence ?? undefined,
    enrichment: r.enrichment ? (JSON.parse(r.enrichment) as Enrichment) : undefined,
    classification: r.classification ? (JSON.parse(r.classification) as ClassificationAudit) : undefined,
    classificationEvents: r.classificationEvents ? (JSON.parse(r.classificationEvents) as ClassificationEvent[]) : undefined,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : undefined,
    platformFallback: r.platformFallback ?? undefined,
  };
}

export async function getApplicationsForUser(db: Database, userId: string): Promise<Application[]> {
  const rows = await db.select().from(applications).where(eq(applications.userId, userId));
  return rows.map(rowToApplication);
}

/** One application by thread id, user-scoped (override coalesced like the board read). */
export async function getApplicationForUser(db: Database, userId: string, threadId: string): Promise<Application | null> {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.threadId, threadId)));
  return rows[0] ? rowToApplication(rows[0]) : null;
}

/** The board read for a user, grouped identically to the live-mail path. */
export async function getBoardForUser(db: Database, userId: string, source: string): Promise<Board> {
  return boardFromApplications(await getApplicationsForUser(db, userId), source);
}

/** Confirm an application exists and belongs to the user (ownership gate for notes/contacts). */
export async function applicationBelongsTo(db: Database, userId: string, applicationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  return rows.length > 0;
}

// ── Notes (Pro) ──────────────────────────────────────────────────────────────
export interface NoteRow {
  id: string;
  applicationId: string;
  body: string;
  createdAt: Date;
}

export async function addNote(db: Database, p: { userId: string; applicationId: string; body: string }): Promise<NoteRow> {
  const id = randomUUID();
  const rows = await db
    .insert(notes)
    .values({ id, userId: p.userId, applicationId: p.applicationId, body: p.body })
    .returning({ id: notes.id, applicationId: notes.applicationId, body: notes.body, createdAt: notes.createdAt });
  return rows[0]!;
}

export async function listNotes(db: Database, userId: string, applicationId: string): Promise<NoteRow[]> {
  return db
    .select({ id: notes.id, applicationId: notes.applicationId, body: notes.body, createdAt: notes.createdAt })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.applicationId, applicationId)));
}

// ── Contacts (Pro) ───────────────────────────────────────────────────────────
export interface ContactRow {
  id: string;
  applicationId: string;
  name: string;
  email: string | null;
  role: string | null;
  createdAt: Date;
}

export async function addContact(
  db: Database,
  p: { userId: string; applicationId: string; name: string; email?: string | null; role?: string | null },
): Promise<ContactRow> {
  const id = randomUUID();
  const rows = await db
    .insert(contacts)
    .values({ id, userId: p.userId, applicationId: p.applicationId, name: p.name, email: p.email ?? null, role: p.role ?? null })
    .returning({
      id: contacts.id,
      applicationId: contacts.applicationId,
      name: contacts.name,
      email: contacts.email,
      role: contacts.role,
      createdAt: contacts.createdAt,
    });
  return rows[0]!;
}

export async function listContacts(db: Database, userId: string, applicationId: string): Promise<ContactRow[]> {
  return db
    .select({
      id: contacts.id,
      applicationId: contacts.applicationId,
      name: contacts.name,
      email: contacts.email,
      role: contacts.role,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.applicationId, applicationId)));
}

// ── Per-message previews (Email tab) ─────────────────────────────────────────
// Same privacy budget as applications.snippet: a <=600-char preview + attachment
// METADATA — never the raw email or file content.

export interface ThreadMessageRow {
  threadId: string;
  date: string;
  from: string;
  bodyPreview: string;
  attachments: AttachmentMeta[] | null;
  webLink: string | null;
}

/** Stable per-message key: the provider id, else a content hash (id-less messages stay idempotent). */
function msgKey(m: Message): string {
  return m.id ?? createHash("sha256").update(`${m.date}|${m.from}|${m.body}`).digest("hex").slice(0, 16);
}

/**
 * Idempotently upsert per-message previews for threads whose application row
 * exists (the sync engine writes applications first). Append-only per message —
 * a later re-search window must never delete messages stored by earlier rounds;
 * a re-fetch that adds attachment metadata enriches the stored row.
 */
export async function upsertThreadMessages(db: Database, userId: string, threads: Thread[]): Promise<void> {
  for (const t of threads) {
    const applicationId = `${userId}:${t.threadId}`;
    for (const m of t.messages) {
      const id = `${applicationId}:${msgKey(m)}`;
      const attachments = m.attachments?.length ? JSON.stringify(m.attachments) : null;
      const bodyPreview = m.body.slice(0, 600);
      const webLink = m.webLink ?? null;
      await db
        .insert(applicationMessages)
        .values({ id, userId, applicationId, threadId: t.threadId, date: m.date, fromAddr: m.from, bodyPreview, attachments, webLink })
        .onConflictDoUpdate({
          target: applicationMessages.id,
          set: { bodyPreview, ...(attachments ? { attachments } : {}), ...(webLink ? { webLink } : {}) },
        });
    }
  }
}

export async function listThreadMessages(db: Database, userId: string, threadId: string): Promise<ThreadMessageRow[]> {
  const rows = await db
    .select()
    .from(applicationMessages)
    .where(and(eq(applicationMessages.userId, userId), eq(applicationMessages.threadId, threadId)))
    .orderBy(asc(applicationMessages.date), asc(applicationMessages.createdAt));
  return rows.map((r) => ({
    threadId: r.threadId,
    date: r.date,
    from: r.fromAddr,
    bodyPreview: r.bodyPreview,
    attachments: r.attachments ? (JSON.parse(r.attachments) as AttachmentMeta[]) : null,
    webLink: r.webLink ?? null,
  }));
}

export interface UserAttachmentRow {
  threadId: string;
  company: string;
  role: string;
  date: string;
  name: string;
  contentType: string | null;
  size: number | null;
}

/** Every synced attachment (metadata only) across the user's applications, newest first. */
export async function listUserAttachments(db: Database, userId: string): Promise<UserAttachmentRow[]> {
  const rows = await db
    .select({
      threadId: applicationMessages.threadId,
      date: applicationMessages.date,
      attachments: applicationMessages.attachments,
      company: applications.company,
      role: applications.role,
    })
    .from(applicationMessages)
    .innerJoin(applications, eq(applicationMessages.applicationId, applications.id))
    .where(and(eq(applicationMessages.userId, userId), isNotNull(applicationMessages.attachments)));
  const out: UserAttachmentRow[] = [];
  for (const r of rows) {
    for (const a of JSON.parse(r.attachments!) as AttachmentMeta[]) {
      out.push({
        threadId: r.threadId,
        company: r.company,
        role: r.role,
        date: r.date,
        name: a.name,
        contentType: a.contentType ?? null,
        size: a.size ?? null,
      });
    }
  }
  out.sort((x, y) => y.date.localeCompare(x.date));
  return out;
}

/** Count a user's applications (cheap existence/empty check). */
export async function countApplications(db: Database, userId: string): Promise<number> {
  return (await getApplicationsForUser(db, userId)).length;
}

/**
 * Remove the seeded demo applications for a user. Called once the user connects a
 * real mailbox, so their actual synced applications replace the sample board
 * (demo threadIds are prefixed "demo:"). Manual/synced records are untouched.
 */
export async function deleteDemoApplications(db: Database, userId: string): Promise<void> {
  await db.delete(applications).where(and(eq(applications.userId, userId), like(applications.threadId, "demo:%")));
}

/**
 * Rebuild recovery: purge a user's AUTO-SYNCED applications and reset their sync
 * cursors so the NEXT sync re-backfills the board through the current relevance
 * gate. Used to recover after a bad sync floods the board with non-application
 * mail — the derived record alone can't be re-classified (we don't persist the raw
 * thread), so the safe fix is to clear + re-derive from the mailbox.
 *
 * Deliberately preserved: manual entries (added by hand, never came from a sync),
 * any application the user has ANNOTATED with notes/contacts — deleting those
 * would cascade-delete that work — and any thread id in `keepThreadIds` (the web
 * app's client-side overlay keeps its notes/stage-moves/tracking fields in the
 * browser, so the server can't see those annotations; the client sends the ids).
 * Re-synced applications return with the same `${userId}:${threadId}` id, so
 * annotations stay attached.
 */
export async function rebuildSyncedApplications(
  db: Database,
  userId: string,
  keepThreadIds: string[] = [],
): Promise<{ removed: number }> {
  const annotated = new Set<string>([
    ...(await db.select({ id: notes.applicationId }).from(notes).where(eq(notes.userId, userId))).map((r) => r.id),
    ...(await db.select({ id: contacts.applicationId }).from(contacts).where(eq(contacts.userId, userId))).map((r) => r.id),
    // Status overrides and review resolutions are user work exactly like notes:
    // deleting the row would cascade its timeline and silently revert the user's
    // correction to whatever the re-derive classifies. Keep those rows too — a
    // re-synced thread upserts onto the same id, so the correction stays applied.
    ...(
      await db
        .select({ id: applications.id })
        .from(applications)
        .where(and(eq(applications.userId, userId), or(isNotNull(applications.overrideStatus), isNotNull(applications.reviewedAt))))
    ).map((r) => r.id),
    ...keepThreadIds.map((t) => `${userId}:${t}`),
  ]);
  const synced = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.manual, false)));
  const removable = synced.map((r) => r.id).filter((id) => !annotated.has(id));
  if (removable.length) await db.delete(applications).where(inArray(applications.id, removable));

  // Null every cursor for the user's connections → next sync is a full backfill,
  // not a no-op delta, so real applications are re-derived and re-listed.
  const conns = await db.select({ id: mailConnections.id }).from(mailConnections).where(eq(mailConnections.userId, userId));
  for (const c of conns) {
    await db.update(syncState).set({ cursor: null, lastSyncedAt: null }).where(eq(syncState.connectionId, c.id));
  }
  return { removed: removable.length };
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

// ── Status override + review queue (mobile writes) ───────────────────────────

/**
 * Sticky user correction of an application's status. Sync upserts never write
 * override_status, so the correction survives every re-classification. Records a
 * `source:'user'` timeline event and returns the updated record (coalesced), or
 * null when no such application belongs to the user.
 */
export async function setStatusOverride(db: Database, userId: string, threadId: string, status: Status): Promise<Application | null> {
  // Coalesced status BEFORE the write: a retry/double-tap of the same status must
  // not add a duplicate timeline event (the analytics funnel counts events).
  const before = await getApplicationForUser(db, userId, threadId);
  if (!before) return null;
  // The override is stored even when it matches the current classifier status —
  // that's a PIN, protecting the record against future classifier drift. A user
  // correcting a status has also definitionally reviewed it, so the row leaves
  // the review queue too.
  await db
    .update(applications)
    .set({ overrideStatus: status, overrideAt: new Date(), reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(applications.userId, userId), eq(applications.threadId, threadId)));
  if (before.status !== status) {
    await db.insert(applicationEvents).values({
      id: randomUUID(),
      applicationId: `${userId}:${threadId}`,
      status,
      occurredAt: new Date().toISOString(),
      source: "user",
    });
  }
  return getApplicationForUser(db, userId, threadId);
}

/** Confidence floor below which an unreviewed record joins the review queue,
 *  even when the classifier didn't flag it outright. */
const REVIEW_CONFIDENCE_FLOOR = 0.5;

/**
 * Applications awaiting human review: synced records the classifier flagged
 * (`requiresManualReview`) or scored under the confidence floor, not yet
 * resolved by the user (`reviewed_at IS NULL`). Filtered in code — the audit
 * lives in a JSON text column and boards are small at v1 scale.
 */
export async function listReviewQueue(db: Database, userId: string): Promise<Application[]> {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.manual, false), isNull(applications.reviewedAt)));
  return rows
    .filter((r) => {
      const audit = r.classification ? (JSON.parse(r.classification) as ClassificationAudit) : null;
      if (audit?.requiresManualReview) return true;
      return r.confidence != null && r.confidence < REVIEW_CONFIDENCE_FLOOR;
    })
    .map(rowToApplication);
}

/** Resolve a record's review-queue membership. Returns false when the user owns no such record. */
export async function markReviewed(db: Database, userId: string, threadId: string): Promise<boolean> {
  const rows = await db
    .update(applications)
    .set({ reviewedAt: new Date() })
    .where(and(eq(applications.userId, userId), eq(applications.threadId, threadId)))
    .returning({ id: applications.id });
  return rows.length > 0;
}

// ── Devices (push registration) ──────────────────────────────────────────────

export interface DeviceRow {
  id: string;
  platform: "ios" | "android" | "web";
  expoPushToken: string;
  deviceName: string | null;
  notifyStatusChanges: boolean;
  notifyReminders: boolean;
  disabled: boolean;
}

const deviceColumns = {
  id: devices.id,
  platform: devices.platform,
  expoPushToken: devices.expoPushToken,
  deviceName: devices.deviceName,
  notifyStatusChanges: devices.notifyStatusChanges,
  notifyReminders: devices.notifyReminders,
  disabled: devices.disabled,
};

/** Register a push token. One row per token: re-registration moves the token to
 *  the signing-in user (phones change hands between accounts) and re-enables it. */
export async function upsertDevice(
  db: Database,
  p: { userId: string; platform: "ios" | "android" | "web"; expoPushToken: string; deviceName?: string | null },
): Promise<DeviceRow> {
  const rows = await db
    .insert(devices)
    .values({
      id: randomUUID(),
      userId: p.userId,
      platform: p.platform,
      expoPushToken: p.expoPushToken,
      deviceName: p.deviceName ?? null,
    })
    .onConflictDoUpdate({
      target: devices.expoPushToken,
      set: {
        userId: p.userId,
        platform: p.platform,
        deviceName: p.deviceName ?? null,
        disabled: false,
        // A re-registration is a fresh registration: prefs reset to the schema
        // defaults rather than leaking the previous owner's choices.
        notifyStatusChanges: true,
        notifyReminders: true,
        lastSeenAt: new Date(),
      },
    })
    .returning(deviceColumns);
  return rows[0]!;
}

export async function listDevices(db: Database, userId: string): Promise<DeviceRow[]> {
  return db.select(deviceColumns).from(devices).where(eq(devices.userId, userId));
}

/** Active (enabled) devices for a user — the push send list. */
export async function listActiveDevices(db: Database, userId: string): Promise<DeviceRow[]> {
  return db
    .select(deviceColumns)
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.disabled, false)));
}

/** Update a device's notification preferences (user-scoped). Null when not the user's device. */
export async function updateDevice(
  db: Database,
  userId: string,
  deviceId: string,
  prefs: { notifyStatusChanges?: boolean; notifyReminders?: boolean },
): Promise<DeviceRow | null> {
  const set: Partial<{ notifyStatusChanges: boolean; notifyReminders: boolean; lastSeenAt: Date }> = { lastSeenAt: new Date() };
  if (prefs.notifyStatusChanges !== undefined) set.notifyStatusChanges = prefs.notifyStatusChanges;
  if (prefs.notifyReminders !== undefined) set.notifyReminders = prefs.notifyReminders;
  const rows = await db
    .update(devices)
    .set(set)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .returning(deviceColumns);
  return rows[0] ?? null;
}

/** Remove a device registration (sign-out cleanup). */
export async function deleteDevice(db: Database, userId: string, deviceId: string): Promise<boolean> {
  const rows = await db
    .delete(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .returning({ id: devices.id });
  return rows.length > 0;
}

/** Stop sending to a token the push provider reported dead (DeviceNotRegistered). */
export async function disableDeviceByToken(db: Database, expoPushToken: string): Promise<void> {
  await db.update(devices).set({ disabled: true }).where(eq(devices.expoPushToken, expoPushToken));
}

export interface EnrichedApplicationRow {
  userId: string;
  threadId: string;
  company: string;
  role: string;
  /** Coalesced current status (user override wins) — lets the reminder scan
   *  skip records the user closed out (rejected/cancelled). */
  status: string;
  enrichment: Enrichment;
}

/** Every application (all users) carrying extracted enrichment — the interview-
 *  reminder scan's input. Filtered in code; enrichment is a JSON text column
 *  and boards are small at v1 scale. */
export async function listApplicationsWithEnrichment(db: Database): Promise<EnrichedApplicationRow[]> {
  const rows = await db
    .select({
      userId: applications.userId,
      threadId: applications.threadId,
      company: applications.company,
      role: applications.role,
      status: applications.status,
      overrideStatus: applications.overrideStatus,
      enrichment: applications.enrichment,
    })
    .from(applications)
    .where(isNotNull(applications.enrichment));
  return rows.map((r) => ({
    userId: r.userId,
    threadId: r.threadId,
    company: r.company,
    role: r.role,
    status: r.overrideStatus ?? r.status,
    enrichment: JSON.parse(r.enrichment!) as Enrichment,
  }));
}

// ── Push send-once ledger ────────────────────────────────────────────────────

/**
 * Claim a notification's dedupe key. True → newly claimed, caller should send;
 * false → an earlier tick already sent this logical notification. The unique
 * index makes the claim atomic under concurrent sync ticks.
 */
export async function recordPushOnce(db: Database, p: { userId: string; kind: string; dedupeKey: string }): Promise<boolean> {
  const rows = await db
    .insert(pushLog)
    .values({ id: randomUUID(), userId: p.userId, kind: p.kind, dedupeKey: p.dedupeKey })
    .onConflictDoNothing({ target: pushLog.dedupeKey })
    .returning({ id: pushLog.id });
  return rows.length > 0;
}

// ── Account deletion ─────────────────────────────────────────────────────────

/**
 * Erase a user entirely. Every table hangs off users(id) with ON DELETE CASCADE
 * (directly or via applications), so one delete removes connections + secrets,
 * sync cursors, applications, events, messages, notes, contacts, devices, and
 * push log. Provider-side token revocation is the caller's job BEFORE this —
 * the encrypted secrets are unreadable afterwards.
 */
export async function deleteUser(db: Database, userId: string): Promise<boolean> {
  const rows = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return rows.length > 0;
}
