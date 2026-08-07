// Pure-logic tests: board filtering, formatting, and the version gate — the
// parts of the app that run without any React Native runtime.
import { describe, it, expect } from "vitest";
import type { Application, CompanyGroup } from "@pipeline/contracts";
import { filterBoard, filterByStatus, countChips } from "./board";
import { boardEvents, agenda, untilLabel, upcomingInterviews } from "./calendar";
import { formatDate, relativeAge, senderName, monogram, hueFor } from "./format";
import { sortPinnedFirst } from "./pins";
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
  it("relative ages: today/days/weeks/months, future falls back to the date", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    expect(relativeAge("2026-08-07", now)).toBe("today");
    expect(relativeAge("2026-08-04", now)).toBe("3d");
    expect(relativeAge("2026-07-17", now)).toBe("3w");
    expect(relativeAge("2026-05-01", now)).toBe("3mo");
    expect(relativeAge("2026-09-01", now)).toBe("Sep 1, 2026");
    expect(relativeAge("garbage", now)).toBe("garbage");
  });

  it("sortPinnedFirst floats pinned groups, keeps order within halves", () => {
    const gs = [{ company: "A" }, { company: "B" }, { company: "C" }];
    expect(sortPinnedFirst(gs, new Set(["C"])).map((g) => g.company)).toEqual(["C", "A", "B"]);
    expect(sortPinnedFirst(gs, new Set()).map((g) => g.company)).toEqual(["A", "B", "C"]);
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

describe("calendar derivation", () => {
  const withInterview: Application = {
    ...app("Engineer", "interview"),
    enrichment: { interviewDateTime: "2026-08-10T14:30:00Z" },
  };
  const plain = app("Designer", "applied"); // lastActivity 2026-02-01

  it("derives interview + status events from the board", () => {
    const events = boardEvents([withInterview, plain]);
    expect(events).toHaveLength(3); // interview + its status activity + plain's activity
    const interview = events.find((e) => e.kind === "interview")!;
    expect(interview).toMatchObject({ date: "2026-08-10", time: "14:30", company: "Acme" });
  });

  it("groups into an agenda, newest day first, interviews before status events", () => {
    const days = agenda(boardEvents([withInterview, plain]));
    expect(days[0]!.date).toBe("2026-08-10");
    expect(days[0]!.events[0]!.kind).toBe("interview");
    expect(days.at(-1)!.date).toBe("2026-02-01");
  });

  it("untilLabel: today/tomorrow/in N days", () => {
    expect(untilLabel("2026-08-07", "2026-08-07")).toBe("today");
    expect(untilLabel("2026-08-08", "2026-08-07")).toBe("tomorrow");
    expect(untilLabel("2026-08-12", "2026-08-07")).toBe("in 5 days");
    expect(untilLabel("garbage", "2026-08-07")).toBe("today"); // NaN-safe
  });

  it("upcoming interviews: on/after today, soonest first; skips dateless enrichment", () => {
    const noDate: Application = { ...app("PM"), enrichment: { interviewDateTime: null } };
    const events = boardEvents([withInterview, noDate, plain]);
    expect(upcomingInterviews(events, "2026-08-01").map((e) => e.date)).toEqual(["2026-08-10"]);
    expect(upcomingInterviews(events, "2026-08-11")).toEqual([]); // already past
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
