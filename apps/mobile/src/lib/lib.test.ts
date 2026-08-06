// Pure-logic tests: board filtering, formatting, and the version gate — the
// parts of the app that run without any React Native runtime.
import { describe, it, expect } from "vitest";
import type { Application, CompanyGroup } from "@pipeline/contracts";
import { filterBoard, filterByStatus, countChips } from "./board";
import { formatDate, senderName, monogram, hueFor } from "./format";
import { versionAtLeast } from "./version";

const app = (role: string, status: Application["status"] = "applied"): Application => ({
  id: `u:${role}`,
  threadId: `t-${role}`,
  company: "Acme",
  companyDomain: "acme.com",
  role,
  status,
  firstSeen: "2026-01-01",
  lastActivity: "2026-02-01",
  snippet: "",
  manual: false,
});

const groups: CompanyGroup[] = [
  { company: "Acme Robotics", domain: "acme.com", applications: [app("Staff Engineer"), app("Designer", "interview")] },
  { company: "Globex", domain: "globex.com", applications: [app("Engineer", "offer")] },
];

describe("filterBoard", () => {
  it("matches company names keeping all positions", () => {
    const out = filterBoard(groups, "acme");
    expect(out).toHaveLength(1);
    expect(out[0]!.applications).toHaveLength(2);
  });
  it("matches roles keeping only matching positions", () => {
    const out = filterBoard(groups, "engineer");
    expect(out.map((g) => g.company)).toEqual(["Acme Robotics", "Globex"]);
    expect(out[0]!.applications.map((a) => a.role)).toEqual(["Staff Engineer"]);
  });
  it("empty query is identity; no match is empty", () => {
    expect(filterBoard(groups, "  ")).toEqual(groups);
    expect(filterBoard(groups, "zzz")).toEqual([]);
  });
});

describe("filterByStatus", () => {
  it("keeps only groups/positions with the status", () => {
    const out = filterByStatus(groups, "interview");
    expect(out).toHaveLength(1);
    expect(out[0]!.applications.map((a) => a.role)).toEqual(["Designer"]);
  });
  it("null is identity", () => {
    expect(filterByStatus(groups, null)).toEqual(groups);
  });
});

describe("countChips", () => {
  it("orders like the board and drops zeros", () => {
    const chips = countChips({ applied: 3, interview: 1, offer: 0, rejected: 2, cancelled: 0, total: 6 });
    expect(chips).toEqual([
      { status: "applied", count: 3 },
      { status: "interview", count: 1 },
      { status: "rejected", count: 2 },
    ]);
  });
});

describe("format", () => {
  it("formats ISO dates and passes garbage through", () => {
    expect(formatDate("2026-02-01")).toBe("Feb 1, 2026");
    expect(formatDate("2026-11-23T10:00:00Z")).toBe("Nov 23, 2026");
    expect(formatDate("soon")).toBe("soon");
  });
  it("extracts sender display names", () => {
    expect(senderName("Acme via Greenhouse <no-reply@greenhouse.io>")).toBe("Acme via Greenhouse");
    expect(senderName("no-reply@acme.com")).toBe("no-reply@acme.com");
  });
  it("monograms and stable hues", () => {
    expect(monogram("Acme Robotics")).toBe("AR");
    expect(monogram("stripe")).toBe("S");
    expect(hueFor("Acme")).toBe(hueFor("Acme"));
    expect(hueFor("Acme")).toBeGreaterThanOrEqual(0);
    expect(hueFor("Acme")).toBeLessThan(360);
  });
});

describe("versionAtLeast (meta gate)", () => {
  it("compares dotted versions", () => {
    expect(versionAtLeast("1.2.3", "1.2.3")).toBe(true);
    expect(versionAtLeast("1.3.0", "1.2.9")).toBe(true);
    expect(versionAtLeast("1.2.3", "1.10.0")).toBe(false);
    expect(versionAtLeast("0.1.0", "0.0.0")).toBe(true);
  });
  it("malformed input can never lock users out", () => {
    expect(versionAtLeast("0.1.0", "not-a-version")).toBe(true);
  });
});
