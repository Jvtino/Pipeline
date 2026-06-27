import { describe, it, expect } from "vitest";
import { buildBoard, threadToApplication, statusForThread } from "./applications";
import { DEMO_THREADS } from "./demo-data";
import { boardSchema, type Thread } from "@pipeline/contracts";

const find = (substr: string): Thread => {
  const t = DEMO_THREADS.find((d) => d.threadId.includes(substr));
  if (!t) throw new Error(`demo thread ${substr} missing`);
  return t;
};

describe("buildBoard", () => {
  const board = buildBoard(DEMO_THREADS, "demo");

  it("produces a contract-valid board", () => {
    expect(() => boardSchema.parse(board)).not.toThrow();
  });

  it("counts every demo thread exactly once", () => {
    expect(board.counts.total).toBe(DEMO_THREADS.length);
    const summed = board.counts.applied + board.counts.interview + board.counts.offer + board.counts.rejected;
    expect(summed).toBe(board.counts.total);
  });

  it("groups applications under their employer", () => {
    expect(board.groups.length).toBeGreaterThan(0);
    expect(board.groups.every((g) => g.applications.length >= 1)).toBe(true);
  });
});

describe("threadToApplication (derived record, no raw body)", () => {
  it("resolves the real employer behind an ATS, not the platform", () => {
    const app = threadToApplication(find("acme")); // greenhouse-routed
    expect(app.company).toBe("Acme Robotics");
    expect(app.companyDomain).not.toMatch(/greenhouse/i);
  });

  it("snippet is capped at 600 chars", () => {
    for (const t of DEMO_THREADS) {
      expect(threadToApplication(t).snippet.length).toBeLessThanOrEqual(600);
    }
  });
});

describe("statusForThread (latest status wins)", () => {
  it("an offer at the end of a thread reads as offer", () => {
    expect(statusForThread(find("stripe"))).toBe("offer");
    expect(statusForThread(find("vercel"))).toBe("offer");
  });
  it("a rejection reads as rejected even after an applied opener", () => {
    expect(statusForThread(find("initech"))).toBe("rejected");
    expect(statusForThread(find("notion"))).toBe("rejected");
  });
  it("an interview invite reads as interview", () => {
    expect(statusForThread(find("acme"))).toBe("interview");
    expect(statusForThread(find("hooli"))).toBe("interview");
  });
});
