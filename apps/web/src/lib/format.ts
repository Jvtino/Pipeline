// Small date/number helpers. Dates from the API are ISO strings (YYYY-MM-DD);
// the design shows compact mono dates like "May 2".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse an ISO date (YYYY-MM-DD) to epoch ms (UTC midnight). NaN-safe callers. */
export function parseIso(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** "2026-05-02" → "May 2". Empty/invalid → "—". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = parseIso(iso);
  if (Number.isNaN(ms)) return iso; // already a human string like "today"
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Whole days between two epoch-ms instants (a after b → positive). */
export function daysBetween(aMs: number, bMs: number): number {
  return Math.floor((aMs - bMs) / 86_400_000);
}

/** The LOCAL calendar date (YYYY-MM-DD) for an instant — what a user means by
 *  "today". toISOString() would give the UTC date, which is yesterday/tomorrow
 *  for part of every day outside UTC. */
export function localIsoDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A friendly "synced" label for the header chip from an ISO timestamp or null. */
export function syncedLabel(at: number | null): string {
  if (!at) return "not synced yet";
  const d = new Date(at);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `synced ${h}:${m} ${ampm}`;
}

export { MONTHS };
