import { describe, it, expect } from "vitest";
import type { Application } from "@pipeline/contracts";
import { toCsv } from "./export";

const app = (over: Partial<Application> = {}): Application => ({
  id: "x",
  threadId: "t",
  company: "Acme",
  companyDomain: "acme.com",
  role: "Engineer",
  status: "applied",
  firstSeen: "2026-01-01",
  lastActivity: "2026-02-01",
  snippet: "hi",
  ...over,
});

describe("toCsv", () => {
  it("writes a header and one row per application", () => {
    const lines = toCsv([app(), app({ company: "Globex" })]).trim().split("\n");
    expect(lines[0]).toBe("Company,Role,Status,First seen,Last activity,Snippet");
    expect(lines).toHaveLength(3);
  });

  it("quotes cells containing commas, quotes, or newlines (RFC 4180)", () => {
    const csv = toCsv([app({ role: "Data, Analyst", snippet: 'he said "hi"\nthen left' })]);
    expect(csv).toContain('"Data, Analyst"');
    expect(csv).toContain('"he said ""hi""');
  });
});
