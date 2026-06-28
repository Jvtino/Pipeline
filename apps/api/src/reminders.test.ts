import { describe, it, expect } from "vitest";
import type { Application, Status } from "@pipeline/contracts";
import { computeNudges } from "./reminders";

const NOW = Date.parse("2026-06-28T00:00:00Z");
function app(threadId: string, status: Status, lastActivity: string): Application {
  return { id: threadId, threadId, company: "Acme", companyDomain: "acme.com", role: "Engineer", status, firstSeen: "2026-01-01", lastActivity, snippet: "" };
}

describe("computeNudges", () => {
  it("nudges only stalled 'applied' apps past the threshold", () => {
    const apps = [
      app("a", "applied", "2026-06-01"), // 27 days → nudge
      app("b", "applied", "2026-06-25"), // 3 days → no
      app("c", "interview", "2026-01-01"), // progressed → no
      app("d", "rejected", "2026-01-01"), // closed → no
    ];
    const n = computeNudges(apps, NOW, 10);
    expect(n.map((x) => x.threadId)).toEqual(["a"]);
    expect(n[0]!.daysSince).toBe(27);
  });

  it("sorts by daysSince descending", () => {
    const apps = [app("a", "applied", "2026-06-10"), app("b", "applied", "2026-05-01")];
    expect(computeNudges(apps, NOW, 5).map((x) => x.threadId)).toEqual(["b", "a"]);
  });

  it("is empty when nothing is stalled", () => {
    expect(computeNudges([app("a", "offer", "2026-01-01")], NOW)).toEqual([]);
  });
});
