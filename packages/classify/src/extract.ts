// Enrichment extractors (TS-only; additive; NOT under the parity gate). Each is
// pure and returns a real value OR null — never a guess. They return the MATCHED
// TEXT (no date/timezone math, no normalized numbers), so a wrong-but-confident
// value is impossible: if the signal isn't clearly there, the answer is null.
import { acceptCompany } from "./index";

/* ============================================================================
   INTERVIEW — explicit date/time text and/or a booking link (Calendly, …).
   Messiest field → bias hard toward null. No timezone math; return what we saw.
   ========================================================================== */

export interface InterviewInfo {
  dateTimeText: string | null;
  bookingLink: string | null;
}

// Dedicated scheduling links only (a generic ATS URL is not a booking link).
const BOOKING_RE =
  /\b(?:https?:\/\/)?(?:[\w-]+\.)*(?:calendly\.com|cal\.com|savvycal\.com|chilipiper\.com|meetings\.hubspot\.com|doodle\.com|when2meet\.com|calendar\.app\.google|book\.morgen\.so)\/[^\s<>()"']+/i;

// Explicit date/time shapes, tried in order; each requires a concrete time or a
// month+day (a bare weekday like "Monday" is too vague and is intentionally missed).
const DATETIME_RES: RegExp[] = [
  // [Weekday,] Month Day [, Year] [at Time TZ]
  /\b(?:(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?!\d)(?:st|nd|rd|th)?(?:,?\s+\d{4})?(?:,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[a-z]{2,4})?)?/i,
  // Day Month [Year] [at Time [TZ]] — European order, 24h time allowed ("12 June at 14:00 CET")
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?(?:,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?(?:\s*[a-z]{2,4}\b)?)?/i,
  // Weekday[,] [at] Time TZ
  /\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[a-z]{2,4})?/i,
  // Weekday[,] [at] 24h time ("Thursday 15:30", "Fri at 09:45 CET")
  /\b(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+(?:at\s+)?(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[a-z]{2,4}\b)?/i,
  // ISO date [time]
  /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?\b/,
  // "at 3:00pm PT"
  /\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[a-z]{2,4})?/i,
  // "at 14:00 CET" — 24h needs the explicit minutes to avoid matching bare counts
  /\bat\s+(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[a-z]{2,4}\b)?/i,
];

export function extractInterview(text: string | null | undefined): InterviewInfo | null {
  const t = String(text || "");
  const link = t.match(BOOKING_RE);
  let dt: string | null = null;
  for (const re of DATETIME_RES) {
    const m = t.match(re);
    if (m) {
      dt = m[0].replace(/\s{2,}/g, " ").replace(/[\s,]+$/, "").trim();
      break;
    }
  }
  const bookingLink = link ? link[0].replace(/[.,;:)\]]+$/, "") : null; // drop trailing sentence punctuation
  if (!dt && !bookingLink) return null;
  return { dateTimeText: dt, bookingLink };
}

/* ============================================================================
   COMPENSATION — currency amounts, ranges, hourly, other currencies. Returns the
   matched substring. Vague phrases ("competitive salary", "DOE") → null.
   ========================================================================== */

export interface CompensationInfo {
  text: string;
}

// A number: thousands-grouped with either separator ("120,000", "70.000") or a
// plain integer with optional decimals ("70", "5.5"). Grouped-first, so the
// European "70.000" is taken whole instead of truncating at "70.00".
const NUM = "(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d{1,2})?)";
const CUR_BEFORE = "(?:[$£€]|\\b(?:USD|GBP|EUR|CAD|AUD|TRY|TL)\\s?)";
const AMOUNT_BEFORE = `${CUR_BEFORE}${NUM}\\s*[kKmM]?`; // "$120k", "USD 120,000"
const AMOUNT_AFTER = `${NUM}\\s*[kKmM]?\\s?(?:USD|EUR|GBP|CAD|AUD|TRY|TL)\\b`; // "130k USD"
// Second half of a range may drop the currency ("$120k–150k") — but a bare
// number then needs thousands-grouping or a k/M suffix, so "and 3 days" can't join.
const RANGE_SECOND = `(?:${AMOUNT_BEFORE}|${AMOUNT_AFTER}|\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d{1,2})?\\s*[kKmM])`;
const COMP_RE = new RegExp(
  `(?:\\b(?:up to|from|starting (?:at|from)|between)\\s+)?` + // qualifier is part of the fact ("up to $150k" ≠ "$150k")
    `(?:${AMOUNT_BEFORE}|${AMOUNT_AFTER})` +
    `(?:\\s*(?:[-–—]|to|and)\\s*${RANGE_SECOND})?` +
    `(?:\\s*(?:\\/|per\\s+)(?:hr|hour|yr|year|annum|month|mo)\\b)?`,
  "i",
);

export function extractCompensation(text: string | null | undefined): CompensationInfo | null {
  const m = String(text || "").match(COMP_RE);
  if (!m) return null; // no concrete amount → "competitive salary"/"DOE" fall through to null
  return { text: m[0].replace(/\s{2,}/g, " ").trim() };
}

/* ============================================================================
   LOCATION — Remote / Hybrid / on-site / "City, ST". Conservative.
   ========================================================================== */

export type LocationKind = "remote" | "hybrid" | "onsite" | "city";
export interface LocationInfo {
  value: string;
  kind: LocationKind;
}

const CITY_ST = /\b([A-Z][a-zA-Z.\-]+(?:\s+[A-Z][a-zA-Z.\-]+)*),\s*([A-Z]{2})\b/;
const IN_CITY = /\b(?:on-?site|based|located|office)\s+(?:in|at)\s+([A-Z][a-zA-Z.\-]+(?:\s+[A-Z][a-zA-Z.\-]+){0,2})/i;

function findCity(text: string): string | null {
  const m = text.match(CITY_ST);
  if (m) return `${m[1]}, ${m[2]}`;
  const n = text.match(IN_CITY);
  if (n && n[1]) return n[1].trim();
  return null;
}

export function extractLocation(text: string | null | undefined): LocationInfo | null {
  const t = String(text || "");
  const city = findCity(t);
  if (/\bhybrid\b/i.test(t)) return { value: city ? `Hybrid · ${city}` : "Hybrid", kind: "hybrid" };
  if (/\b(?:fully\s+|100%\s+)?remote\b/i.test(t)) return { value: "Remote", kind: "remote" };
  if (/\b(?:on-?site|in-office|in the office)\b/i.test(t)) return { value: city ? `On-site · ${city}` : "On-site", kind: "onsite" };
  if (city) return { value: city, kind: "city" };
  return null;
}

/* ============================================================================
   RECRUITER CONTACT — sign-off name + title/email, only when clearly present.
   Highest fabrication risk → require corroboration; bias hard toward null.
   ========================================================================== */

export interface RecruiterContact {
  name: string | null;
  title: string | null;
  email: string | null;
}

const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
// Addresses that are a platform / automated mailbox, never a human recruiter.
const NON_HUMAN_EMAIL =
  /(no-?reply|do-?not-?reply|donotreply|notifications?|mailer|postmaster|support|hello|info|jobs?|careers?|greenhouse|lever|myworkday|workday|icims|smartrecruiters|jobvite|indeed|linkedin|ashby)/i;

const TITLE_RE =
  /\b(?:(?:senior|sr\.?|lead|principal|staff|technical|corporate|global|head\s+of)\s+){0,2}(?:technical\s+)?(?:recruiter|recruiting\s+(?:coordinator|manager|partner|lead)|talent\s+(?:acquisition(?:\s+(?:partner|specialist|manager|lead))?|partner|sourcer|specialist)|sourcer|people\s+(?:operations|partner)|hiring\s+manager|hr\s+(?:manager|partner|coordinator|business\s+partner))\b/i;

const NAME_RE = /^[A-Z][a-z'’.\-]+(?:\s+[A-Z][a-z'’.\-]+){1,2}$/;
const NAME_STOP = /\b(the|our|your|team|hiring|recruit\w*|talent|people|hr|dear|hi|hello|regards|thanks|thank|best|sincerely|cheers|warm)\b/i;

function isName(s: string): boolean {
  return NAME_RE.test(s) && !NAME_STOP.test(s) && !!acceptCompany(s.split(/\s+/)[0]);
}

function findRecruiterEmail(text: string): string | null {
  for (const m of text.matchAll(EMAIL_RE)) {
    if (!NON_HUMAN_EMAIL.test(m[0])) return m[0];
  }
  return null;
}

function findName(text: string, title: string | null): string | null {
  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  // "Name\nTitle" — the line directly above the title line.
  if (title) {
    const ti = lines.findIndex((l) => l.toLowerCase().includes(title.toLowerCase()));
    if (ti > 0 && isName(lines[ti - 1]!)) return lines[ti - 1]!;
  }
  // "Name, Title" / "Name — Recruiter" on one line.
  const inline = text.match(
    /\b([A-Z][a-z'’.\-]+\s+[A-Z][a-z'’.\-]+)\s*[,|–—-]\s*(?=(?:senior|sr\.?|lead|principal|staff|technical|corporate|global|head|recruit|talent|sourcer|people|hiring\s+manager|hr)\b)/i,
  );
  if (inline && isName(inline[1]!)) return inline[1]!;
  // After a sign-off word: "Best,\nJordan Lee".
  const soi = lines.findIndex((l) => /^(?:best|regards|thanks|thank you|sincerely|cheers|warm regards|best regards)[,!.]?$/i.test(l));
  if (soi >= 0 && soi + 1 < lines.length && isName(lines[soi + 1]!)) return lines[soi + 1]!;
  return null;
}

export function extractRecruiterContact(text: string | null | undefined): RecruiterContact | null {
  const t = String(text || "");
  const email = findRecruiterEmail(t);
  const titleMatch = t.match(TITLE_RE);
  const title = titleMatch ? titleMatch[0].replace(/\s{2,}/g, " ").trim() : null;
  const name = findName(t, title);
  // Require corroboration: a human email, or a name paired with a recruiter title.
  if (!email && !(name && title)) return null;
  return { name, title, email };
}
