// CSV export of derived application records. Pure and dependency-free: the API
// route streams it, and the phone's demo build produces the same bytes without
// a server. RFC-4180 quoting, plus a spreadsheet formula-injection guard —
// company/role/snippet are EMAIL CONTENT, so a crafted sender must not become
// a live formula when the file opens in Excel/Sheets.
import type { Application } from "./index";

/* ============================================================================
   CSV EXPORT — one builder, shared by the server route and the demo build so
   what a user downloads and what the demo shows are byte-identical.
   ========================================================================== */

/**
 * One CSV cell, safe to hand a spreadsheet. Exported because surfaces differ in
 * WHICH columns they export (the web adds its overlay-only rows and
 * presentation statuses) but must never differ in HOW a value is escaped —
 * that's the part with a security consequence.
 */
export function csvCell(value: string | null | undefined): string {
  let v = String(value ?? "");
  // Spreadsheet formula-injection guard: company/role/snippet come from EMAIL
  // CONTENT — a sender could craft "=HYPERLINK(...)" and Excel/Sheets would
  // execute it on open. A leading apostrophe forces text interpretation.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const cell = csvCell;

export function toCsv(apps: Application[]): string {
  const header = [
    "Company",
    "Role",
    "Status",
    "Status set by you",
    "Reviewed by you",
    "First seen",
    "Last activity",
    "Interview (as written)",
    "Interview (normalized)",
    "Location",
    "Compensation",
    "Recruiter",
    "Recruiter email",
    "Snippet",
  ];
  const lines = [header.join(",")];
  for (const a of apps) {
    const e = a.enrichment;
    lines.push(
      [
        a.company,
        a.role,
        a.status,
        a.overridden ? "yes" : "",
        a.reviewedAt ?? "",
        a.firstSeen,
        a.lastActivity,
        e?.interviewDateTime ?? "",
        e?.interviewDateTimeIso ?? "",
        e?.location ?? "",
        e?.compensation ?? "",
        [e?.recruiterName, e?.recruiterTitle].filter(Boolean).join(" · "),
        e?.recruiterEmail ?? "",
        a.snippet,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
