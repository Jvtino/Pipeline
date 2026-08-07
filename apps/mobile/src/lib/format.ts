// Display formatting for derived-record dates ("2026-02-01" or full ISO).
// Pure functions — unit-tested without any RN runtime.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-01…" → "Feb 1, 2026"; unparseable input renders as itself. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  return month ? `${month} ${Number(d)}, ${y}` : iso;
}

/** Sender display: `"Acme via Greenhouse <x@y>"` → `Acme via Greenhouse`. */
export function senderName(from: string): string {
  const angle = from.indexOf("<");
  const name = (angle >= 0 ? from.slice(0, angle) : from).trim().replace(/^"|"$/g, "");
  return name || from;
}

/** Monogram for the company avatar (same idea as the web app's lettered tiles). */
export function monogram(company: string): string {
  return (
    company
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Compact relative time for list rows: "today", "3d", "2w", "4mo" — a
 *  glanceable age, not a timestamp (detail views show real dates). Future or
 *  unparseable dates fall back to the formatted date. */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(then) || then > now.getTime() + 24 * 60 * 60 * 1000) return formatDate(iso);
  const days = Math.max(0, Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/** Deterministic avatar hue from the company name (desktop's hueFor). */
export function hueFor(company: string): number {
  let h = 0;
  for (let i = 0; i < company.length; i++) h = (h * 31 + company.charCodeAt(i)) % 360;
  return h;
}
