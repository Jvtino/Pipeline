import { describe, it, expect } from "vitest";
import { boardFromApplications } from "@pipeline/contracts";
import type { Application } from "@pipeline/contracts";
import { flattenBoard } from "./derive";
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
    expect(rows.find((r) => r.id === "m-1")!.needsReview).toBe(false);
  });
});
