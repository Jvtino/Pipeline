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
});
