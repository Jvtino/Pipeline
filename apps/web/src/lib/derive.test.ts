import { describe, it, expect } from "vitest";
import { boardFromApplications } from "@pipeline/contracts";
import type { Application } from "@pipeline/contracts";
import { flattenBoard, companyCards, deriveContacts, mergeContacts, buildNotifications, calendarFor, parseInterviewDate, parseInterviewTime, upcomingInterviews } from "./derive";
import { defaultOverlay } from "./overlay";

const app = (over: Partial<Application> & { threadId: string }): Application => ({
  id: over.threadId,
  company: "Acme",
  companyDomain: "acme.com",
  role: "Engineer",
  status: "applied",
  firstSeen: "2026-05-01",
  lastActivity: "2026-05-02",
  snippet: "",
  ...over,
});

describe("flattenBoard — needsReview seam", () => {
  const now = Date.parse("2026-05-10");

  it("flags low-confidence records; leaves confident and confidence-less ones alone", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "low", confidence: 0.3 }),
        app({ threadId: "high", confidence: 0.9 }),
        app({ threadId: "none" }), // no confidence (e.g. DB read path) → not flagged
      ],
      "test",
    );
    const review = Object.fromEntries(flattenBoard(board, defaultOverlay(), now).map((r) => [r.id, r.needsReview]));
    expect(review["low"]).toBe(true);
    expect(review["high"]).toBe(false);
    expect(review["none"]).toBe(false);
  });

  it("a user-overridden 'applied' never re-derives to no_response — the user's word is final", () => {
    const stale = "2026-03-01"; // 70 days before `now` — far past the stale threshold
    const board = boardFromApplications(
      [
        app({ threadId: "pinned", lastActivity: stale, overridden: true }), // user explicitly set Applied
        app({ threadId: "quiet", lastActivity: stale }), // classifier's applied, gone quiet → nudge
      ],
      "test",
    );
    const status = Object.fromEntries(flattenBoard(board, defaultOverlay(), now).map((r) => [r.id, r.status]));
    expect(status["pinned"]).toBe("applied");
    expect(status["quiet"]).toBe("no_response");
  });

  it("a reviewed record stops asking — server reviewedAt or the local fallback mark", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "seen", confidence: 0.3, reviewedAt: "2026-05-09T10:00:00Z" }), // confirmed on any device
        app({ threadId: "local", confidence: 0.3 }), // confirmed offline on this one
        app({ threadId: "unseen", confidence: 0.3 }),
      ],
      "test",
    );
    const overlay = { ...defaultOverlay(), reviewedLocal: { local: true } };
    const review = Object.fromEntries(flattenBoard(board, overlay, now).map((r) => [r.id, r.needsReview]));
    expect(review["seen"]).toBe(false);
    expect(review["local"]).toBe(false);
    expect(review["unseen"]).toBe(true);
  });

  it("never flags a manual application (nothing to confirm)", () => {
    const overlay = {
      ...defaultOverlay(),
      manual: [{ id: "m-1", company: "Acme", role: "Engineer", status: "applied" as const, dateLabel: "May 1", source: "Company site", createdIso: "2026-05-01" }],
    };
    const rows = flattenBoard(null, overlay, now);
    const row = rows.find((r) => r.id === "m-1")!;
    expect(row.needsReview).toBe(false);
    expect(row.enrichment).toBeNull(); // manual apps carry no extracted enrichment
  });

  it("passes extracted enrichment through to the UI row (null when absent)", () => {
    const enrichment = { compensation: "$120k", location: "Remote", recruiterEmail: "jo@acme.com" };
    const board = boardFromApplications([app({ threadId: "e", enrichment }), app({ threadId: "plain" })], "test");
    const byId = Object.fromEntries(flattenBoard(board, defaultOverlay(), now).map((r) => [r.id, r.enrichment]));
    expect(byId["e"]).toEqual(enrichment);
    expect(byId["plain"]).toBeNull();
  });

  it("derives interview sub-state labels from enrichment (confirmed vs scheduling pending)", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "conf", status: "interview", enrichment: { interviewDateTime: "Tuesday, June 12 at 3:00pm PT" } }),
        app({ threadId: "pend", status: "interview", enrichment: { interviewLink: "https://calendly.com/acme/30min" } }),
        app({ threadId: "bare", status: "interview" }),
        app({ threadId: "notint", status: "applied", enrichment: { interviewLink: "https://calendly.com/x" } }),
      ],
      "test",
    );
    const step = Object.fromEntries(flattenBoard(board, defaultOverlay(), now).map((r) => [r.id, r.nextStep]));
    expect(step["conf"]).toBe("Interview confirmed · Tuesday, June 12 at 3:00pm PT");
    expect(step["pend"]).toBe("Scheduling pending — pick a time");
    expect(step["bare"]).toBe("Prepare for the interview"); // no enrichment → generic label
    expect(step["notint"]).toBe("Awaiting reply"); // sub-state only applies to interview cards
  });

  it("deriveContacts extracts recruiters from enrichment, dedups, and merges manual-first", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "a", enrichment: { recruiterName: "Jordan Lee", recruiterTitle: "Recruiter", recruiterEmail: "jl@acme.com", recruiterPhone: "(415) 555-0143" } }),
        app({ threadId: "b", enrichment: { recruiterEmail: "JL@acme.com" } }), // same person, different casing → deduped
        app({ threadId: "c", enrichment: { recruiterEmail: "dana@acme.com" } }), // no name → email local part
        app({ threadId: "d", enrichment: { compensation: "$100k" } }), // no recruiter → no contact
        app({ threadId: "e" }),
      ],
      "test",
    );
    const rows = flattenBoard(board, defaultOverlay(), Date.parse("2026-05-10"));
    const derived = deriveContacts(rows);
    expect(derived.map((c) => c.name).sort()).toEqual(["Jordan Lee", "dana"]);
    const jordan = derived.find((c) => c.name === "Jordan Lee")!;
    expect(jordan.phone).toBe("(415) 555-0143");
    expect(jordan.source).toBe("email");
    expect(jordan.appId).toBe("a");

    // A manual entry for the same email wins; other derived contacts still appear.
    const manual = [{ id: "m1", name: "Jordan L.", title: "Sr Recruiter", email: "jl@acme.com", company: "Acme" }];
    const merged = mergeContacts(derived, manual);
    expect(merged.map((c) => c.name).sort()).toEqual(["Jordan L.", "dana"]);
    expect(merged[0]!.id).toBe("m1"); // manual first
  });

  it("buildNotifications surfaces offers, interviews, overdue follow-ups and a review summary", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "off", status: "offer", lastActivity: "2026-05-09" }),
        app({ threadId: "int", status: "interview", lastActivity: "2026-05-09" }),
        app({ threadId: "old", status: "applied", lastActivity: "2026-04-20" }), // quiet 20 days → follow-up (as no_response)
        app({ threadId: "fresh", status: "applied", lastActivity: "2026-05-09" }), // quiet 1 day → NOT a follow-up
        app({ threadId: "low", status: "applied", lastActivity: "2026-05-09", confidence: 0.3 }), // → review summary
      ],
      "test",
    );
    const rows = flattenBoard(board, defaultOverlay(), now);
    const ns = buildNotifications(rows, now);
    const tags = ns.map((n) => n.tag);
    expect(tags).toContain("Offer");
    expect(tags).toContain("Interview");
    expect(tags).toContain("Follow-up");
    expect(tags).toContain("Review");
    expect(ns.find((n) => n.tag === "Follow-up")!.appId).toBe("old");
    expect(ns.some((n) => n.appId === "fresh")).toBe(false);
    expect(ns.length).toBeLessThanOrEqual(6);
    // Empty pipeline → no notifications (bell shows no dot).
    expect(buildNotifications([], now)).toEqual([]);
  });

  it("ordering: a just-added entry beats same-day rows; full timestamps don't sink to the bottom", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "sameday-old", firstSeen: "2026-04-01", lastActivity: "2026-05-09", company: "Zeta" }), // old app, active today-ish
        app({ threadId: "sameday-new", firstSeen: "2026-05-09", lastActivity: "2026-05-09", company: "Alpha" }), // applied the same day
      ],
      "test",
    );
    const overlay = {
      ...defaultOverlay(),
      manual: [{ id: "m-now", company: "Nova", role: "Engineer", status: "applied" as const, dateLabel: "", source: "Company site", createdIso: "2026-05-09T14:30:00" }],
    };
    const rows = flattenBoard(board, overlay, Date.parse("2026-05-09T18:00:00Z"));
    // Full timestamp beats the date-only rows from the same day (it used to parse
    // to NaN and sort dead last); among the date-only ties, later firstSeen wins.
    expect(rows.map((r) => r.id)).toEqual(["m-now", "sameday-new", "sameday-old"]);
  });

  it("calendarFor buckets per-day counts: applied on firstSeen, interview/rejected on their own days", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "a1", firstSeen: "2026-05-04", lastActivity: "2026-05-04" }),
        app({ threadId: "a2", firstSeen: "2026-05-04", lastActivity: "2026-05-04", company: "Globex" }),
        // interview with a PARSEABLE enrichment date → lands on that day, not lastActivity
        app({ threadId: "i1", status: "interview", firstSeen: "2026-05-01", lastActivity: "2026-05-06", enrichment: { interviewDateTime: "2026-05-20 14:00" } }),
        // free-text weekday resolves to the first Tuesday AFTER the email (Thu May 7 → May 12)
        app({ threadId: "i2", status: "interview", firstSeen: "2026-05-02", lastActivity: "2026-05-07", enrichment: { interviewDateTime: "Tuesday at 2pm PT" } }),
        app({ threadId: "r1", status: "rejected", firstSeen: "2026-05-03", lastActivity: "2026-05-09" }),
      ],
      "test",
    );
    const rows = flattenBoard(board, defaultOverlay(), now);
    const cells = calendarFor(rows, 2026, 4); // May 2026
    const day = (d: number) => cells.find((c) => c.day === d)!;
    expect(day(4).counts.applied).toHaveLength(2); // two applications that day
    expect(day(20).counts.interview.map((e) => e.id)).toEqual(["i1"]); // parseable date wins
    expect(day(12).counts.interview.map((e) => e.id)).toEqual(["i2"]); // "Tuesday" → the Tuesday after the email
    expect(day(9).counts.rejected.map((e) => e.id)).toEqual(["r1"]);
    expect(day(9).counts.applied).toHaveLength(0); // applied count sits on its own day (May 3)
    expect(day(3).counts.applied.map((e) => e.id)).toEqual(["r1"]);
  });

  it("applies user renames (regrouping + clearing platformFallback) and hides hidden apps", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "junk", company: "Greenhouse-mail", platformFallback: true }),
        app({ threadId: "real", company: "Acme" }),
        app({ threadId: "gone", company: "Spam Co" }),
      ],
      "test",
    );
    const overlay = { ...defaultOverlay(), companyNames: { junk: "Acme" }, hidden: { gone: true } };
    const rows = flattenBoard(board, overlay, now);
    expect(rows.find((r) => r.id === "junk")!.company).toBe("Acme");
    expect(rows.find((r) => r.id === "junk")!.platformFallback).toBe(false); // groups normally now
    expect(rows.some((r) => r.id === "gone")).toBe(false);
    const cards = companyCards(rows);
    expect(cards).toHaveLength(1); // renamed row merged into the Acme card
    expect(cards[0]!.apps).toHaveLength(2);
  });

  it("parseInterviewDate resolves the free-text dates recruiters actually write", () => {
    const ref = "2026-06-05"; // the email's date (a Friday)
    expect(parseInterviewDate("Tuesday, June 12 at 3:00pm PT", ref)).toBe("2026-06-12");
    expect(parseInterviewDate("12 June at 14:00 CET", ref)).toBe("2026-06-12");
    expect(parseInterviewDate("June 12", ref)).toBe("2026-06-12");
    expect(parseInterviewDate("2026-05-20 14:00", ref)).toBe("2026-05-20");
    expect(parseInterviewDate("Monday at 2pm", ref)).toBe("2026-06-08"); // first Monday after Fri Jun 5
    expect(parseInterviewDate("Friday at 10am", ref)).toBe("2026-06-12"); // same weekday → NEXT week, not the email's own day
    expect(parseInterviewDate("Jan 5", "2026-12-20")).toBe("2027-01-05"); // December mail, January interview → year rolls
    expect(parseInterviewDate("at 3:00pm PT", ref)).toBeNull(); // time only — no day to place it on
    expect(parseInterviewDate("", ref)).toBeNull();
  });

  it("parseInterviewTime pulls the time-of-day out of the free text", () => {
    expect(parseInterviewTime("Tuesday, June 12 at 3:00pm PT")).toBe("3:00pm PT");
    expect(parseInterviewTime("12 June at 14:00 CET")).toBe("14:00 CET");
    expect(parseInterviewTime("June 12")).toBeNull();
  });

  it("companyCards groups a company's positions into .apps (drives the expandable card)", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "a1", company: "Acme", role: "Engineer" }),
        app({ threadId: "a2", company: "Acme", role: "Designer" }),
        app({ threadId: "g1", company: "Globex", role: "Analyst" }),
      ],
      "test",
    );
    const cards = companyCards(flattenBoard(board, defaultOverlay(), now));
    const acme = cards.find((c) => c.company === "Acme")!;
    expect(acme.apps.map((a) => a.role).sort()).toEqual(["Designer", "Engineer"]);
    expect(acme.sub).toBe("2 roles");
    const globex = cards.find((c) => c.company === "Globex")!;
    expect(globex.apps).toHaveLength(1);
    expect(globex.sub).toBe("Analyst"); // single role → the role itself (client hint on staffing cards)
  });
});

describe("upcomingInterviews — the dashboard strip", () => {
  // nowMs at local noon so "today"/"tomorrow" are unambiguous in any TZ
  const nowMs = new Date(2026, 5, 12, 12, 0).getTime(); // 2026-06-12 local

  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayIso = local(new Date(2026, 5, 12));
  const tomorrowIso = local(new Date(2026, 5, 13));

  it("surfaces today/tomorrow interviews from the server ISO twin, soonest first", () => {
    const board = boardFromApplications(
      [
        app({ threadId: "tmrw", status: "interview", enrichment: { interviewDateTimeIso: `${tomorrowIso}T09:00:00` } }),
        app({ threadId: "today", status: "interview", enrichment: { interviewDateTimeIso: `${todayIso}T15:30:00` } }),
        app({ threadId: "far", status: "interview", enrichment: { interviewDateTimeIso: "2026-07-01T10:00:00" } }),
        app({ threadId: "done", status: "rejected", enrichment: { interviewDateTimeIso: `${todayIso}T16:00:00` } }),
      ],
      "test",
    );
    const soon = upcomingInterviews(flattenBoard(board, defaultOverlay(), nowMs), nowMs);
    expect(soon.map((s) => s.id)).toEqual(["today", "tmrw"]);
    expect(soon[0]).toMatchObject({ label: "today", time: "15:30" });
    expect(soon[1]).toMatchObject({ label: "tomorrow", time: "09:00" });
  });

  it("falls back to the client prose parser for pre-normalizer records", () => {
    const board = boardFromApplications(
      [app({ threadId: "prose", status: "interview", lastActivity: todayIso, enrichment: { interviewDateTime: `${tomorrowIso} 11:00` } })],
      "test",
    );
    const soon = upcomingInterviews(flattenBoard(board, defaultOverlay(), nowMs), nowMs);
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ id: "prose", label: "tomorrow", time: "11:00" });
  });
});
