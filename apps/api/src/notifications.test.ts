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

/**
 * A gateway that REPORTS failure without throwing — exactly what the real Expo
 * gateway does (it catches per chunk and resolves `ok:false`). Everything about
 * the ledger's retry behavior has to work against this shape, not against a
 * throwing fake.
 */
const reportingFailureGateway = (rounds: number): PushGateway => {
  let left = rounds;
  return {
    async send(messages) {
      if (left > 0) {
        left -= 1;
        return messages.map<SendOutcome>((m) => ({ token: m.to, ok: false, deviceNotRegistered: false }));
      }
      sent.push(...messages);
      return messages.map<SendOutcome>((m) => ({ token: m.to, ok: true, deviceNotRegistered: false }));
    },
    pollReceipts: gateway.pollReceipts,
  };
};

/** Delivers to some tokens and reports the rest as not-ok — the half-delivered
 *  batch the real gateway produces when one chunk's transport dies. */
const partialGateway = (deliverTo: string[]): PushGateway => ({
  async send(messages) {
    const landed = messages.filter((m) => deliverTo.includes(m.to));
    sent.push(...landed);
    return messages.map<SendOutcome>((m) => ({ token: m.to, ok: deliverTo.includes(m.to), deviceNotRegistered: false }));
  },
  pollReceipts: gateway.pollReceipts,
});

/** A gateway whose send() THROWS — a custom/buggy gateway, covered separately
 *  because the ledger must handle it too. */
const throwingGateway = (failures: number): PushGateway => {
  let left = failures;
  return {
    async send(messages) {
      if (left > 0) {
        left -= 1;
        throw new Error("expo unreachable");
      }
      sent.push(...messages);
      return messages.map<SendOutcome>((m) => ({ token: m.to, ok: true, deviceNotRegistered: false }));
    },
    pollReceipts: gateway.pollReceipts,
  };
};

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

describe("resilience — the unattended worker's bad days", () => {
  it("a REPORTED failure (what the real gateway does) still retries next tick", async () => {
    // The production gateway never throws — it catches per chunk and resolves
    // ok:false. If the ledger only reacted to throws, this reminder would be
    // claimed-but-unsent and lost forever.
    await upsertApplications(h.db, "u1", [appWithInterview("t-int", "2026-08-10T14:30:00Z")]);
    await notifyInterviewReminders({ ...deps("2026-08-09T20:00:00Z"), gateway: reportingFailureGateway(1) });
    expect(sent).toHaveLength(0);
    await notifyInterviewReminders(deps("2026-08-09T20:05:00Z"));
    expect(sent).toHaveLength(2);
    await notifyInterviewReminders(deps("2026-08-09T20:10:00Z"));
    expect(sent).toHaveLength(2); // still exactly once
  });

  it("the same holds for status transitions", async () => {
    await notifyTransitions({ ...deps(), gateway: reportingFailureGateway(1) }, "u1", [transition()]);
    expect(sent).toHaveLength(0);
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent).toHaveLength(2);
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent).toHaveLength(2); // still exactly once
  });

  it("a HALF-delivered batch retries only the devices that missed out", async () => {
    // chunked sends can come back partly delivered: the phone that got it must
    // never be told twice, the one that didn't must not be stranded
    await notifyTransitions({ ...deps(), gateway: partialGateway(["tok-ios"]) }, "u1", [transition()]);
    expect(sent.map((m) => m.to)).toEqual(["tok-ios"]);
    sent = [];
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent.map((m) => m.to)).toEqual(["tok-android"]); // just the straggler
    sent = [];
    await notifyTransitions(deps(), "u1", [transition()]);
    expect(sent).toHaveLength(0); // both devices are done, forever
  });

  it("a gateway that throws is handled too", async () => {
    await notifyTransitions({ ...deps(), gateway: throwingGateway(1) }, "u1", [transition({ threadId: "t-throw" })]);
    expect(sent).toHaveLength(0);
    await notifyTransitions(deps(), "u1", [transition({ threadId: "t-throw" })]);
    expect(sent).toHaveLength(2);
  });

  it("one user's failure doesn't strand every later user's reminder", async () => {
    await upsertUser(h.db, { id: "u2", email: "u2@x.com" });
    await upsertDevice(h.db, { userId: "u2", platform: "ios", expoPushToken: "tok-u2" });
    await upsertApplications(h.db, "u1", [appWithInterview("t-a", "2026-08-10T14:30:00Z")]);
    await upsertApplications(h.db, "u2", [appWithInterview("t-b", "2026-08-10T15:30:00Z")]);

    // u1's devices fail to receive; u2 must still be reached on this same tick
    await notifyInterviewReminders({ ...deps("2026-08-09T20:00:00Z"), gateway: partialGateway(["tok-u2"]) });
    expect(sent.map((m) => m.to)).toEqual(["tok-u2"]);

    // and u1 is retried next tick — nobody is permanently skipped
    await notifyInterviewReminders(deps("2026-08-09T20:05:00Z"));
    expect(new Set(sent.map((m) => m.to))).toEqual(new Set(["tok-ios", "tok-android", "tok-u2"]));
  });

  it("a dead token reported mid-batch doesn't cost the batch its claim", async () => {
    // The push DID go out (to the live device); post-send bookkeeping ran too.
    // The claim must stand either way — a re-send would be a duplicate.
    deadTokens = ["tok-ios"];
    await notifyTransitions(deps(), "u1", [transition({ threadId: "t-book" })]);
    expect(sent).toHaveLength(2);
    sent = [];
    deadTokens = [];
    await notifyTransitions(deps(), "u1", [transition({ threadId: "t-book" })]);
    expect(sent).toHaveLength(0); // claimed and sent — never sent twice
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
