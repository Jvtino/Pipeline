import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { generateMasterKey } from "@pipeline/crypto";
import type { Application, Status } from "@pipeline/contracts";
import { createDb, type DbHandle } from "./client";
import { mailConnections } from "./schema";
import {
  upsertUser,
  saveMailConnection,
  getMailConnectionSecret,
  upsertApplications,
  getApplicationsForUser,
  getBoardForUser,
  applicationBelongsTo,
  addNote,
  listNotes,
  addContact,
  listContacts,
  rebuildSyncedApplications,
  deleteMailConnection,
  saveCursor,
  getCursor,
  upsertThreadMessages,
  listThreadMessages,
  listUserAttachments,
  listStatusEvents,
} from "./repo";

const masterKey = () => Buffer.from(generateMasterKey(), "base64");

function appFixture(threadId: string, company: string, status: Status): Application {
  return {
    id: "ignored",
    threadId,
    company,
    companyDomain: `${company.toLowerCase()}.com`,
    role: "Engineer",
    status,
    firstSeen: "2026-01-01",
    lastActivity: "2026-02-01",
    snippet: "snippet",
    manual: false,
  };
}

let h: DbHandle;
beforeEach(async () => {
  h = await createDb();
});
afterEach(async () => {
  await h.close();
});

describe("@pipeline/db", () => {
  it("applies migrations and stores a user", async () => {
    await upsertUser(h.db, { id: "u1", email: "a@b.com", plan: "pro" });
    // querying through the board path proves the schema is live
    expect((await getBoardForUser(h.db, "u1", "live")).counts.total).toBe(0);
  });

  it("stores mail-connection secrets ENCRYPTED at rest, decryptable only with the key", async () => {
    const mk = masterKey();
    await upsertUser(h.db, { id: "u1", email: "a@b.com" });
    const secret = { access_token: "PLAINTEXT_ACCESS", refresh_token: "PLAINTEXT_REFRESH", expires_in: 3600 };
    await saveMailConnection(h.db, mk, { id: "c1", userId: "u1", provider: "google", email: "a@gmail.com", secret });

    const rows = await h.db.select().from(mailConnections).where(eq(mailConnections.id, "c1"));
    const stored = rows[0]!.encryptedSecret;
    expect(stored).not.toContain("PLAINTEXT_ACCESS");
    expect(stored).not.toContain("PLAINTEXT_REFRESH");

    expect(await getMailConnectionSecret(h.db, mk, "c1")).toEqual(secret);
    // wrong key cannot read it
    await expect(getMailConnectionSecret(h.db, masterKey(), "c1")).rejects.toThrow();
  });

  it("isolates applications per user (row-level scoping)", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await upsertUser(h.db, { id: "u2", email: "u2@b.com" });
    await upsertApplications(h.db, "u1", [appFixture("t-acme", "Acme", "interview")]);
    await upsertApplications(h.db, "u2", [appFixture("t-globex", "Globex", "offer")]);

    const b1 = await getBoardForUser(h.db, "u1", "live");
    const b2 = await getBoardForUser(h.db, "u2", "live");
    expect(b1.counts.total).toBe(1);
    expect(b1.groups[0]!.company).toBe("Acme");
    expect(b2.groups[0]!.company).toBe("Globex");
    expect(b1.groups.some((g) => g.company === "Globex")).toBe(false);
  });

  it("upsert is idempotent on (user, thread) and reflects the latest status", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "offer")]);
    const apps = await getApplicationsForUser(h.db, "u1");
    expect(apps.length).toBe(1);
    expect(apps[0]!.status).toBe("offer");
  });

  it("round-trips the optional classifier confidence (absent → undefined)", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await upsertApplications(h.db, "u1", [
      { ...appFixture("t-low", "Acme", "interview"), confidence: 0.35 },
      appFixture("t-none", "Globex", "applied"), // no confidence set
    ]);
    const byThread = Object.fromEntries((await getApplicationsForUser(h.db, "u1")).map((a) => [a.threadId, a.confidence]));
    expect(byThread["t-low"]).toBeCloseTo(0.35);
    expect(byThread["t-none"]).toBeUndefined();
  });

  it("round-trips extracted enrichment as JSON (absent → undefined)", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    const enrichment = {
      interviewDateTime: "Tue, Jun 12 at 3pm PT",
      interviewLink: "https://calendly.com/acme/loop",
      compensation: "$150k–$180k",
      location: "Remote",
      recruiterName: "Jordan Lee",
      recruiterEmail: "jordan@acme.com",
    };
    await upsertApplications(h.db, "u1", [
      { ...appFixture("t-e", "Acme", "interview"), enrichment },
      appFixture("t-plain", "Globex", "applied"),
    ]);
    const byThread = Object.fromEntries((await getApplicationsForUser(h.db, "u1")).map((a) => [a.threadId, a.enrichment]));
    expect(byThread["t-e"]).toEqual(enrichment);
    expect(byThread["t-plain"]).toBeUndefined();
  });

  it("notes + contacts are scoped to (user, application)", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    const appId = "u1:t1";
    expect(await applicationBelongsTo(h.db, "u1", appId)).toBe(true);
    expect(await applicationBelongsTo(h.db, "u2", appId)).toBe(false);

    await addNote(h.db, { userId: "u1", applicationId: appId, body: "first note" });
    const notes = await listNotes(h.db, "u1", appId);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toBe("first note");
    // a different user sees none
    expect(await listNotes(h.db, "u2", appId)).toHaveLength(0);

    const contact = await addContact(h.db, { userId: "u1", applicationId: appId, name: "Jane", email: "jane@acme.com", role: "Recruiter" });
    expect(contact.name).toBe("Jane");
    expect(await listContacts(h.db, "u1", appId)).toHaveLength(1);
    expect(await listContacts(h.db, "u2", appId)).toHaveLength(0);
  });

  it("records status transitions as events: first sight, changes only, user-scoped", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    // First sight → one "applied" event stamped with firstSeen.
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    let ev = await listStatusEvents(h.db, "u1", "t1");
    expect(ev.map((e) => [e.status, e.occurredAt])).toEqual([["applied", "2026-01-01"]]);

    // Same status re-upserted (idempotent sync round) → no new event.
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    expect(await listStatusEvents(h.db, "u1", "t1")).toHaveLength(1);

    // Status advance → one new event stamped with lastActivity.
    const advanced = { ...appFixture("t1", "Acme", "interview"), lastActivity: "2026-02-15" };
    await upsertApplications(h.db, "u1", [advanced]);
    ev = await listStatusEvents(h.db, "u1", "t1");
    expect(ev.map((e) => [e.status, e.occurredAt])).toEqual([
      ["applied", "2026-01-01"],
      ["interview", "2026-02-15"],
    ]);
    expect(ev.every((e) => e.source === "sync")).toBe(true);

    // Another user can't read them.
    expect(await listStatusEvents(h.db, "u2", "t1")).toHaveLength(0);
  });

  it("per-message previews: idempotent upsert, ordered read, attachment enrichment, user scoping", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    const thread = {
      threadId: "t1",
      domain: "acme.com",
      subject: "Engineer",
      messages: [
        { id: "m2", date: "2026-02-01", from: "Recruiting <rec@acme.com>", body: "interview time?" },
        { id: "m1", date: "2026-01-01", from: "Careers <careers@acme.com>", body: "thanks for applying" },
        { date: "2026-01-15", from: "Careers <careers@acme.com>", body: "id-less legacy message" }, // hashed key
      ],
    };

    await upsertThreadMessages(h.db, "u1", [thread]);
    await upsertThreadMessages(h.db, "u1", [thread]); // idempotent — no duplicates
    let msgs = await listThreadMessages(h.db, "u1", "t1");
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m) => m.date)).toEqual(["2026-01-01", "2026-01-15", "2026-02-01"]); // date asc
    expect(msgs.every((m) => m.attachments === null)).toBe(true);

    // A re-fetch that adds attachment metadata enriches the stored row.
    thread.messages[0] = { ...thread.messages[0]!, attachments: [{ name: "JD.pdf", contentType: "application/pdf", size: 1234 }] } as never;
    await upsertThreadMessages(h.db, "u1", [thread]);
    msgs = await listThreadMessages(h.db, "u1", "t1");
    expect(msgs).toHaveLength(3);
    expect(msgs[2]!.attachments).toEqual([{ name: "JD.pdf", contentType: "application/pdf", size: 1234 }]);

    // The user-wide attachment list joins in company/role; other users see nothing.
    const docs = await listUserAttachments(h.db, "u1");
    expect(docs).toEqual([
      { threadId: "t1", company: "Acme", role: "Engineer", date: "2026-02-01", name: "JD.pdf", contentType: "application/pdf", size: 1234 },
    ]);
    expect(await listThreadMessages(h.db, "u2", "t1")).toHaveLength(0);
    expect(await listUserAttachments(h.db, "u2")).toHaveLength(0);
  });

  it("rebuild clears unannotated synced apps, keeps manual + annotated, and resets cursors", async () => {
    const mk = masterKey();
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await saveMailConnection(h.db, mk, { id: "c1", userId: "u1", provider: "microsoft", email: "u1@live.com", secret: { access_token: "x" } });
    await saveCursor(h.db, "c1", "delta-123");

    await upsertApplications(h.db, "u1", [
      appFixture("t-junk", "Netflix", "applied"), // synced noise → should be cleared
      appFixture("t-real", "Stripe", "interview"), // synced but annotated → kept
      { ...appFixture("t-manual", "Handadded", "offer"), manual: true }, // manual → kept
    ]);
    await addNote(h.db, { userId: "u1", applicationId: "u1:t-real", body: "phone screen went well" });

    const { removed } = await rebuildSyncedApplications(h.db, "u1");
    expect(removed).toBe(1); // only t-junk

    const left = (await getApplicationsForUser(h.db, "u1")).map((a) => a.threadId).sort();
    expect(left).toEqual(["t-manual", "t-real"]);
    expect(await listNotes(h.db, "u1", "u1:t-real")).toHaveLength(1); // annotation survived
    expect(await getCursor(h.db, "c1")).toBeNull(); // next sync is a full backfill
  });

  it("rebuild also keeps thread ids the client annotated in its local overlay", async () => {
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await upsertApplications(h.db, "u1", [
      appFixture("t-junk", "Netflix", "applied"), // no annotations anywhere → cleared
      appFixture("t-local", "Stripe", "interview"), // annotated only in the browser overlay → kept
    ]);
    const { removed } = await rebuildSyncedApplications(h.db, "u1", ["t-local"]);
    expect(removed).toBe(1);
    expect((await getApplicationsForUser(h.db, "u1")).map((a) => a.threadId)).toEqual(["t-local"]);
  });

  it("deleteMailConnection removes the mailbox (and its cursor) only for its owner", async () => {
    const mk = masterKey();
    await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
    await saveMailConnection(h.db, mk, { id: "c1", userId: "u1", provider: "google", email: "u1@gmail.com", secret: { access_token: "x" } });
    await saveCursor(h.db, "c1", "h1");

    expect(await deleteMailConnection(h.db, "someone-else", "c1")).toBe(false); // scoped: not theirs
    expect(await deleteMailConnection(h.db, "u1", "c1")).toBe(true);
    expect((await h.db.select().from(mailConnections).where(eq(mailConnections.id, "c1"))).length).toBe(0);
    expect(await getCursor(h.db, "c1")).toBeNull(); // sync_state cascaded away
  });
});
