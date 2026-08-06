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

/** Deterministic avatar hue from the company name (desktop's hueFor). */
export function hueFor(company: string): number {
  let h = 0;
  for (let i = 0; i < company.length; i++) h = (h * 31 + company.charCodeAt(i)) % 360;
  return h;
}
