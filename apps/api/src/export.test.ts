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
    expect(lines[0]).toBe(
      "Company,Role,Status,Status set by you,Reviewed by you,First seen,Last activity,Interview (as written),Interview (normalized),Location,Compensation,Recruiter,Recruiter email,Snippet",
    );
    expect(lines).toHaveLength(3);
  });

  it("quotes cells containing commas, quotes, or newlines (RFC 4180)", () => {
    const csv = toCsv([app({ role: "Data, Analyst", snippet: 'he said "hi"\nthen left' })]);
    expect(csv).toContain('"Data, Analyst"');
    expect(csv).toContain('"he said ""hi""');
  });

  it("neutralizes spreadsheet formula injection from email-derived cells", () => {
    // a sender controls company/role/snippet — a leading = + - @ must not
    // execute as a formula when the export opens in Excel/Sheets
    const csv = toCsv([app({ company: "=HYPERLINK(\"https://evil.example\")", role: "+SUM(1,2)", snippet: "@cmd" })]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM");
    expect(csv).toContain("'@cmd");
    expect(csv).not.toMatch(/^=|,=/m);
  });

  it("carries enrichment and the user's own marks", () => {
    const csv = toCsv([
      app({
        overridden: true,
        reviewedAt: "2026-08-07T12:00:00Z",
        enrichment: {
          interviewDateTime: "Tuesday, June 12 at 2:30 PM ET",
          interviewDateTimeIso: "2026-06-12T14:30:00-04:00",
          location: "Remote (EU)",
          compensation: "€95k–110k",
          recruiterName: "Maya Lindqvist",
          recruiterTitle: "Talent Partner",
          recruiterEmail: "maya@acme.com",
        },
      }),
    ]);
    expect(csv).toContain("yes,2026-08-07T12:00:00Z");
    expect(csv).toContain('"Tuesday, June 12 at 2:30 PM ET",2026-06-12T14:30:00-04:00');
    expect(csv).toContain("Maya Lindqvist · Talent Partner,maya@acme.com");
  });
});
