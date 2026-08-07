// Mobile-facing persistence: sticky status overrides, the review queue, device
// registration, the push send-once ledger, transition capture, and full-account
// erasure. Same PGlite harness as db.test.ts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { generateMasterKey } from "@pipeline/crypto";
import type { Application, ClassificationAudit, Status } from "@pipeline/contracts";
import { createDb, type DbHandle } from "./client";
import { applications, devices as devicesTable, pushLog } from "./schema";
import {
  upsertUser,
  saveMailConnection,
  upsertApplications,
  getApplicationsForUser,
  getApplicationForUser,
  setStatusOverride,
  listReviewQueue,
  markReviewed,
  listStatusEvents,
  rebuildSyncedApplications,
  upsertDevice,
  listDevices,
  listActiveDevices,
  updateDevice,
  deleteDevice,
  disableDeviceByToken,
  recordPushOnce,
  deleteUser,
  addNote,
} from "./repo";

const masterKey = () => Buffer.from(generateMasterKey(), "base64");

function appFixture(threadId: string, company: string, status: Status, extra: Partial<Application> = {}): Application {
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
    ...extra,
  };
}

const flaggedAudit: ClassificationAudit = {
  eventType: "applied",
  confidence: 0.35,
  evidence: ["thanks for applying"],
  negativeEvidence: [],
  requiresManualReview: true,
  reason: "low-signal subject",
};

let h: DbHandle;
beforeEach(async () => {
  h = await createDb();
  await upsertUser(h.db, { id: "u1", email: "u1@b.com" });
  await upsertUser(h.db, { id: "u2", email: "u2@b.com" });
});
afterEach(async () => {
  await h.close();
});

describe("status overrides", () => {
  it("override wins on every read and survives a sync re-upsert", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    const updated = await setStatusOverride(h.db, "u1", "t1", "interview");
    expect(updated?.status).toBe("interview");

    // sync re-classifies to rejected — the user's word still outranks it
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "rejected")]);
    expect((await getApplicationForUser(h.db, "u1", "t1"))?.status).toBe("interview");
    expect((await getApplicationsForUser(h.db, "u1"))[0]!.status).toBe("interview");

    // the raw column still tracks the classifier underneath
    const raw = await h.db.select().from(applications).where(eq(applications.threadId, "t1"));
    expect(raw[0]!.status).toBe("rejected");
    expect(raw[0]!.overrideStatus).toBe("interview");
  });

  it("records a source:'user' timeline event", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    await setStatusOverride(h.db, "u1", "t1", "offer");
    const events = await listStatusEvents(h.db, "u1", "t1");
    expect(events.map((e) => [e.status, e.source])).toEqual([
      ["applied", "sync"],
      ["offer", "user"],
    ]);
  });

  it("a retried/no-op override never duplicates timeline events (but still pins)", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    await setStatusOverride(h.db, "u1", "t1", "offer");
    await setStatusOverride(h.db, "u1", "t1", "offer"); // network-retry double tap
    expect((await listStatusEvents(h.db, "u1", "t1")).map((e) => e.source)).toEqual(["sync", "user"]);

    // pinning the CURRENT classifier status stores no event but still protects
    // the record against future classifier drift
    await upsertApplications(h.db, "u1", [appFixture("t2", "Globex", "interview")]);
    await setStatusOverride(h.db, "u1", "t2", "interview");
    expect((await listStatusEvents(h.db, "u1", "t2")).map((e) => e.source)).toEqual(["sync"]);
    await upsertApplications(h.db, "u1", [appFixture("t2", "Globex", "rejected")]);
    expect((await getApplicationForUser(h.db, "u1", "t2"))?.status).toBe("interview");
  });

  it("overriding a status also resolves the record's review-queue membership", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t-low", "Acme", "applied", { classification: flaggedAudit, confidence: 0.3 })]);
    expect((await listReviewQueue(h.db, "u1")).map((a) => a.threadId)).toEqual(["t-low"]);
    await setStatusOverride(h.db, "u1", "t-low", "interview");
    expect(await listReviewQueue(h.db, "u1")).toEqual([]);
  });

  it("a sync-driven status change reopens review; the user's override stays final", async () => {
    // confirmed low-confidence record: out of the queue…
    await upsertApplications(h.db, "u1", [appFixture("t-re", "Acme", "applied", { classification: flaggedAudit, confidence: 0.3 })]);
    await markReviewed(h.db, "u1", "t-re");
    expect(await listReviewQueue(h.db, "u1")).toEqual([]);
    // …until the classifier changes its mind on a later sync — new state, new question
    await upsertApplications(h.db, "u1", [appFixture("t-re", "Acme", "interview", { classification: flaggedAudit, confidence: 0.3 })]);
    expect((await listReviewQueue(h.db, "u1")).map((a) => a.threadId)).toEqual(["t-re"]);

    // an OVERRIDDEN record never re-enters — the user's word outranks the classifier
    await upsertApplications(h.db, "u1", [appFixture("t-ov", "Globex", "applied", { classification: flaggedAudit, confidence: 0.3 })]);
    await setStatusOverride(h.db, "u1", "t-ov", "rejected");
    await upsertApplications(h.db, "u1", [appFixture("t-ov", "Globex", "interview", { classification: flaggedAudit, confidence: 0.3 })]);
    expect((await listReviewQueue(h.db, "u1")).map((a) => a.threadId)).toEqual(["t-re"]);
  });

  it("rebuild (resync recovery) preserves overridden and reviewed rows", async () => {
    await upsertApplications(h.db, "u1", [
      appFixture("t-corrected", "Acme", "rejected"),
      appFixture("t-reviewed", "Globex", "applied", { classification: flaggedAudit }),
      appFixture("t-plain", "Initech", "applied"),
    ]);
    await setStatusOverride(h.db, "u1", "t-corrected", "interview");
    await markReviewed(h.db, "u1", "t-reviewed");

    const { removed } = await rebuildSyncedApplications(h.db, "u1");
    expect(removed).toBe(1); // only the untouched synced row is cleared
    expect((await getApplicationForUser(h.db, "u1", "t-corrected"))?.status).toBe("interview");
    expect(await getApplicationForUser(h.db, "u1", "t-reviewed")).not.toBeNull();
    expect(await getApplicationForUser(h.db, "u1", "t-plain")).toBeNull();
  });

  it("is user-scoped: cannot override someone else's application", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    expect(await setStatusOverride(h.db, "u2", "t1", "offer")).toBeNull();
    expect((await getApplicationForUser(h.db, "u1", "t1"))?.status).toBe("applied");
  });
});

describe("review queue", () => {
  it("lists flagged and low-confidence records until reviewed", async () => {
    await upsertApplications(h.db, "u1", [
      appFixture("t-flagged", "Acme", "applied", { classification: flaggedAudit, confidence: 0.35 }),
      appFixture("t-lowconf", "Globex", "applied", { confidence: 0.2 }),
      appFixture("t-fine", "Initech", "applied", { confidence: 0.95 }),
    ]);
    let queue = await listReviewQueue(h.db, "u1");
    expect(queue.map((a) => a.threadId).sort()).toEqual(["t-flagged", "t-lowconf"]);

    expect(await markReviewed(h.db, "u1", "t-flagged")).toBe(true);
    queue = await listReviewQueue(h.db, "u1");
    expect(queue.map((a) => a.threadId)).toEqual(["t-lowconf"]);
  });

  it("excludes manual entries and other users' records; markReviewed is user-scoped", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t-manual", "Acme", "applied", { manual: true, confidence: 0.1 })]);
    await upsertApplications(h.db, "u2", [appFixture("t-other", "Globex", "applied", { classification: flaggedAudit })]);
    expect(await listReviewQueue(h.db, "u1")).toEqual([]);
    expect(await markReviewed(h.db, "u1", "t-other")).toBe(false);
    expect((await listReviewQueue(h.db, "u2")).map((a) => a.threadId)).toEqual(["t-other"]);
  });
});

describe("transition capture", () => {
  it("returns first-sight and change transitions, and nothing on a no-op upsert", async () => {
    const first = await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    expect(first).toEqual([
      { threadId: "t1", company: "Acme", role: "Engineer", from: undefined, to: "applied", isNew: true, overridden: false },
    ]);

    const noop = await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    expect(noop).toEqual([]);

    const change = await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "interview")]);
    expect(change).toEqual([
      { threadId: "t1", company: "Acme", role: "Engineer", from: "applied", to: "interview", isNew: false, overridden: false },
    ]);
  });

  it("marks transitions on user-overridden records so notifiers can skip them", async () => {
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    await setStatusOverride(h.db, "u1", "t1", "offer");
    const transitions = await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "rejected")]);
    expect(transitions).toEqual([
      { threadId: "t1", company: "Acme", role: "Engineer", from: "applied", to: "rejected", isNew: false, overridden: true },
    ]);
  });

  it("honors opts.eventSource for manual adds", async () => {
    await upsertApplications(h.db, "u1", [appFixture("manual:1", "Acme", "applied", { manual: true })], { eventSource: "user" });
    const events = await listStatusEvents(h.db, "u1", "manual:1");
    expect(events.map((e) => e.source)).toEqual(["user"]);
  });
});

describe("devices", () => {
  it("registers, re-registers to a new user, and scopes prefs/deletes to the owner", async () => {
    const d = await upsertDevice(h.db, { userId: "u1", platform: "ios", expoPushToken: "tok-1", deviceName: "iPhone" });
    expect(d.notifyStatusChanges).toBe(true);

    // same token signs in on another account → row moves, is re-enabled, and the
    // NEW owner starts from default prefs (not the previous owner's choices)
    await updateDevice(h.db, "u1", d.id, { notifyStatusChanges: false });
    await disableDeviceByToken(h.db, "tok-1");
    const moved = await upsertDevice(h.db, { userId: "u2", platform: "ios", expoPushToken: "tok-1" });
    expect(moved.id).toBe(d.id);
    expect(moved.disabled).toBe(false);
    expect(moved.notifyStatusChanges).toBe(true);
    expect(await listDevices(h.db, "u1")).toEqual([]);
    expect((await listDevices(h.db, "u2")).map((x) => x.expoPushToken)).toEqual(["tok-1"]);

    // prefs update is owner-scoped
    expect(await updateDevice(h.db, "u1", d.id, { notifyReminders: false })).toBeNull();
    const updated = await updateDevice(h.db, "u2", d.id, { notifyReminders: false });
    expect(updated?.notifyReminders).toBe(false);
    expect(updated?.notifyStatusChanges).toBe(true);

    expect(await deleteDevice(h.db, "u1", d.id)).toBe(false);
    expect(await deleteDevice(h.db, "u2", d.id)).toBe(true);
  });

  it("listActiveDevices excludes disabled tokens", async () => {
    await upsertDevice(h.db, { userId: "u1", platform: "android", expoPushToken: "tok-a" });
    await upsertDevice(h.db, { userId: "u1", platform: "ios", expoPushToken: "tok-b" });
    await disableDeviceByToken(h.db, "tok-a");
    expect((await listActiveDevices(h.db, "u1")).map((d) => d.expoPushToken)).toEqual(["tok-b"]);
  });
});

describe("push send-once ledger", () => {
  it("claims a dedupe key exactly once", async () => {
    expect(await recordPushOnce(h.db, { userId: "u1", kind: "transition", dedupeKey: "u1:t1:interview" })).toBe(true);
    expect(await recordPushOnce(h.db, { userId: "u1", kind: "transition", dedupeKey: "u1:t1:interview" })).toBe(false);
    expect(await recordPushOnce(h.db, { userId: "u1", kind: "transition", dedupeKey: "u1:t1:offer" })).toBe(true);
  });
});

describe("account deletion", () => {
  it("erases the user and cascades every owned row", async () => {
    const mk = masterKey();
    await saveMailConnection(h.db, mk, { id: "c1", userId: "u1", provider: "google", email: "a@gmail.com", secret: { t: 1 } });
    await upsertApplications(h.db, "u1", [appFixture("t1", "Acme", "applied")]);
    await addNote(h.db, { userId: "u1", applicationId: "u1:t1", body: "hello" });
    await upsertDevice(h.db, { userId: "u1", platform: "ios", expoPushToken: "tok-1" });
    await recordPushOnce(h.db, { userId: "u1", kind: "transition", dedupeKey: "u1:t1:applied" });
    // a bystander user to prove scoping
    await upsertApplications(h.db, "u2", [appFixture("t2", "Globex", "applied")]);

    expect(await deleteUser(h.db, "u1")).toBe(true);
    expect(await deleteUser(h.db, "u1")).toBe(false); // idempotent-ish: nothing left

    expect(await getApplicationsForUser(h.db, "u1")).toEqual([]);
    expect(await h.db.select().from(devicesTable)).toEqual([]);
    expect(await h.db.select().from(pushLog)).toEqual([]);
    // u2 untouched
    expect((await getApplicationsForUser(h.db, "u2")).map((a) => a.threadId)).toEqual(["t2"]);
  });
});
