import { describe, it, expect } from "vitest";
import { parseThread, safeParseThread, statusSchema, STATUS_RANK, STATUSES, applicationSchema, boardFromApplications, boardSchema, pageBoard } from "./index";
import type { Application } from "./index";

describe("@pipeline/contracts", () => {
  const good = {
    threadId: "abc:123",
    domain: "greenhouse.io",
    subject: "Application for Software Engineer at Acme",
    messages: [{ date: "2026-01-02", from: "Acme via Greenhouse <jobs@greenhouse.io>", body: "thank you for applying" }],
  };

  it("accepts a well-formed thread", () => {
    expect(() => parseThread(good)).not.toThrow();
    expect(parseThread(good).messages).toHaveLength(1);
  });

  it("rejects a malformed thread (missing messages)", () => {
    const bad = { threadId: "x", domain: "y", subject: "z" };
    expect(safeParseThread(bad).success).toBe(false);
  });

  it("rejects a message with a non-string body", () => {
    const bad = { ...good, messages: [{ date: "2026-01-02", from: "a@b.com", body: 42 }] };
    expect(safeParseThread(bad).success).toBe(false);
  });

  it("exposes the application statuses and their ranks", () => {
    expect(STATUSES).toEqual(["applied", "interview", "offer", "rejected", "cancelled"]);
    expect(statusSchema.parse("offer")).toBe("offer");
    expect(STATUS_RANK.offer).toBe(3);
    expect(STATUS_RANK.applied).toBeLessThan(STATUS_RANK.interview);
  });

  it("treats confidence as an additive, backward-compatible optional on Application", () => {
    const base = {
      id: "a", threadId: "t", company: "Acme", companyDomain: "acme.com", role: "Engineer",
      status: "applied", firstSeen: "2026-01-01", lastActivity: "2026-01-02", snippet: "s",
    };
    expect(applicationSchema.safeParse(base).success).toBe(true); // no confidence → still valid
    expect(applicationSchema.safeParse({ ...base, confidence: 0.42 }).success).toBe(true);
    expect(applicationSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(false); // out of 0..1
  });

  it("accepts optional enrichment (value-or-null fields) and rejects a wrong type", () => {
    const base = {
      id: "a", threadId: "t", company: "Acme", companyDomain: "acme.com", role: "Engineer",
      status: "applied", firstSeen: "2026-01-01", lastActivity: "2026-01-02", snippet: "s",
    };
    expect(applicationSchema.safeParse({ ...base, enrichment: { compensation: "$120k", recruiterEmail: null } }).success).toBe(true);
    expect(applicationSchema.safeParse({ ...base, enrichment: { compensation: 123 } }).success).toBe(false);
  });
});

describe("pageBoard", () => {
  const mk = (threadId: string, company: string, lastActivity: string): Application => ({
    id: threadId, threadId, company, companyDomain: `${company.toLowerCase()}.com`, role: "Engineer",
    status: "applied", firstSeen: "2026-01-01", lastActivity, snippet: "",
  });
  const board = () =>
    boardFromApplications(
      [mk("a", "Alpha", "2026-01-05"), mk("b", "Beta", "2026-03-01"), mk("c", "Gamma", "2026-02-10"), mk("d", "Delta", "2026-03-01")],
      "test",
    );

  it("orders groups newest-activity-first with a name tiebreak; no limit → full board, no stamp", () => {
    const paged = pageBoard(board());
    expect(paged.groups.map((g) => g.company)).toEqual(["Beta", "Delta", "Gamma", "Alpha"]); // Beta/Delta tie on date → name order
    expect(paged.pagination).toBeUndefined();
    expect(paged.counts.total).toBe(4);
  });

  it("slices groups but counts still cover the whole board", () => {
    const paged = pageBoard(board(), 2, 1);
    expect(paged.groups.map((g) => g.company)).toEqual(["Delta", "Gamma"]);
    expect(paged.pagination).toEqual({ groupTotal: 4, groupOffset: 1, groupLimit: 2 });
    expect(paged.counts.total).toBe(4); // paging never lies about totals
  });

  it("offset past the end yields an empty page, never an error", () => {
    const paged = pageBoard(board(), 10, 99);
    expect(paged.groups).toEqual([]);
    expect(paged.pagination?.groupTotal).toBe(4);
  });

  it("the paged payload still validates against boardSchema", () => {
    expect(boardSchema.safeParse(pageBoard(board(), 2, 0)).success).toBe(true);
  });
});
