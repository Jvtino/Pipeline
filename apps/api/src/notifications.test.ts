// Notification policy: exactly-once sends, pref/override/window filtering, and
// dead-token disabling — against PGlite and a fake gateway.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createDb,
  upsertUser,
  upsertApplications,
  upsertDevice,
  listDevices,
  updateDevice,
  setStatusOverride,
  type DbHandle,
  type StatusTransition,
} from "@pipeline/db";
import type { Application } from "@pipeline/contracts";
import type { PushGateway, PushMessage, SendOutcome } from "./push";
import { notifyTransitions, notifyInterviewReminders, sweepReceipts, type NotifyDeps } from "./notifications";

let h: DbHandle;
let sent: PushMessage[];
let deadTokens: string[];
let receiptDead: string[];

const gateway: PushGateway = {
  async send(messages) {
    sent.push(...messages);
    return messages.map<SendOutcome>((m) => ({
      token: m.to,
      ok: !deadTokens.includes(m.to),
      deviceNotRegistered: deadTokens.includes(m.to),
    }));
  },
  async pollReceipts() {
    const d = receiptDead;
    receiptDead = [];
    return d;
  },
};

const deps = (now?: string): NotifyDeps => ({ db: h.db, gateway, now: now ? () => new Date(now) : undefined });

const transition = (over: Partial<StatusTransition> = {}): StatusTransition => ({
  threadId: "t1",
  company: "Acme",
  role: "Engineer",
  from: "applied",
  to: "interview",
  isNew: false,
  overridden: false,
  ...over,
});

const appWithInterview = (threadId: string, iso: string): Application => ({
  id: threadId,
  threadId,
  company: "Acme",
  companyDomain: "acme.com",
  role: "Engineer",
  status: "interview",
  firstSeen: "2026-01-01",
  lastActivity: "2026-02-01",
  snippet: "",
  manual: false,
  enrichment: { interviewDateTime: iso },
});

beforeEach(async () => {
  h = await createDb();
  sent = [];
  deadTokens = [];
  receiptDead = [];
  await upsertUser(h.db, { id: "u1", email: "u1@x.com" });
  await upsertDevice(h.db, { userId: "u1", platform: "ios", expoPushToken: "tok-ios" });
  await upsertDevice(h.db, { userId: "u1", platform: "android", expoPushToken: "tok-android" });
});
afterEach(async () => {
  await h.close();
});

describe("notifyTransitions", () => {
  it("sends once per transition to every opted-in device, with ids-only payload", async () => {
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent).toHaveLength(2);
    expect(sent.map((m) => m.to).sort()).toEqual(["tok-android", "tok-ios"]);
    expect(sent[0]).toMatchObject({
      title: "Acme",
      body: "Engineer moved to Interview",
      data: { type: "transition", threadId: "t1" },
      channelId: "status-changes",
    });

    // replay (overlapping tick / restart): the ledger blocks the resend
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent).toHaveLength(2);
  });

  it("skips user-overridden records and respects per-device prefs", async () => {
    await notifyTransitions(deps(), "u1", [transition({ overridden: true })]);
    expect(sent).toHaveLength(0);

    const ios = (await listDevices(h.db, "u1")).find((d) => d.expoPushToken === "tok-ios")!;
    await updateDevice(h.db, "u1", ios.id, { notifyStatusChanges: false });
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent.map((m) => m.to)).toEqual(["tok-android"]);
  });

  it("new applications get their own copy; dead tokens get disabled", async () => {
    deadTokens = ["tok-ios"];
    await notifyTransitions(deps(), "u1", [transition({ isNew: true, from: undefined, to: "applied" })]);
    expect(sent.find((m) => m.to === "tok-android")!.body).toContain("New application");
    // the dead token is now disabled — next notification skips it
    sent = [];
    deadTokens = [];
    await notifyTransitions(deps(), "u1", [transition({ threadId: "t2" })]);
    expect(sent.map((m) => m.to)).toEqual(["tok-android"]);
  });
});

describe("notifyInterviewReminders", () => {
  it("fires the 24h window once, then the 1h window once, never after the fact", async () => {
    await upsertApplications(h.db, "u1", [appWithInterview("t-int", "2026-08-10T14:30:00Z")]);

    await notifyInterviewReminders(deps("2026-08-09T20:00:00Z")); // ~18.5h out → 24h window
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ title: "Interview tomorrow", body: "Acme — Engineer at 14:30", channelId: "reminders" });

    await notifyInterviewReminders(deps("2026-08-09T21:00:00Z")); // still 24h window → deduped
    expect(sent).toHaveLength(2);

    await notifyInterviewReminders(deps("2026-08-10T14:00:00Z")); // 30min out → 1h window
    expect(sent).toHaveLength(4);
    expect(sent[2]!.title).toBe("Interview in about an hour");

    sent = [];
    await notifyInterviewReminders(deps("2026-08-10T15:00:00Z")); // already happened
    expect(sent).toHaveLength(0);
  });

  it("far-future interviews and reminder-muted devices stay silent", async () => {
    await upsertApplications(h.db, "u1", [appWithInterview("t-int", "2026-09-01T09:00:00Z")]);
    await notifyInterviewReminders(deps("2026-08-09T20:00:00Z")); // weeks out
    expect(sent).toHaveLength(0);

    for (const d of await listDevices(h.db, "u1")) await updateDevice(h.db, "u1", d.id, { notifyReminders: false });
    await notifyInterviewReminders(deps("2026-08-31T20:00:00Z")); // inside 24h, but muted
    expect(sent).toHaveLength(0);
  });

  it("a status override doesn't silence interview reminders (only transition pings)", async () => {
    await upsertApplications(h.db, "u1", [appWithInterview("t-int", "2026-08-10T14:30:00Z")]);
    await setStatusOverride(h.db, "u1", "t-int", "interview");
    await notifyInterviewReminders(deps("2026-08-10T00:00:00Z"));
    expect(sent).toHaveLength(2);
  });

  it("prose interview text fires via its normalized ISO twin, showing the email's wall-clock time", async () => {
    // What real records look like since the normalizer: the raw field keeps the
    // email's words (Date.parse → NaN), the ISO twin carries the resolved
    // moment (2:30 PM ET in June = 18:30 UTC).
    const prose: Application = {
      ...appWithInterview("t-prose", ""),
      enrichment: {
        interviewDateTime: "Tuesday, June 12 at 2:30 PM ET",
        interviewDateTimeIso: "2026-06-12T14:30:00-04:00",
      },
    };
    await upsertApplications(h.db, "u1", [prose]);
    await notifyInterviewReminders(deps("2026-06-12T17:00:00Z")); // 1.5h before 18:30Z → 24h window
    expect(sent).toHaveLength(2);
    // the push shows 14:30 — the clock the email named — not the UTC rendering
    expect(sent[0]!.body).toBe("Acme — Engineer at 14:30");

    // pre-normalizer records (prose only, no twin) stay silent rather than crash
    sent = [];
    const legacy: Application = {
      ...appWithInterview("t-legacy", ""),
      enrichment: { interviewDateTime: "Thursday at 3pm" },
    };
    await upsertApplications(h.db, "u1", [legacy]);
    await notifyInterviewReminders(deps("2026-06-12T17:00:00Z"));
    expect(sent).toHaveLength(0);
  });

  it("closed-out records don't ping — a rejected thread's extracted interview is history", async () => {
    await upsertApplications(h.db, "u1", [{ ...appWithInterview("t-gone", "2026-08-10T14:30:00Z"), status: "rejected" }]);
    await notifyInterviewReminders(deps("2026-08-10T00:00:00Z"));
    expect(sent).toHaveLength(0);

    // ...and the user's own override to rejected silences it just the same
    await upsertApplications(h.db, "u1", [appWithInterview("t-closed", "2026-08-10T14:30:00Z")]);
    await setStatusOverride(h.db, "u1", "t-closed", "rejected");
    await notifyInterviewReminders(deps("2026-08-10T00:00:00Z"));
    expect(sent).toHaveLength(0);
  });
});

describe("sweepReceipts", () => {
  it("disables tokens the provider reported dead after the fact", async () => {
    receiptDead = ["tok-ios"];
    await sweepReceipts(deps());
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent.map((m) => m.to)).toEqual(["tok-android"]);
  });
});
