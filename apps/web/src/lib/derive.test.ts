import { describe, it, expect } from "vitest";
import { boardFromApplications } from "@pipeline/contracts";
import type { Application } from "@pipeline/contracts";
import { flattenBoard, companyCards } from "./derive";
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
