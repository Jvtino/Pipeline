import { describe, it, expect } from "vitest";
import { boardFromApplications } from "@pipeline/contracts";
import type { Application } from "@pipeline/contracts";
import { flattenBoard, companyCards, deriveContacts, mergeContacts, buildNotifications } from "./derive";
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
    expect(cards.find((c) => c.company === "Globex")!.apps).toHaveLength(1);
  });
});
