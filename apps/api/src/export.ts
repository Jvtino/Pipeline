// CSV export — every signed-in user's derived records (the pricing decision is
// "free for now", so nothing a user's own data depends on sits behind a
// paywall nobody can pay). Pure string builder, RFC-4180 quoting. (PDF export
// is a thin presentation layer on the same rows; deferred to avoid a heavy PDF
// dependency for now.)
import type { Application } from "@pipeline/contracts";

function cell(value: string | null | undefined): string {
  let v = String(value ?? "");
  // Spreadsheet formula-injection guard: company/role/snippet come from EMAIL
  // CONTENT — a sender could craft "=HYPERLINK(...)" and Excel/Sheets would
  // execute it on open. A leading apostrophe forces text interpretation.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

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
