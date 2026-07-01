import { describe, it, expect } from "vitest";
import { parseThread, safeParseThread, statusSchema, STATUS_RANK, STATUSES, applicationSchema } from "./index";

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

  it("exposes the four statuses and their ranks", () => {
    expect(STATUSES).toEqual(["applied", "interview", "offer", "rejected"]);
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
});
