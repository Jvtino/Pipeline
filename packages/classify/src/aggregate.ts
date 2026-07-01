// Aggregation: reduce a raw thread into the DERIVED Application record the
// product persists (company, role, status, dates, <=600-char snippet). Pure;
// lives next to the classifier because "turn a thread into a record" is the
// classifier's job applied across a whole thread. Shared by the API and the
// sync engine so the live-mail and incremental paths derive identically.
import { resolveCompany, detectStatus, classifyStatus, extractRole, isAtsDomain, companyFromDomain, guessCompanyDomain, acceptCompany, tidy } from "./index";
import {
  extractInterview,
  extractCompensation,
  extractLocation,
  extractRecruiterContact,
  type InterviewInfo,
  type CompensationInfo,
  type LocationInfo,
  type RecruiterContact,
} from "./extract";
import type { Thread, Application, Status, ResolvedCompany } from "@pipeline/contracts";

const byDateAsc = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

/* ----------------------------------------------------------------------------
   SMARTER ATS COMPANY RESOLUTION (hosted/sync path; NOT under the legacy parity
   gate). When many employers share one ATS domain — Workday, Greenhouse, Lever,
   iCIMS, SmartRecruiters… — recover the REAL employer so each position groups
   under its company, not the platform. Layered over resolveCompany(): it only
   adds signals when the base resolver could only echo the platform's own name.
   -------------------------------------------------------------------------- */

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/* ----------------------------------------------------------------------------
   ROLE CLEANUP (TS-only; NOT under the parity gate). extractRole() is left frozen
   in index.ts — this polishes its output for display: strips Re:/Fwd: prefixes,
   requisition/job IDs, work-arrangement modifiers, and a trailing employer name.
   Conservative by design: it only strips KNOWN noise, keeps real parentheticals
   like "Engineer (Platform)", and NEVER empties a title or invents a new one.
   -------------------------------------------------------------------------- */

// Work-arrangement / location tokens that pollute a title but aren't part of it.
const ROLE_NOISE_WORD =
  /^(?:remote|hybrid|on-?site|wfh|us|usa|uk|eu|emea|apac|contract|contractor|full[- ]?time|part[- ]?time|temporary|temp|intern(?:ship)?|permanent|perm|freelance|w2|c2c|\d+\s*(?:openings?|positions?)?)$/i;
// Requisition / job-ID shapes: "Req #12345", "Job ID: R-778", "Posting 4471",
// "Req R-4471". The ID token must contain a digit (so it never eats a plain word).
const REQ_ID_RE = /\b(?:req(?:uisition)?|job|posting|vacancy|ref(?:erence)?)\.?\s*(?:id|code|number|no\.?|#)?\s*[:#-]?\s*[A-Za-z0-9][\w-]*\d[\w-]*\b/gi;
const HASH_ID_RE = /#\s*[A-Za-z0-9][\w-]*\d[\w-]*\b/g;
const RE_FWD_RE = /^\s*(?:re|fwd|fw)\s*:\s*/i;
// A trailing ", Remote" / " Hybrid" arrangement tag (bare country codes excluded —
// too ambiguous as a standalone trailing word; those are only stripped in parens).
const TRAILING_NOISE_RE =
  /[,\s]+(?:remote|hybrid|on-?site|wfh|contract|contractor|full[- ]?time|part[- ]?time|temporary|temp|intern(?:ship)?|permanent|freelance)\s*$/i;

// Strip ONLY parentheticals whose every token is arrangement noise, e.g. "(Remote)"
// or "(Remote, US)". Keeps a meaningful parenthetical such as "(Platform)".
function stripNoiseParens(s: string): string {
  return s.replace(/\s*[([]\s*([^()[\]]*?)\s*[)\]]/g, (m, inner: string) => {
    const tokens = inner.split(/[,/]/).map((t) => t.trim()).filter(Boolean);
    return tokens.length > 0 && tokens.every((t) => ROLE_NOISE_WORD.test(t)) ? " " : m;
  });
}

/**
 * Polish a raw role string into a clean job title. `company`, when known, lets us
 * safely drop a trailing employer segment (we only strip a name we resolved, never
 * a guess). Idempotent; returns the input unchanged if cleaning would empty it.
 */
export function cleanRole(role: string | null | undefined, company?: string | null): string {
  const original = tidy(role);
  let s = original;
  while (RE_FWD_RE.test(s)) s = s.replace(RE_FWD_RE, "");
  s = stripNoiseParens(s);
  s = s.replace(REQ_ID_RE, " ").replace(HASH_ID_RE, " ").replace(/\s{2,}/g, " ").trim();

  // The title is the leading dash/pipe-separated segment; drop trailing segments
  // that match the known employer.
  const parts = s.split(/\s*[—–|]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  const co = (company ?? "").trim().toLowerCase();
  if (co) {
    while (parts.length > 1) {
      const last = parts[parts.length - 1]!.toLowerCase();
      if (last === co || last.startsWith(co + " ") || co.startsWith(last)) parts.pop();
      else break;
    }
  }
  s = parts[0] ?? s;

  let prev = "";
  while (prev !== s) { prev = s; s = s.replace(TRAILING_NOISE_RE, "").trim(); }
  s = s.replace(/[\s,;:–—-]+$/g, "").replace(/\s{2,}/g, " ").trim();

  // Never fabricate: if we stripped it down to nothing meaningful, keep the input.
  return s.length >= 2 ? s : original;
}

// Company slug embedded in an ATS apply/host URL (Workday tenant, Greenhouse/Lever board…).
const APPLY_URL_RES: RegExp[] = [
  /\b([a-z0-9][a-z0-9-]{1,40})\.(?:wd\d+\.)?myworkdayjobs?\.com/i,
  /\b([a-z0-9][a-z0-9-]{1,40})\.(?:wd\d+\.)?myworkday\.com/i,
  /\b([a-z0-9][a-z0-9-]{1,40})\.workday\.com/i,
  /(?:boards|job-boards|jobs)\.greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9][a-z0-9-]{1,40})/i,
  /jobs\.lever\.co\/([a-z0-9][a-z0-9-]{1,40})/i,
  /\b([a-z0-9][a-z0-9-]{1,40})\.(?:applytojob|breezy|recruitee|teamtailor|bamboohr|ashbyhq|workable|jobvite)\.(?:com|hr|io)/i,
  /\b([a-z0-9][a-z0-9-]{1,40})\.smartrecruiters\.com/i,
];

// Sub-domain / slug labels that are the platform's own, never a company.
const GENERIC_HOST_LABEL = new Set([
  "www", "mail", "email", "e", "em", "jobs", "job", "careers", "career", "apply", "applications",
  "no-reply", "noreply", "donotreply", "do-not-reply", "notifications", "notification", "notify",
  "recruiting", "recruitment", "talent", "hr", "people", "app", "my", "secure", "go", "links", "link",
  "click", "track", "info", "hello", "team", "boards", "job-boards",
  "wd1", "wd2", "wd3", "wd4", "wd5", "wd103", "wd501",
  "greenhouse", "lever", "workday", "myworkday", "icims", "ashbyhq", "smartrecruiters", "workable", "jobvite", "indeed", "linkedin",
]);

function companyFromApplyUrl(text: string): string | null {
  for (const re of APPLY_URL_RES) {
    const m = re.exec(text);
    if (m && m[1]) {
      const slug = m[1].toLowerCase();
      if (GENERIC_HOST_LABEL.has(slug)) continue;
      const c = acceptCompany(titleCase(slug));
      if (c) return c;
    }
  }
  return null;
}

// Single subject-noise words that must never be taken as a company name.
const SUBJECT_NOISE_RE = /^(update|status|reminder|confirmation|notification|alert|re|fwd|fw|action|important|hello|hi|welcome|congratulations|next steps?)$/i;

// Subject/body shapes the base resolver doesn't cover: company at the START
// ("Acme — Application Received"), "applying to <Company>", "interest in <Company>",
// "<Company> has received your application", "your application to <Company>".
const SMART_SUBJECT_RES: RegExp[] = [
  /\b(?:appl(?:y|ied|ying|ication)) (?:to|with)\s+([A-Z][A-Za-z0-9&.'\- ]{1,40}?)(?:\s*[-–—(|:]|\s+(?:for|via|has|is)\b|[.!]|\s*$)/,
  /^([A-Z][A-Za-z0-9&.'\- ]{1,40}?)\s*[-–—:|]\s*(?:application|thank you|your application|careers?|recruit|interview|offer|next steps?)/i,
  /\bapplication (?:received|submitted|update|confirmation)[, ]+(?:at|for|by|with)?\s*([A-Z][A-Za-z0-9&.'\- ]{1,40})/i,
];
const SMART_BODY_RES: RegExp[] = [
  /\bthank(?:s| you) for (?:applying to|your (?:interest in|application (?:to|with)))\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/i,
  /\bappl(?:ied|ying) (?:to|with)\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/i,
  /\binterest in (?:joining |working (?:at|for) )?([A-Z][A-Za-z0-9&.'\- ]{1,40})/i,
  /\byour application (?:to|with|at)\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/i,
  /\b([A-Z][A-Za-z0-9&.'\- ]{1,40}?)\s+(?:has received your application|received your application|appreciates your application|is reviewing your application)/,
];

function firstCompanyMatch(res: RegExp[], text: string): string | null {
  for (const re of res) {
    const m = re.exec(text);
    if (m && m[1]) {
      const raw = m[1].replace(/\b(for|as|the|role|position|team|and|we|has|have|is|to|on|careers?)\b.*$/i, "");
      const c = acceptCompany(raw);
      if (c && !SUBJECT_NOISE_RE.test(c)) return c;
    }
  }
  return null;
}

/**
 * Like resolveCompany(), but recovers the employer behind a shared ATS domain
 * when the base resolver could only return the platform's own name.
 */
export function resolveCompanySmart(thread: Pick<Thread, "domain" | "subject" | "messages">): ResolvedCompany {
  const base = resolveCompany(thread);
  const domain = thread?.domain || "";
  if (!isAtsDomain(domain)) return base;

  // Did the base resolver find a REAL employer, or just echo the platform / a
  // garbage email fragment (e.g. "@greenhouse.io" from a sender with no name)?
  const platform = companyFromDomain(domain);
  const baseIsRealEmployer =
    !!base.company &&
    base.company.toLowerCase() !== platform.toLowerCase() &&
    !base.company.includes("@") &&
    !!acceptCompany(base.company);
  if (baseIsRealEmployer) return base;

  const subject = thread?.subject ?? "";
  const msgs = thread?.messages ?? [];
  let found = firstCompanyMatch(SMART_SUBJECT_RES, subject);
  if (!found) for (const m of msgs) { const c = firstCompanyMatch(SMART_BODY_RES, `${subject} ${m.body ?? ""}`); if (c) { found = c; break; } }
  if (!found) for (const m of msgs) { const c = companyFromApplyUrl(`${m.from ?? ""} ${m.body ?? ""}`); if (c) { found = c; break; } }
  // Recovered employer, else a CLEAN platform name (never the garbage base value).
  return found ? { company: found, domain: guessCompanyDomain(found) } : { company: platform, domain };
}

/** Current status of a thread = the latest non-null classification across its messages. */
export function statusForThread(thread: Thread): Status {
  const msgs = [...thread.messages].sort(byDateAsc);
  let status: Status = "applied"; // a thread we have at all has at least been applied to
  for (const m of msgs) {
    const s = detectStatus(thread.subject + " " + m.body);
    if (s) status = s; // walk oldest -> newest; the last decisive signal wins
  }
  return status;
}

/** Reduce one thread to a derived Application record (no raw body persisted).
 *  Company/role/status come from classifyThread(), so the persisted record and the
 *  rich classification can never disagree; `confidence` rides along (additive). */
export function threadToApplication(thread: Thread): Application {
  const c = classifyThread(thread);
  const msgs = [...thread.messages].sort(byDateAsc);
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  return {
    id: thread.threadId,
    threadId: thread.threadId,
    company: c.company.value,
    companyDomain: c.company.domain,
    role: c.role.value,
    status: c.status,
    firstSeen: first?.date ?? "",
    lastActivity: last?.date ?? "",
    snippet: (last?.body ?? "").slice(0, 600),
    confidence: c.confidence,
  };
}

/** Reduce a set of threads to derived Application records (drops empty threads). */
export function threadsToApplications(threads: Thread[]): Application[] {
  return threads.filter((t) => t.messages.length > 0).map(threadToApplication);
}

/* ============================================================================
   RICH THREAD CLASSIFICATION (TS-only; NOT under the parity gate)
   The self-describing result: the same status the board shows, PLUS how sure we
   are and why, PLUS the value-or-null enrichment fields. Low confidence is what
   the UI flags for a human to review. Pure; no persistence, no network.
   ========================================================================== */

// Cold recruiter sourcing that trips the interview cues even though nobody applied.
// Precise inbound-outreach phrases (kept tight so genuine interview invites aren't
// mislabelled as sourcing).
const SOURCING_RE =
  /\b(came across your (?:profile|background|resume|cv|linkedin)|found your (?:profile|resume|background)|your (?:profile|background) (?:stood out|caught (?:my|our) eye)|reach(?:ed|ing) out (?:because|regarding|about|to see)|i(?:'m| am) (?:a |an )?(?:technical |senior )?(?:recruiter|sourcer)\b|(?:sourcing|recruiting) for (?:a|an|our)|thought you(?:'d| would| might) be|saw your (?:profile|background|linkedin))\b/i;
// Evidence an application actually exists (narrow — NOT the broad relevance nets,
// which include recruiter/hiring vocab that cold outreach also carries).
const APPLICATION_EVIDENCE_RE =
  /\b(you (?:have )?applied|your application|thank(?:s| you) for applying|applied (?:to|for)|received your (?:application|cv|resume)|application (?:has been |was |is )?(?:received|submitted|under review|reviewed|on file)|reviewing your application|under review|following up on your (?:application|interview))\b/i;

export interface FieldWithConfidence {
  confidence: number;
}
export interface CompanyField extends FieldWithConfidence {
  value: string;
  domain: string;
  isPlatformFallback: boolean;
}
export interface RoleField extends FieldWithConfidence {
  value: string;
  isGenericFallback: boolean;
}

/** The classifier's rich, self-describing result for a whole thread. */
export interface Classification {
  status: Status;
  confidence: number; // 0..1 overall; low = flag for review
  reasons: string[];
  company: CompanyField;
  role: RoleField;
  interview: InterviewInfo | null;
  compensation: CompensationInfo | null;
  location: LocationInfo | null;
  recruiterContact: RecruiterContact | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function firstField<T>(texts: string[], fn: (t: string) => T | null): T | null {
  for (const t of texts) {
    const r = fn(t);
    if (r) return r;
  }
  return null;
}

/** Is a role string the generic fallback (no real title recovered)? */
function isGenericRole(role: string): boolean {
  const r = role.trim();
  return /^application$/i.test(r) || r.split(/\s+/).length > 7;
}

/**
 * Classify a whole thread into the rich result. `status` is identical to
 * statusForThread() (the persisted label); confidence + reasons + fields are the
 * additive signal. Enrichment fields are value-or-null, never guessed.
 */
export function classifyThread(thread: Thread): Classification {
  const domain = thread.domain || "";
  const subject = thread.subject ?? "";
  const sorted = [...thread.messages].sort(byDateAsc);
  const bodies = sorted.map((m) => m.body ?? "");

  // Status — mirror statusForThread (last decisive message wins) and capture the
  // confidence/reasons of that same decision, so they can never describe a
  // different label than the board shows.
  const status = statusForThread(thread);
  let statusConf = 0.6;
  let statusReasons: string[] = ["default_applied"];
  for (const m of sorted) {
    const r = classifyStatus(subject + " " + (m.body ?? ""));
    if (r.status) {
      statusConf = r.confidence;
      statusReasons = r.reasons;
    }
  }

  // Company — flag the ATS platform-fallback (employer couldn't be recovered).
  const resolved = resolveCompanySmart(thread);
  const isPlatformFallback =
    isAtsDomain(domain) && resolved.company.toLowerCase() === companyFromDomain(domain).toLowerCase();
  const companyConf = isPlatformFallback ? 0.3 : isAtsDomain(domain) ? 0.8 : 0.85;

  // Role — flag the generic fallback ("Application" / echoed subject).
  const roleValue = cleanRole(extractRole(subject), resolved.company);
  const roleGeneric = isGenericRole(roleValue);
  const roleConf = roleGeneric ? 0.35 : 0.85;

  // Cold sourcing — an interview cue with no application evidence anywhere and a
  // non-ATS sender. Only reached by threads that already passed the relevance gate.
  const combined = [subject, ...bodies].join(" \n ");
  const coldSourcing =
    status === "interview" && SOURCING_RE.test(combined) && !APPLICATION_EVIDENCE_RE.test(combined) && !isAtsDomain(domain);

  const reasons = [...statusReasons];
  if (isPlatformFallback) reasons.push("company_platform_fallback");
  if (roleGeneric) reasons.push("role_generic_fallback");
  let confidence = Math.min(statusConf, companyConf, roleConf);
  if (coldSourcing) {
    confidence = Math.min(confidence, 0.3);
    reasons.push("recruiter_sourcing_no_application");
  }

  // Enrichment — newest message first, then subject; first clear hit wins.
  const texts = [...bodies].reverse();
  texts.push(subject);
  return {
    status,
    confidence: round2(confidence),
    reasons,
    company: { value: resolved.company, domain: resolved.domain, confidence: companyConf, isPlatformFallback },
    role: { value: roleValue, confidence: roleConf, isGenericFallback: roleGeneric },
    interview: firstField(texts, extractInterview),
    compensation: firstField(texts, extractCompensation),
    location: firstField(texts, extractLocation),
    recruiterContact: firstField(texts, extractRecruiterContact),
  };
}
