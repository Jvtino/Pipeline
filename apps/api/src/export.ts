// CSV export (Pro). Pure string builder over derived records — RFC-4180 quoting.
// (PDF export is a thin presentation layer on the same rows; deferred to avoid a
// heavy PDF dependency for now — see docs/DEPLOY.md / the PR.)
import type { Application } from "@pipeline/contracts";

function cell(value: string): string {
  const v = String(value ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(apps: Application[]): string {
  const header = ["Company", "Role", "Status", "First seen", "Last activity", "Snippet"];
  const lines = [header.join(",")];
  for (const a of apps) {
    lines.push([a.company, a.role, a.status, a.firstSeen, a.lastActivity, a.snippet].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}
