// Best-effort normalization of an EXTRACTED interview date/time (the raw text
// extract.ts matched — "Tuesday, June 12 at 2:30 PM ET", "12 June at 14:00
// CET", "2026-06-12 14:00") into a machine-readable ISO string. The raw text
// stays the display truth everywhere; this exists so date MATH works — the
// worker's T-24h/T-1h reminder windows, the mobile calendar and banner — which
// Date.parse(prose) silently disabled (NaN) for most real emails.
//
// Principles:
// - Wall-clock first: "2:30 PM" means 2:30 on the interviewer's clock. When a
//   zone abbreviation is recognized, the ISO carries its UTC offset (with US
//   DST resolved by the interview's own date); otherwise the ISO is zone-less
//   and consumers treat it as approximate.
// - Missing pieces resolve against the email's date: a bare "June 12" takes
//   the email's year (rolling forward when that lands far in the past), and a
//   bare weekday ("Thursday at 3pm") lands on the first such weekday ON or
//   AFTER the email date — mails talk about upcoming interviews.
// - Time-only matches ("at 3pm PT") return null: with no date they cannot be
//   placed on a calendar, and inventing one would fire reminders on the wrong
//   day. Null here simply means "display the text, skip the math" — exactly
//   how consumers already treat unparseable values.

export interface NormalizedDateTime {
  /** "YYYY-MM-DD", or "YYYY-MM-DDTHH:MM:00" (+ "±HH:MM" when the zone was recognized). */
  iso: string;
  hasTime: boolean;
  /** The zone abbreviation as written ("ET", "CET"), when one was recognized. */
  zone: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};

/** Fixed-offset zones, minutes east of UTC. */
const FIXED_ZONES: Record<string, number> = {
  utc: 0, gmt: 0, bst: 60, cet: 60, cest: 120, ist: 330,
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
};

/** US zones written without S/D — resolved by whether the DATE is in US DST. */
const US_FLOATING: Record<string, [standard: number, daylight: number]> = {
  et: [-300, -240], ct: [-360, -300], mt: [-420, -360], pt: [-480, -420],
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** nth weekday-of-month in UTC (n is 1-based; weekday 0=Sunday). */
function nthWeekday(year: number, month1: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** US DST: 2:00 second Sunday of March → 2:00 first Sunday of November.
 *  Date-granular on purpose — a reminder an hour off beats one a day silent. */
function inUsDst(year: number, month1: number, day: number): boolean {
  if (month1 < 3 || month1 > 11) return false;
  if (month1 > 3 && month1 < 11) return true;
  if (month1 === 3) return day >= nthWeekday(year, 3, 0, 2);
  return day < nthWeekday(year, 11, 0, 1);
}

function zoneOffsetMinutes(zone: string, year: number, month1: number, day: number): number | null {
  const z = zone.toLowerCase();
  if (z in FIXED_ZONES) return FIXED_ZONES[z]!;
  const floating = US_FLOATING[z];
  if (floating) return inUsDst(year, month1, day) ? floating[1] : floating[0];
  return null;
}

function offsetSuffix(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

interface TimeParts {
  hour: number;
  minute: number;
  zone: string | null;
}

// The zone token is only trusted immediately after the time — matching known
// abbreviations elsewhere in free text invites false hits.
const ZONE_RE = "(?:\\s*(utc|gmt|bst|cet|cest|ist|est|edt|cst|cdt|mst|mdt|pst|pdt|et|ct|mt|pt)\\b)?";
const TIME_12H = new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)${ZONE_RE}`, "i");
const TIME_24H = new RegExp(`\\b([01]?\\d|2[0-3]):([0-5]\\d)${ZONE_RE}`, "i");

function parseTime(text: string): TimeParts | null {
  const ampm = TIME_12H.exec(text);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (ampm[3]!.toLowerCase() === "pm") hour += 12;
    return { hour, minute: Number(ampm[2] ?? 0), zone: ampm[4]?.toUpperCase() ?? null };
  }
  const h24 = TIME_24H.exec(text);
  if (h24) return { hour: Number(h24[1]), minute: Number(h24[2]), zone: h24[3]?.toUpperCase() ?? null };
  return null;
}

interface DateParts {
  year: number | null;
  month1: number;
  day: number;
}

const MONTH_NAME = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
// "June 12[, 2026]" — US order
const MDY_RE = new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i");
// "12[th] June [2026]" — European order
const DMY_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME}(?:\\s+(\\d{4}))?`, "i");

function parseDate(text: string): DateParts | null {
  const mdy = MDY_RE.exec(text);
  if (mdy) return { year: mdy[3] ? Number(mdy[3]) : null, month1: MONTHS[mdy[1]!.toLowerCase().slice(0, 3)]!, day: Number(mdy[2]) };
  const dmy = DMY_RE.exec(text);
  if (dmy) return { year: dmy[3] ? Number(dmy[3]) : null, month1: MONTHS[dmy[2]!.toLowerCase().slice(0, 3)]!, day: Number(dmy[1]) };
  return null;
}

const WEEKDAY_RE = /\b(mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun)[a-z]*/i;

/** UTC-noon anchor for the reference date — date arithmetic only, no clock. */
function referenceUtc(reference: string | Date): Date | null {
  const iso = reference instanceof Date
    ? `${reference.getFullYear()}-${pad(reference.getMonth() + 1)}-${pad(reference.getDate())}`
    : /^(\d{4}-\d{2}-\d{2})/.exec(reference)?.[1];
  if (!iso) return null;
  const at = Date.parse(`${iso}T12:00:00Z`);
  return Number.isNaN(at) ? null : new Date(at);
}

/**
 * Normalize extracted interview text against the email's date. Returns null
 * when the text carries no usable calendar date — the caller keeps showing the
 * raw text and skips reminders/calendar placement for it.
 */
export function normalizeInterviewDateTime(text: string | null | undefined, reference: string | Date): NormalizedDateTime | null {
  const t = String(text ?? "").trim();
  if (!t) return null;

  // Already machine-shaped ("2026-06-12", "2026-06-12 14:00", "…T14:00") —
  // trust it, just canonicalize the separator.
  const isoShaped = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(t);
  if (isoShaped) {
    const [, y, mo, d, h, mi] = isoShaped;
    if (!h) return { iso: `${y}-${mo}-${d}`, hasTime: false, zone: null };
    return { iso: `${y}-${mo}-${d}T${h}:${mi}:00`, hasTime: true, zone: null };
  }

  const ref = referenceUtc(reference);
  if (!ref) return null;

  const time = parseTime(t);
  let date = parseDate(t);

  if (date && date.year === null) {
    // No year written: the email's year, rolled forward when that reading
    // lands well before the email itself (Dec 20 mail about "January 5").
    const refYear = ref.getUTCFullYear();
    const candidate = Date.parse(`${refYear}-${pad(date.month1)}-${pad(date.day)}T12:00:00Z`);
    const FORTY_FIVE_DAYS = 45 * 24 * 60 * 60 * 1000;
    date = { ...date, year: candidate < ref.getTime() - FORTY_FIVE_DAYS ? refYear + 1 : refYear };
  }

  if (date) {
    // Reject impossible calendar dates ("June 31", "Feb 30") — emitting them
    // would hand consumers an ISO string that Date.parse reads as NaN.
    const check = new Date(Date.UTC(date.year!, date.month1 - 1, date.day));
    if (check.getUTCMonth() !== date.month1 - 1 || check.getUTCDate() !== date.day) return null;
  } else {
    // Weekday-only ("Thursday at 3pm ET") — needs a time to mean a meeting,
    // and lands on that weekday ON or AFTER the email date.
    const wd = WEEKDAY_RE.exec(t);
    if (!wd || !time) return null;
    const target = WEEKDAYS[wd[1]!.toLowerCase()]!;
    const advance = (target - ref.getUTCDay() + 7) % 7;
    const resolved = new Date(ref.getTime() + advance * 24 * 60 * 60 * 1000);
    date = { year: resolved.getUTCFullYear(), month1: resolved.getUTCMonth() + 1, day: resolved.getUTCDate() };
  }

  const day = `${date.year}-${pad(date.month1)}-${pad(date.day)}`;
  if (!time) return { iso: day, hasTime: false, zone: null };

  const offset = time.zone ? zoneOffsetMinutes(time.zone, date.year!, date.month1, date.day) : null;
  return {
    iso: `${day}T${pad(time.hour)}:${pad(time.minute)}:00${offset === null ? "" : offsetSuffix(offset)}`,
    hasTime: true,
    zone: time.zone,
  };
}
