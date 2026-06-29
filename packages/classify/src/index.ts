// @pipeline/classify — the product's "brain", in TypeScript.
//
// Single source of truth for (a) scoring email text into a status and (b)
// resolving the real employer behind an ATS (Greenhouse, Lever, Workday,
// LinkedIn, Indeed, ...). Imported by the hosted web app, the API/workers, and
// the mobile companion (display helpers only) — see the plan §6 (Architecture)
// Decision #5: collapse the duplicated classifier to ONE package.
//
// This is a faithful, behaviour-preserving port of the legacy root classify.js
// (which stays as the FROZEN local/desktop build). A parity test (parity.test.ts)
// asserts this TS port and the legacy JS agree over a golden corpus, so the two
// copies can never silently drift.
//
// Pure and dependency-free at runtime (only type-imports from @pipeline/contracts).
// No DOM, no network — keep it that way so it stays trivially testable.
import type { Status, Thread, Message, ResolvedCompany } from "@pipeline/contracts";

export { STATUS_RANK } from "@pipeline/contracts";
export type { Status, Thread, Message, ResolvedCompany } from "@pipeline/contracts";
export { statusForThread, threadToApplication, threadsToApplications, isLikelyApplication } from "./aggregate";

/* ============================================================================
   STATUS CLASSIFIER
   Scored, not first-match: every cue adds points to a status; the highest score
   wins (ties broken by precedence). Robust to mixed-signal emails.
   ========================================================================== */

const OFFER_RE =
  /\b(pleased to offer|happy to offer|delighted to offer|excited to offer|we(?:'?d| would) like to offer|extend(?:ing)? (?:to )?you (?:an|our|a formal) offer|extend(?:ing)? an offer|offer of employment|formal (?:job )?offer|verbal offer|offer letter|we(?:'?re| are) (?:thrilled|excited|pleased|delighted) to extend|congratulations[^.]{0,40}\b(offer|join|aboard|team)\b|welcome (?:to the team|aboard)|your (?:start date|compensation package|signing bonus))\b/;
// rejection that contains the word "offer" in a NEGATED form ("unable to offer", "cannot offer you")
const NEG_OFFER_RE =
  /\b(cannot|can'?t|could ?n'?t|unable to|not able to|won'?t be able to|will not be able to|regret(?:tably)?[^.]{0,20})\b[^.]{0,25}\boffer\b/;

const REJECT_RE =
  /\b(unfortunately|we regret|regret to inform|after (?:careful|much) (?:consideration|thought)|we(?:'?ve| have) decided (?:not to|to (?:move|proceed|go) )|(?:not|won'?t) be (?:moving|proceeding|progressing) (?:forward|ahead|further)|will not be (?:moving|proceeding|progressing)|mov(?:e|ing) forward with other|other (?:candidates|applicants)|pursu(?:e|ing) other (?:candidates|applicants)|not (?:be )?(?:selected|shortlisted|successful|progressing|chosen)|position (?:has been|is now) filled|role (?:has been|is now) filled|filled (?:the|this) (?:position|role)|no longer (?:moving|being considered|under consideration)|not (?:to )?(?:proceed|progress) (?:with|further)|different direction|unsuccessful (?:on this occasion|at this time|this time)|wish you (?:the best|well|success|luck)|keep your (?:details|resume|cv) on file|decided to go (?:with|in)|not a (?:fit|match) (?:at this|for this)|won'?t be (?:taking|progressing) your application)\b/;

const INTERVIEW_RE =
  /\b(phone (?:screen|interview|call)|technical (?:screen|interview|phone)|video (?:screen|interview|call)|first (?:round|interview)|final (?:round|interview|stage)|next (?:round|step|steps|stage)|coding (?:challenge|assessment|test|exercise|interview)|(?:online|technical|skills?|hackerrank|codility) assessment|take[- ]?home|invite(?:d|s)? you (?:to|for)|(?:would|we(?:'?d| would)) (?:like|love) to (?:schedule|set up|arrange|invite|meet|speak|chat|connect|talk|have)|schedule (?:a|an|some|your) (?:call|interview|meeting|screen|chat|conversation|time)|set up (?:a|an|some) (?:call|interview|meeting|time|chat)|book (?:a|some) time|find a time|(?:share|provide|confirm|send|let us know) (?:your )?availability|(?:are you|when are you) available|move (?:you )?(?:forward|to the next|ahead)|advanc(?:e|ing) (?:your|to)|progress(?:ing)? (?:your|to the next)|speak (?:with|to) (?:you|the)|meet (?:with )?(?:the|our) (?:team|hiring|manager)|hiring manager|meet the team|on-?site|panel interview|interview (?:invitation|invite|request)|calendly|book (?:a )?(?:slot|call))\b/;

const APPLIED_RE =
  /\b(thank(?:s| you) for (?:applying|your application|submitting|your interest)|appreciate your (?:interest|application)|application (?:has been |was )?(?:received|submitted|registered)|received your application|we(?:'?ve| have) received your|successfully (?:submitted|applied|received)|your application (?:is|has been|was) (?:received|submitted|under review|being reviewed|in)|(?:currently |now )?(?:under|in) review|reviewing your application|will (?:review|be in touch|get back)|in our (?:system|database)|has been received)\b/;

export function detectStatus(text: string | null | undefined): Status | null {
  const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const score: Record<Status, number> = { offer: 0, rejected: 0, interview: 0, applied: 0 };

  const negOffer = NEG_OFFER_RE.test(t);
  if (OFFER_RE.test(t) && !negOffer) score.offer += 10;
  if (REJECT_RE.test(t)) score.rejected += 10;
  if (negOffer) score.rejected += 10; // "unable to offer you the role" = rejection
  if (INTERVIEW_RE.test(t)) score.interview += 8;
  if (APPLIED_RE.test(t)) score.applied += 5;

  // weak single-word cues — only decide when no stronger phrase fired
  if (/\b(interview|assessment|availability|next steps)\b/.test(t)) score.interview += 2;
  if (/\b(rejected|declined|not selected)\b/.test(t)) score.rejected += 2;
  if (/\b(congratulations|congrats)\b/.test(t)) score.offer += 1;

  // pick the highest; precedence offer > rejected > interview > applied on ties
  let best: Status | null = null;
  let bestScore = 0;
  for (const k of ["offer", "rejected", "interview", "applied"] as const) {
    if (score[k] > bestScore) {
      best = k;
      bestScore = score[k];
    }
  }
  return best; // null when nothing matched (caller keeps the prior status)
}

/**
 * True when the text carries a STRONG application/recruiting phrase (not just a
 * weak single-word cue). Used to keep marketing and account-notification mail
 * OUT of the board — the Outlook/Graph source pulls the whole inbox, so without
 * this gate every newsletter and "new sign-in" alert becomes an "application".
 */
export function hasApplicationSignal(text: string | null | undefined): boolean {
  const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  return APPLIED_RE.test(t) || INTERVIEW_RE.test(t) || OFFER_RE.test(t) || REJECT_RE.test(t) || NEG_OFFER_RE.test(t);
}

/* ============================================================================
   COMPANY RESOLUTION
   ========================================================================== */

const NAME_MAP: Record<string, string> = {
  datadoghq: "Datadog", notion: "Notion", spotify: "Spotify", figma: "Figma",
  vercel: "Vercel", airbnb: "Airbnb", amazon: "Amazon", google: "Google", stripe: "Stripe",
};

// Two-level public suffixes, so the registrable label is taken correctly for ccTLDs.
const MULTI_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "co.nz", "org.nz", "co.za", "co.in", "co.kr",
  "co.jp", "or.jp", "ne.jp", "com.br", "com.mx", "com.sg", "com.hk", "com.tr", "com.cn", "com.tw",
]);

export function rootName(domain: string | null | undefined): string {
  const parts = String(domain || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] || String(domain || "");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_TLDS.has(lastTwo) ? (parts[parts.length - 3] as string) : (parts[parts.length - 2] as string);
}

export function companyFromDomain(domain: string | null | undefined): string {
  const root = rootName(domain);
  return NAME_MAP[root] || root.charAt(0).toUpperCase() + root.slice(1);
}

// ATS / recruiting platforms — the real company is in the sender name/subject/body.
const ATS_DOMAINS = new Set([
  "greenhouse", "greenhouse-mail", "lever", "workday", "myworkday", "myworkdaysite", "workdayjobs", "myworkdayjobs",
  "linkedin", "jobvite", "icims", "taleo", "smartrecruiters", "ashbyhq",
  "breezy", "recruitee", "workable", "bamboohr", "personio",
  "jazzhr", "successfactors", "dayforce", "rippling", "teamtailor",
  "comeet", "dover", "gem", "jobscore", "freshteam", "zohorecruit",
  "indeed", "glassdoor", "ziprecruiter", "wellfound", "angellist", "hire", "applytojob", "lever-mail",
]);

export function isAtsDomain(domain: string | null | undefined): boolean {
  return ATS_DOMAINS.has(rootName(domain));
}

// Platform brand words that must never be returned as a company name.
const PLATFORM_WORDS = new Set([
  ...ATS_DOMAINS, "workday", "greenhouse", "lever", "linkedin",
  "indeed", "glassdoor", "ashby", "smartrecruiters", "icims", "taleo", "jobvite", "myworkday",
]);

export function tidy(s: string | null | undefined): string {
  return String(s || "").replace(/\s+/g, " ").replace(/[\s,;:–—\-]+$/, "").trim();
}

export function cleanCompanyName(raw: string | null | undefined): string {
  let s = tidy(raw).replace(/[‘’'"]/g, "");
  s = s.replace(/\b(inc|incorporated|llc|l\.l\.c|ltd|limited|gmbh|plc|s\.?a\.?|pty|ag|b\.?v\.?|n\.?v\.?|s\.?r\.?l)\.?\b/gi, " ");
  s = s.replace(/\b(careers?|recruit(?:ing|ment)?|talent(?: acquisition)?|hiring(?: team)?|jobs?|people(?: team| ops)?|human resources|hr|team|notifications?|no[- ]?reply|do[- ]?not[- ]?reply)\b/gi, " ");
  s = s.replace(/[|•·]+/g, " ").replace(/\s{2,}/g, " ").trim();
  s = s.replace(/^[\s.,'"&|•·\-]+|[\s.,'"&|•·\-]+$/g, "");
  return s.replace(/\s{2,}/g, " ").trim();
}

function isPlatformWord(s: string | null | undefined): boolean {
  return String(s || "").toLowerCase().split(/\s+/).some((tok) => PLATFORM_WORDS.has(tok));
}

const STOP_COMPANY_RE =
  /^(the|a|an|us|our|you|your|we|i|me|my|this|that|here|hi|hello|team|info|support|admin|mailer|mail|system|automated|notification|recruiter|recruiting|talent|careers?|jobs?|apply|application|do not reply|donotreply)$/i;

function isStopCompany(s: string | null | undefined): boolean {
  return STOP_COMPANY_RE.test(String(s || "").trim());
}

function acceptCompany(s: string | null | undefined): string | null {
  const c = cleanCompanyName(s);
  if (!c || c.length < 2) return null;
  if (isStopCompany(c) || isPlatformWord(c)) return null;
  return c;
}

// 1) Sender display name — strongest for Greenhouse/Lever/Workday.
export function companyFromSenderName(fromName: string | null | undefined): string | null {
  let s = String(fromName || "").replace(/<[^>]*>/g, " ").trim();
  if (!s) return null;
  const m = s.match(/^(.+?)\s*[([|]?\s*\bvia\s+\w+/i);
  if (m && m[1] !== undefined) s = m[1];
  return acceptCompany(s);
}

// 2) Subject — preposition-anchored patterns only.
const SUBJECT_PATS = [
  /\bsent to\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+(?:for|via|was|has|on)\b|[.!]|\s*$)/,
  /\bat\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+via\b|[.!]|\s*$)/,
  /\b(?:to|with)\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s+for\b|\s*[-–—(|]|[.!]|\s*$)/,
  /\binterest in (?:working (?:at|for) |joining )?([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|.!]|\s+(?:for|as|has|team)\b|\s*$)/,
];

export function extractCompanyFromSubject(subject: string | null | undefined): string | null {
  const s = String(subject || "");
  for (const re of SUBJECT_PATS) {
    const m = s.match(re);
    if (m && m[1] !== undefined) {
      const c = acceptCompany(m[1]);
      if (c) return c;
    }
  }
  return null;
}

// 3) Body — last resort (Indeed etc. keep the employer out of the subject).
const BODY_PATS = [
  /\b(?:applying to|apply to|application (?:to|with)|your application (?:to|with)|applied (?:to|for the .*? at)|thank you for (?:your interest in|applying to)|interested in (?:joining|working at))\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/,
  /\bat\s+([A-Z][A-Za-z0-9&.'\- ]{1,40}?)\s+(?:has been|have|on indeed|team|appreciates|received your)/,
];

export function companyFromBody(body: string | null | undefined): string | null {
  const b = String(body || "");
  for (const re of BODY_PATS) {
    const m = b.match(re);
    if (m && m[1] !== undefined) {
      const raw = m[1].replace(/\b(for|as|the|role|position|team|and|we|has|have|is|to|on)\b.*$/i, "");
      const c = acceptCompany(raw);
      if (c) return c;
    }
  }
  return null;
}

export function guessCompanyDomain(company: string | null | undefined): string {
  return String(company || "").toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
}

/** Resolve the employer for a whole thread → { company, domain }. */
export function resolveCompany(th: Pick<Thread, "domain" | "subject" | "messages"> | null | undefined): ResolvedCompany {
  const domain = (th && th.domain) || "";
  if (!isAtsDomain(domain)) {
    return { company: companyFromDomain(domain), domain };
  }
  const msgs: Message[] = (th && th.messages) || [];
  let company: string | null = null;
  for (const m of msgs) {
    company = companyFromSenderName(m.from);
    if (company) break;
  }
  if (!company) company = extractCompanyFromSubject(th?.subject);
  if (!company) {
    for (const m of msgs) {
      company = companyFromBody(m.body);
      if (company) break;
    }
  }
  if (company) return { company, domain: guessCompanyDomain(company) };
  return { company: companyFromDomain(domain), domain };
}

/* ============================================================================
   ROLE EXTRACTION
   ========================================================================== */
const ROLE_PATS = [
  /application for (?:the )?(.+?) at .+/i,
  /applying (?:to|for) (?:the )?(.+?) at .+/i,
  /application[\s—–-]+(.+?) at .+/i,
  /applying[\s—–-]+(.+?) at .+/i,
  /your application (?:to|for) (?:the )?(.+?) (?:at|was|has|position|role)/i,
];

export function extractRole(subject: string | null | undefined): string {
  const s = String(subject || "");
  for (const re of ROLE_PATS) {
    const m = s.match(re);
    if (m && m[1]) return tidy(m[1]);
  }
  const mApp = s.match(/\bapplication\s*[:\-–—]\s*(.+?)(?:\s+(?:at|with|on)\b.*)?$/i);
  if (mApp && mApp[1]) return tidy(mApp[1]);
  const m2 = s.match(/(.+?) at .+/i);
  if (m2 && m2[1] !== undefined) return tidy(m2[1]);
  if (/\b(application|thank you for|interest in|we (?:have )?received)\b/i.test(s)) return "Application";
  return tidy(s);
}
