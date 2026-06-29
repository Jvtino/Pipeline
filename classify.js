// classify.js — the "brain": turn raw email text into (a) a status and (b) the
// real employer, even when mail comes through a shared hiring platform (Workday,
// Greenhouse, Lever, LinkedIn, Indeed…). Pure, dependency-free, and shared by the
// web app (index.html), the desktop app, and the Node unit tests (test/classify.test.js).
//
// Works in the browser (functions become globals) AND in Node (module.exports at
// the bottom). Keep it pure — no DOM, no network — so it stays testable.
"use strict";

/* ============================================================================
   STATUS CLASSIFIER
   ----------------------------------------------------------------------------
   Scored, not first-match: every cue adds points to a status; the highest score
   wins (ties broken by precedence). This is far more robust than "first regex
   that matches", because real emails mix signals ("after your interview …
   unfortunately"). Strong, decisive phrases score high; weak single-word cues
   score low so they only matter when nothing stronger is present.
   ========================================================================== */

// rank = how "advanced"/decisive a status is (used when blending subject + body)
const STATUS_RANK = { applied: 1, interview: 2, offer: 3, rejected: 3 };

const OFFER_RE = /\b(pleased to offer|happy to offer|delighted to offer|excited to offer|we(?:'?d| would) like to offer|extend(?:ing)? (?:to )?you (?:an|our|a formal) offer|extend(?:ing)? an offer|offer of employment|formal (?:job )?offer|verbal offer|offer letter|we(?:'?re| are) (?:thrilled|excited|pleased|delighted) to extend|congratulations[^.]{0,40}\b(offer|join|aboard|team)\b|welcome (?:to the team|aboard)|your (?:start date|compensation package|signing bonus))\b/;
// rejection that contains the word "offer" in a NEGATED form ("unable to offer", "cannot offer you")
const NEG_OFFER_RE = /\b(cannot|can'?t|could ?n'?t|unable to|not able to|won'?t be able to|will not be able to|regret(?:tably)?[^.]{0,20})\b[^.]{0,25}\boffer\b/;

const REJECT_RE = /\b(unfortunately|we regret|regret to inform|after (?:careful|much) (?:consideration|thought)|we(?:'?ve| have) decided (?:not to|to (?:move|proceed|go) )|(?:not|won'?t) be (?:moving|proceeding|progressing) (?:forward|ahead|further)|will not be (?:moving|proceeding|progressing)|mov(?:e|ing) forward with other|other (?:candidates|applicants)|pursu(?:e|ing) other (?:candidates|applicants)|not (?:be )?(?:selected|shortlisted|successful|progressing|chosen)|position (?:has been|is now) filled|role (?:has been|is now) filled|filled (?:the|this) (?:position|role)|no longer (?:moving|being considered|under consideration)|not (?:to )?(?:proceed|progress) (?:with|further)|different direction|unsuccessful (?:on this occasion|at this time|this time)|wish you (?:the best|well|success|luck)|keep your (?:details|resume|cv) on file|decided to go (?:with|in)|not a (?:fit|match) (?:at this|for this)|won'?t be (?:taking|progressing) your application)\b/;

const INTERVIEW_RE = /\b(phone (?:screen|interview|call)|technical (?:screen|interview|phone)|video (?:screen|interview|call)|first (?:round|interview)|final (?:round|interview|stage)|next (?:round|step|steps|stage)|coding (?:challenge|assessment|test|exercise|interview)|(?:online|technical|skills?|hackerrank|codility) assessment|take[- ]?home|invite(?:d|s)? you (?:to|for)|(?:would|we(?:'?d| would)) (?:like|love) to (?:schedule|set up|arrange|invite|meet|speak|chat|connect|talk|have)|schedule (?:a|an|some|your) (?:call|interview|meeting|screen|chat|conversation|time)|set up (?:a|an|some) (?:call|interview|meeting|time|chat)|book (?:a|some) time|find a time|(?:share|provide|confirm|send|let us know) (?:your )?availability|(?:are you|when are you) available|move (?:you )?(?:forward|to the next|ahead)|advanc(?:e|ing) (?:your|to)|progress(?:ing)? (?:your|to the next)|speak (?:with|to) (?:you|the)|meet (?:with )?(?:the|our) (?:team|hiring|manager)|hiring manager|meet the team|on-?site|panel interview|interview (?:invitation|invite|request)|calendly|book (?:a )?(?:slot|call))\b/;

const APPLIED_RE = /\b(thank(?:s| you) for (?:applying|your application|submitting|your interest)|appreciate your (?:interest|application)|application (?:has been |was )?(?:received|submitted|registered)|received your application|we(?:'?ve| have) received your|successfully (?:submitted|applied|received)|your application (?:is|has been|was) (?:received|submitted|under review|being reviewed|in)|(?:currently |now )?(?:under|in) review|reviewing your application|will (?:review|be in touch|get back)|in our (?:system|database)|has been received)\b/;

function detectStatus(text) {
  const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const score = { offer: 0, rejected: 0, interview: 0, applied: 0 };

  const negOffer = NEG_OFFER_RE.test(t);
  if (OFFER_RE.test(t) && !negOffer) score.offer += 10;
  if (REJECT_RE.test(t)) score.rejected += 10;
  if (negOffer) score.rejected += 10;          // "unable to offer you the role" = rejection
  if (INTERVIEW_RE.test(t)) score.interview += 8;
  if (APPLIED_RE.test(t)) score.applied += 5;

  // weak single-word cues — only decide when no stronger phrase fired
  if (/\b(interview|assessment|availability|next steps)\b/.test(t)) score.interview += 2;
  if (/\b(rejected|declined|not selected)\b/.test(t)) score.rejected += 2;
  if (/\b(congratulations|congrats)\b/.test(t)) score.offer += 1;

  // pick the highest; precedence offer > rejected > interview > applied on ties
  let best = null, bestScore = 0;
  for (const k of ["offer", "rejected", "interview", "applied"]) {
    if (score[k] > bestScore) { best = k; bestScore = score[k]; }
  }
  return best;   // null when nothing matched (caller keeps the prior status)
}


/* ============================================================================
   COMPANY RESOLUTION
   ----------------------------------------------------------------------------
   For normal mail the sender domain names the company. For Applicant Tracking
   Systems (Greenhouse, Lever, Workday, LinkedIn, Indeed…) the domain names the
   PLATFORM, not the employer — so every company collapses into one. We recover
   the real employer from the sender display-name, the subject, then the body.
   ========================================================================== */

const NAME_MAP = { datadoghq: "Datadog", notion: "Notion", spotify: "Spotify", figma: "Figma",
  vercel: "Vercel", airbnb: "Airbnb", amazon: "Amazon", google: "Google", stripe: "Stripe" };

// Two-level public suffixes, so the registrable label is taken correctly for
// ccTLDs (e.g. "acme.co.uk" → "acme", not "co"; "acme.com.au" → "acme").
const MULTI_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "co.nz", "org.nz", "co.za", "co.in", "co.kr",
  "co.jp", "or.jp", "ne.jp", "com.br", "com.mx", "com.sg", "com.hk", "com.tr", "com.cn", "com.tw",
]);
function rootName(domain) {
  const parts = String(domain || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] || String(domain || "");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_TLDS.has(lastTwo) ? parts[parts.length - 3] : parts[parts.length - 2];
}
function companyFromDomain(domain) {
  const root = rootName(domain);
  return NAME_MAP[root] || root.charAt(0).toUpperCase() + root.slice(1);
}

// ATS / recruiting platforms — mail from these has the real company in the
// sender name / subject / body, NOT in the sender domain.
const ATS_DOMAINS = new Set([
  "greenhouse", "greenhouse-mail", "lever", "workday", "myworkday", "myworkdaysite", "workdayjobs", "myworkdayjobs",
  "linkedin", "jobvite", "icims", "taleo", "smartrecruiters", "ashbyhq",
  "breezy", "recruitee", "workable", "bamboohr", "personio",
  "jazzhr", "successfactors", "dayforce", "rippling", "teamtailor",
  "comeet", "dover", "gem", "jobscore", "freshteam", "zohorecruit",
  "indeed", "glassdoor", "ziprecruiter", "wellfound", "angellist", "hire", "applytojob", "lever-mail",
]);
function isAtsDomain(domain) {
  return ATS_DOMAINS.has(rootName(domain));
}
// Platform brand words that must never be returned as a company name.
const PLATFORM_WORDS = new Set([...ATS_DOMAINS, "workday", "greenhouse", "lever", "linkedin",
  "indeed", "glassdoor", "ashby", "smartrecruiters", "icims", "taleo", "jobvite", "myworkday"]);

function tidy(s) { return String(s || "").replace(/\s+/g, " ").replace(/[\s,;:–—\-]+$/, "").trim(); }

// Strip legal suffixes + recruiting words so the same employer always normalizes
// to the same display name (so its mail groups into one card).
function cleanCompanyName(raw) {
  let s = tidy(raw).replace(/[‘’'"]/g, "");
  // Strip only unambiguous legal forms (keep "Corp"/"Company"/"Co" — they're often
  // part of the brand, e.g. "Umbrella Corp", "Trader Joe's Company").
  s = s.replace(/\b(inc|incorporated|llc|l\.l\.c|ltd|limited|gmbh|plc|s\.?a\.?|pty|ag|b\.?v\.?|n\.?v\.?|s\.?r\.?l)\.?\b/ig, " ");
  s = s.replace(/\b(careers?|recruit(?:ing|ment)?|talent(?: acquisition)?|hiring(?: team)?|jobs?|people(?: team| ops)?|human resources|hr|team|notifications?|no[- ]?reply|do[- ]?not[- ]?reply)\b/ig, " ");
  s = s.replace(/[|•·]+/g, " ").replace(/\s{2,}/g, " ").trim();
  s = s.replace(/^[\s.,'"&|•·\-]+|[\s.,'"&|•·\-]+$/g, "");   // trim stray edge punctuation ("Acme, Inc." → "Acme")
  return s.replace(/\s{2,}/g, " ").trim();
}
function isPlatformWord(s) {
  return String(s || "").toLowerCase().split(/\s+/).some(tok => PLATFORM_WORDS.has(tok));
}
const STOP_COMPANY_RE = /^(the|a|an|us|our|you|your|we|i|me|my|this|that|here|hi|hello|team|info|support|admin|mailer|mail|system|automated|notification|recruiter|recruiting|talent|careers?|jobs?|apply|application|do not reply|donotreply)$/i;
function isStopCompany(s) { return STOP_COMPANY_RE.test(String(s || "").trim()); }

function acceptCompany(s) {
  const c = cleanCompanyName(s);
  if (!c || c.length < 2) return null;
  if (isStopCompany(c) || isPlatformWord(c)) return null;
  return c;
}

// 1) Sender display name — strongest for Greenhouse/Lever/Workday ("Acme via
//    Greenhouse", "Acme Careers", "Acme Talent Acquisition").
function companyFromSenderName(fromName) {
  let s = String(fromName || "").replace(/<[^>]*>/g, " ").trim();   // drop the <email> part
  if (!s) return null;
  const m = s.match(/^(.+?)\s*[\(\[|]?\s*\bvia\s+\w+/i);            // "Acme via Greenhouse"
  if (m) s = m[1];
  return acceptCompany(s);
}

// 2) Subject — handles LinkedIn ("…sent to Acme"), "…at Acme", "…to Acme",
//    "interest in Acme", etc. Only unambiguous, preposition-anchored patterns
//    (so we don't mistake the job title for the company).
const SUBJECT_PATS = [
  /\bsent to\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+(?:for|via|was|has|on)\b|[.!]|\s*$)/,
  /\bat\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+via\b|[.!]|\s*$)/,
  /\b(?:to|with)\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s+for\b|\s*[-–—(|]|[.!]|\s*$)/,
  /\binterest in (?:working (?:at|for) |joining )?([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|.!]|\s+(?:for|as|has|team)\b|\s*$)/,
];
function extractCompanyFromSubject(subject) {
  const s = String(subject || "");
  for (const re of SUBJECT_PATS) {
    const m = s.match(re);
    if (m) { const c = acceptCompany(m[1]); if (c) return c; }
  }
  return null;
}

// 3) Body — last resort, for boards like Indeed that keep the employer out of
//    the subject ("You applied to Acme", "your application to Acme").
const BODY_PATS = [
  /\b(?:applying to|apply to|application (?:to|with)|your application (?:to|with)|applied (?:to|for the .*? at)|thank you for (?:your interest in|applying to)|interested in (?:joining|working at))\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/,
  /\bat\s+([A-Z][A-Za-z0-9&.'\- ]{1,40}?)\s+(?:has been|have|on indeed|team|appreciates|received your)/,
];
function companyFromBody(body) {
  const b = String(body || "");
  for (const re of BODY_PATS) {
    const m = b.match(re);
    if (m) {
      // cut trailing clause words the greedy match may have grabbed
      const raw = m[1].replace(/\b(for|as|the|role|position|team|and|we|has|have|is|to|on)\b.*$/i, "");
      const c = acceptCompany(raw);
      if (c) return c;
    }
  }
  return null;
}

// Best-effort domain guess for logos/grouping when the real domain is an ATS.
function guessCompanyDomain(company) {
  return String(company || "").toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
}

// Resolve the employer for a whole thread → { company, domain }.
function resolveCompany(th) {
  const domain = (th && th.domain) || "";
  if (!isAtsDomain(domain)) {
    return { company: companyFromDomain(domain), domain };
  }
  const msgs = (th && th.messages) || [];
  let company = null;
  for (const m of msgs) { company = companyFromSenderName(m.from); if (company) break; }
  if (!company) company = extractCompanyFromSubject(th.subject);
  if (!company) for (const m of msgs) { company = companyFromBody(m.body); if (company) break; }
  if (company) return { company, domain: guessCompanyDomain(company) };
  // Couldn't identify the employer — fall back to the platform name (rare now).
  return { company: companyFromDomain(domain), domain };
}


/* ============================================================================
   ROLE EXTRACTION  (pull a job title out of a subject line)
   ========================================================================== */
const ROLE_PATS = [
  /application for (?:the )?(.+?) at .+/i,
  /applying (?:to|for) (?:the )?(.+?) at .+/i,
  /application[\s—–-]+(.+?) at .+/i,
  /applying[\s—–-]+(.+?) at .+/i,
  /your application (?:to|for) (?:the )?(.+?) (?:at|was|has|position|role)/i,
];
function extractRole(subject) {
  const s = String(subject || "");
  for (const re of ROLE_PATS) { const m = s.match(re); if (m && m[1]) return tidy(m[1]); }
  // "Indeed Application: Data Analyst" / "Application - Software Engineer"
  const mApp = s.match(/\bapplication\s*[:\-–—]\s*(.+?)(?:\s+(?:at|with|on)\b.*)?$/i);
  if (mApp && mApp[1]) return tidy(mApp[1]);
  const m2 = s.match(/(.+?) at .+/i);
  if (m2) return tidy(m2[1]);
  // Confirmation-style subjects with no role (e.g. "Your application was sent to
  // Acme", "Thank you for your interest in Acme") — show a clean generic label
  // instead of echoing the whole sentence.
  if (/\b(application|thank you for|interest in|we (?:have )?received)\b/i.test(s)) return "Application";
  return tidy(s);
}


// Smarter than the keyword mail-search: keep a thread only if it shows REAL
// application activity — a detected status, or an explicit "you applied /
// application submitted" confirmation. Drops job-board alerts/marketing that
// merely mention keywords. Mirrors @pipeline/classify isJobApplication.
const APPLIED_CONFIRM_RE = /\b(you(?:'ve| have)? applied|applied (?:to|for)|application (?:was |has been |is )?(?:sent|submitted|received|complete|completed|under review)|(?:submitted|completed|finished) (?:your )?application|thank(?:s| you) for applying|received your application)\b/i;
function isJobApplication(text) {
  const t = String(text || "");
  return detectStatus(t) !== null || APPLIED_CONFIRM_RE.test(t);
}

// ---- exports (Node) / globals (browser) ----
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATUS_RANK, detectStatus, isJobApplication,
    rootName, companyFromDomain, isAtsDomain, cleanCompanyName,
    companyFromSenderName, extractCompanyFromSubject, companyFromBody,
    resolveCompany, guessCompanyDomain, extractRole, tidy,
  };
}
