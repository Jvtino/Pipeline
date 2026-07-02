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
export { statusForThread, threadToApplication, threadsToApplications, resolveCompanySmart, classifyThread, cleanRole } from "./aggregate";
export type { Classification, CompanyField, RoleField } from "./aggregate";
export { extractInterview, extractCompensation, extractLocation, extractRecruiterContact } from "./extract";
export type { InterviewInfo, CompensationInfo, LocationInfo, LocationKind, RecruiterContact } from "./extract";

/* ============================================================================
   STATUS CLASSIFIER
   Scored, not first-match: every cue adds points to a status; the highest score
   wins (ties broken by precedence). Robust to mixed-signal emails.
   ========================================================================== */

const OFFER_RE =
  /\b(pleased to offer|happy to offer|delighted to offer|excited to offer|we(?:'?d| would) like to offer|extend(?:ing)? (?:to )?you (?:an|our|a formal) offer|extend(?:ing)? an offer|offer of employment|formal (?:job )?offer|verbal offer|offer letter|employment agreement|appointment letter|official offer|written offer|offer package|acceptance deadline|review and sign|attached offer|offer (?:letter )?(?:is )?attached|(?:contingent|conditional) offer|(?:preparing|drafting) (?:your|an|the) offer|offer is (?:in|pending) approval|moving to (?:the )?offer stage|new hire paperwork|onboarding (?:documents|portal|paperwork|process)|benefits enrollment|i-9|w-4|we(?:'?re| are) (?:thrilled|excited|pleased|delighted) to extend|congratulations[^.]{0,40}\b(offer|join|aboard|team)\b|welcome (?:to the team|aboard)|your (?:start date|compensation package|signing bonus))\b/;
// rejection that contains the word "offer" in a NEGATED form ("unable to offer", "cannot offer you")
const NEG_OFFER_RE =
  /\b(cannot|can'?t|could ?n'?t|unable to|not able to|won'?t be able to|will not be able to|regret(?:tably)?[^.]{0,20})\b[^.]{0,25}\boffer\b/;

const REJECT_RE =
  /\b(unfortunately|we regret|regret to inform|with (?:great |deep |sincere )?regret|we(?:'?ve| have) decided (?:not to|against)|we(?:'?ve| have) decided to (?:move|proceed|go)(?: forward| ahead)? with (?:(?:an)?other|a different)|(?:not|won'?t) be (?:moving|proceeding|progressing) (?:forward|ahead|further)|will not be (?:moving|proceeding|progressing)|mov(?:e|ing) forward with other|other (?:candidates|applicants)|pursu(?:e|ing) other (?:candidates|applicants)|(?:chose(?:n)?|selected|pursu(?:e|ed|ing)) another (?:candidate|applicant)|not (?:be )?(?:selected|shortlisted|successful|progressing|chosen)|not (?:been )?retained|declined your application|application (?:was|has been) declined|removed from consideration|(?:role|position) is no longer available|(?:position|role) has been (?:cancelled|canceled|closed)|unable to proceed|will not proceed|hiring needs have changed|more closely (?:match|align)|position (?:has been|is now) filled|role (?:has been|is now) filled|filled (?:the|this) (?:position|role)|no longer (?:moving|being considered|under consideration)|not (?:to )?(?:proceed|progress) (?:with|further)|different direction|unsuccessful (?:on this occasion|at this time|this time)|wish you (?:the best|well|success|luck)|keep your (?:details|resume|cv) on file|decided to go (?:with|in)|not a (?:fit|match) (?:at this|for this)|won'?t be (?:taking|progressing) your application)\b/;

const INTERVIEW_RE =
  /\b(phone (?:screen|interview|call)|technical (?:screen|interview|phone)|video (?:screen|interview|call)|first (?:round|interview)|final (?:round|interview|stage)|next (?:round|step|steps|stage)|coding (?:challenge|assessment|test|exercise|interview)|(?:online|technical|skills?|hackerrank|codility) assessment|take[- ]?home|invite(?:d|s)? you (?:to|for)|(?:would|we(?:'?d| would)) (?:like|love) to (?:schedule|set up|arrange|invite|meet|speak|chat|connect|talk|have)|schedule (?:a|an|some|your) (?:call|interview|meeting|screen|chat|conversation|time)|set up (?:a|an|some) (?:call|interview|meeting|time|chat)|book (?:a|some) time|find a time|(?:share|provide|confirm|send|let us know) (?:your )?availability|(?:are you|when are you) available|move (?:you )?(?:forward|to the next|ahead)|advanc(?:e|ing) (?:your|to)|progress(?:ing)? (?:your|to the next)|speak (?:with|to) (?:you|the)|meet (?:with )?(?:the|our) (?:team|hiring|manager)|hiring manager|meet the team|on-?site|panel interview|interview (?:invitation|invite|request)|calendly|book (?:a )?(?:slot|call)|calendar invite|invite has been sent|joining details|zoom link|google meet|microsoft teams|teams (?:link|meeting)|dial-?in|conference link|self-?schedul(?:e|ing)|scheduling link|(?:recruiter|talent) screen)\b/;

const APPLIED_RE =
  /\b(thank(?:s| you) for (?:applying|your application|submitting|your interest)|appreciate your (?:interest|application)|application (?:has been |was )?(?:received|submitted|registered)|received your application|we(?:'?ve| have) received your|successfully (?:submitted|applied|received)|your application (?:is|has been|was) (?:received|submitted|under review|being reviewed|in)|(?:currently |now )?(?:under|in) review|reviewing your application|will (?:review|be in touch|get back)|in our (?:system|database)|has been received)\b/;

// Reschedule logistics — an interview being MOVED, not ended. Without this,
// "Unfortunately, we need to reschedule your interview" reads as a rejection
// (lone "unfortunately" is decisive and wins the tie-break). Scored a notch
// ABOVE a lone soft rejection cue; a real rejection in the same mail still wins
// through its own decisive phrase ("position has been filled", …). Bare
// CANCELLATION is deliberately excluded: it isn't progress, and when it comes
// with a closure phrase the rejection must win.
const RESCHEDULE_RE =
  /\b(?:reschedul(?:e|ing|ed)|find (?:another|a new) time|(?:another|an alternative|a new) time for (?:our|your|the)|conflict (?:has )?c[ao]me up|no longer works for (?:us|me)|does .{0,30} work instead|(?:updated|revised) (?:calendar )?invite)\b/;
// Refusing to reschedule is not rescheduling ("we will not be rescheduling").
const NEG_RESCHEDULE_RE = /\b(?:not|won'?t|will not|unable to|cannot|can'?t)(?: be)? reschedul/;

/* Turkish job-mail phrasings — high-precision renderings of the standard
   ATS/LinkedIn/kurumsal templates ("maalesef … olumsuz", "başvurunuz alınmıştır",
   "mülakata davet", "iş teklifi"). Substring-matched: \b is unreliable next to
   non-ASCII letters in JS regex. Kept deliberately small; negation handling and
   broader coverage wait for real misclassified mail in the corpus. */
const TR_REJECT_RE = /(maalesef|ne yazık ki|olumsuz (?:bir karar|sonuçlan|değerlendir)|olumlu sonuçlanmad|başka bir aday)/;
const TR_INTERVIEW_RE = /(mülakat|görüşmeye davet|telefon görüşmesi|değerlendirme merkezi)/;
const TR_APPLIED_RE = /(başvurunuz (?:başarıyla )?(?:alınmış|alındı|iletil)|başvurunuzu aldık|değerlendirmeye alınmış|başvurunuz için teşekkür)/;
const TR_OFFER_RE = /(i̇?ş teklifi|teklif mektubu)/;

// Precedence used to break score ties — the EARLIER status wins. detectStatus()
// and classifyStatus() must argmax over this exact order (strict `>`), or their
// labels drift apart and the parity gate breaks.
const STATUS_PRECEDENCE = ["offer", "rejected", "interview", "applied"] as const;

// Strong, decisive phrases score high (8-10); weak single-word cues score low
// (1-2) so they only decide when nothing stronger fired. Threshold above which a
// status is "strongly" supported (i.e. a decisive phrase, not just a weak cue).
const STRONG_SCORE = 3;

/**
 * The raw status score map — the SINGLE place the scoring rules live. Kept
 * separate from the argmax so classifyStatus() can surface the confidence signal
 * detectStatus() otherwise discards. Pure; TS-only (not part of the parity gate).
 */
export function scoreStatus(text: string | null | undefined): Record<Status, number> {
  const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const score: Record<Status, number> = { offer: 0, rejected: 0, interview: 0, applied: 0 };

  const negOffer = NEG_OFFER_RE.test(t);
  if (OFFER_RE.test(t) && !negOffer) score.offer += 10;
  if (REJECT_RE.test(t)) score.rejected += 10;
  if (negOffer) score.rejected += 10; // "unable to offer you the role" = rejection
  if (INTERVIEW_RE.test(t)) score.interview += 8;
  if (APPLIED_RE.test(t)) score.applied += 5;
  if (RESCHEDULE_RE.test(t) && !NEG_RESCHEDULE_RE.test(t)) score.interview += 10;

  // Turkish templates — same weights as their English counterparts.
  if (TR_OFFER_RE.test(t)) score.offer += 10;
  if (TR_REJECT_RE.test(t)) score.rejected += 10;
  if (TR_INTERVIEW_RE.test(t)) score.interview += 8;
  if (TR_APPLIED_RE.test(t)) score.applied += 5;

  // weak single-word cues — only decide when no stronger phrase fired
  if (/\b(interview|assessment|availability|next steps)\b/.test(t)) score.interview += 2;
  if (/\b(rejected|declined|not selected|competitive applicant pool|difficult decision)\b/.test(t)) score.rejected += 2;
  // "after careful consideration" is a rejection PREAMBLE, not a decision — real
  // rejections carry a decisive phrase of their own, while interview invitations
  // also open with it ("After careful consideration, we'd like to invite you…").
  if (/\bafter (?:careful|much|thorough) (?:consideration|thought|review|deliberation)\b/.test(t)) score.rejected += 2;
  // Background screening is usually POST-offer, but sometimes pre-offer — weak cue only.
  if (/\b(background (?:check|screening)|pre-employment screening)\b/.test(t)) score.offer += 2;
  if (/\b(congratulations|congrats)\b/.test(t)) score.offer += 1;

  return score;
}

/** argmax over the score map with the fixed precedence tie-break; null when all zero. */
function topStatus(score: Record<Status, number>): Status | null {
  let best: Status | null = null;
  let bestScore = 0;
  for (const k of STATUS_PRECEDENCE) {
    if (score[k] > bestScore) {
      best = k;
      bestScore = score[k];
    }
  }
  return best;
}

export function detectStatus(text: string | null | undefined): Status | null {
  return topStatus(scoreStatus(text)); // null when nothing matched (caller keeps the prior status)
}

/* ----------------------------------------------------------------------------
   CONFIDENCE — expose the signal detectStatus() discards (additive; TS-only, not
   part of the parity gate). classifyStatus() returns the SAME label as
   detectStatus() plus how sure we are and why, so callers can flag low-confidence
   results for a human to review (the plan's "unconfirmed" affordance).
   -------------------------------------------------------------------------- */

/** Confidence at/under this is treated as "flag for review". The low band
 *  (weak-cue-only ≈0.35, mixed-signal ≈0.45) sits well below the high band (0.9),
 *  so the exact cut is not sensitive. */
export const LOW_CONFIDENCE = 0.5;

/** A status decision with the confidence (0..1) and the reasons behind it. */
export interface StatusResult {
  status: Status | null;
  confidence: number;
  reasons: string[];
}

/**
 * Like detectStatus(), but also reports HOW sure we are and WHY, computed from
 * the same score map — so `classifyStatus(t).status === detectStatus(t)` for all
 * inputs. Low confidence when only weak single-word cues fired (`weak_cue_only`),
 * or a decisive email also carries a conflicting signal (`mixed_signal`, e.g.
 * "great interview — unfortunately we're moving forward with other candidates").
 */
export function classifyStatus(text: string | null | undefined): StatusResult {
  const score = scoreStatus(text);
  const status = topStatus(score);
  if (!status) return { status: null, confidence: 0, reasons: ["no_signal"] };

  const best = score[status];
  const strong = best >= STRONG_SCORE; // a decisive phrase fired, not just a weak cue
  // Conflicting valence: a progression cue (interview/offer) present alongside a
  // decisive rejection — the label is still correct, but the thread is ambiguous.
  const positive = Math.max(score.interview, score.offer);
  const mixed = strong && positive >= 2 && score.rejected >= STRONG_SCORE;

  const reasons: string[] = [strong ? "strong_phrase" : "weak_cue_only"];
  if (mixed) reasons.push("mixed_signal");

  const confidence = !strong ? 0.35 : mixed ? 0.45 : 0.9;
  return { status, confidence, reasons };
}

/* ============================================================================
   RELEVANCE GATE
   "Is this thread a job application at all?" — needed because some sources hand
   us a whole inbox (Microsoft Graph's inbox delta has no server-side keyword
   filter, unlike the Gmail search query). Without this gate, statusForThread()
   would label EVERY thread "applied" and the board would fill with non-job mail.
   Bias: precise enough not to flood, broad enough not to miss real applications.
   ========================================================================== */

// High-precision application-context phrases (deliberately avoids bare
// "offer"/"role"/"interview" to dodge marketing/transactional false positives).
// Pairs with detectStatus() — which already covers offer/reject/interview/applied
// wording — to add the "this is an application at all" signals it doesn't model.
const JOB_APPLICATION_RE =
  /\b(thank(?:s| you) for (?:applying|your application|your interest in (?:the|our|this|joining|working))|appreciate your (?:interest|application)|your (?:job )?application|received your (?:application|cv|resume)|application (?:has been |was |is )?(?:received|submitted|under review|reviewed|on file)|application (?:id|number|reference|status|portal)|appl(?:ied|ying) (?:for|to)\b|job application|candidacy|candidate (?:for|portal|profile|experience)|recruit(?:er|ing|ment)|talent (?:acquisition|team|partner|community|network)|hiring (?:team|manager|committee|process)|(?:phone|technical|video|onsite|on-site|first|final|hiring)[ -](?:screen|interview|round|manager)|(?:coding|technical|online|skills?) assessment|take[- ]?home (?:assignment|exercise|test)|interview (?:invitation|invite|request|loop|with (?:the|our) team)|(?:would|we(?:'?d| would)) like to (?:schedule|invite|interview|move you)|schedule (?:a|an|your) (?:interview|screen|conversation)|availability (?:for|to) (?:a |an |the )?(?:interview|screen|chat|conversation)|offer of employment|offer letter|pleased to (?:offer|extend)|extend(?:ing)? (?:you )?an offer|moving forward with your (?:application|candidacy)|next steps? (?:in|on) (?:the|your) (?:application|process|interview|candidacy)|regret to inform|not (?:be )?(?:moving|proceeding) forward with your|position (?:has been|is now) filled)\b/i;

// A job-application CONTEXT anchor: application-specific vocabulary a real hiring
// email reliably carries but ordinary inbox mail does not. Deliberately EXCLUDES
// ambient words ("offer", "role", "position", "team", "welcome", "congratulations")
// that show up all over a normal inbox. Used to gate the broad status classifier
// below so it can only vote "relevant" when the mail is actually about a job.
const JOB_CONTEXT_RE =
  /\b(applications?|appl(?:y|ying|ied|icant)|candidacy|candidates?|recruit(?:er|ers|ing|ment)|talent acquisition|hiring (?:team|manager|committee|process)|interviews?|offer of employment|offer letter)\b/i;

// Social / job-board platforms that ALSO send heavy NON-application mail (profile
// views, "people you may know", saved-search digests, connection requests). Unlike
// pure ATS senders — which email almost exclusively about applications — their
// domain alone doesn't imply an application, so we still require a content signal.
const NOISY_JOB_BOARDS = new Set(["linkedin", "indeed", "glassdoor", "ziprecruiter", "wellfound", "angellist"]);

/**
 * Whether a thread looks like a real job application (so it belongs on the board).
 * This is the SINGLE relevance decision applied to every inbox (Gmail + Outlook):
 * the sync engine runs it on each fetched thread regardless of provider.
 *
 * A thread qualifies when: the sender is a pure ATS platform; OR the subject/body
 * carries high-precision application language (JOB_APPLICATION_RE); OR it shows a
 * decisive application OUTCOME (offer/rejection/interview/received) *and* names the
 * hiring context (JOB_CONTEXT_RE).
 *
 * That last clause is why detectStatus() is gated by an anchor rather than trusted
 * on its own: detectStatus is a STATUS classifier meant to run on mail already known
 * to be a job application, so in isolation it fires on ambient words ("unfortunately",
 * "congratulations", "welcome to the team", "we have received your …", "declined").
 * Trusting it directly floods a whole-inbox (Outlook/Graph) sync with hundreds of
 * non-application emails — order receipts, shipping notices, meeting invites, promos.
 */
export function looksLikeJobApplication(thread: Pick<Thread, "domain" | "subject" | "messages">): boolean {
  if (isAtsDomain(thread.domain) && !NOISY_JOB_BOARDS.has(rootName(thread.domain))) return true;
  const subject = thread.subject ?? "";
  if (JOB_APPLICATION_RE.test(subject)) return true;
  for (const m of thread.messages ?? []) {
    const text = `${subject} ${m.body ?? ""}`;
    if (JOB_APPLICATION_RE.test(text)) return true;
    // Broad status signal is admitted ONLY alongside a job-context anchor.
    if (JOB_CONTEXT_RE.test(text) && detectStatus(text)) return true;
  }
  return false;
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

export function acceptCompany(s: string | null | undefined): string | null {
  const c = cleanCompanyName(s);
  if (!c || c.length < 2) return null;
  if (isStopCompany(c) || isPlatformWord(c)) return null;
  return c;
}

// 1) Sender display name — strongest for Greenhouse/Lever/Workday.
export function companyFromSenderName(fromName: string | null | undefined): string | null {
  let s = String(fromName || "").replace(/<[^>]*>/g, " ").trim();
  if (!s) return null;
  if (/@/.test(s)) return null; // bare address, no display name — never a company
  const m = s.match(/^(.+?)\s*[([|]?\s*\bvia\s+\w+/i);
  if (m && m[1] !== undefined) s = m[1];
  return acceptCompany(s);
}

// 1b) Tenant slug in the from-address LOCAL PART — Workday-family platforms
// address mail per employer ("initech@myworkday.com"), so the local part IS the
// company identity even when the display name is just "Workday". Restricted to
// that family: broad platforms (LinkedIn, Indeed, …) use functional mailboxes
// ("jobs-noreply@") that must never be read as an employer.
const TENANT_LOCAL_ROOTS = new Set(["workday", "myworkday", "myworkdayjobs", "myworkdaysite", "workdayjobs"]);
const GENERIC_LOCAL_RE =
  /^(?:no-?reply|do-?not-?reply|noreply|donotreply|notifications?|notify|mailer(?:-daemon)?|postmaster|jobs?|careers?|talent|recruiting|recruitment|hr|info|hello|support|admin|apply|applications?|system|messages?|mail|team|updates?|alerts?|news(?:letter)?|invitations?|security|workday)$/i;

export function companyFromAtsLocalPart(from: string | null | undefined): string | null {
  const m = String(from || "").match(/([A-Za-z0-9][A-Za-z0-9._+-]*)@([A-Za-z0-9.-]+)/);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  if (!TENANT_LOCAL_ROOTS.has(rootName(m[2]))) return null;
  const local = m[1].toLowerCase().replace(/\+.*$/, "");
  if (GENERIC_LOCAL_RE.test(local) || /\d{4,}/.test(local)) return null; // mailbox role or an id, not a name
  const words = local.replace(/[._-]+/g, " ").trim();
  if (!words) return null;
  const pretty = words.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return acceptCompany(pretty);
}

// 2) Subject — preposition-anchored patterns only.
const SUBJECT_PATS = [
  /\bsent to\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+(?:for|via|was|has|on)\b|[.!]|\s*$)/,
  /\bat\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+via\b|[.!]|\s*$)/,
  /\b(?:to|with)\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s+for\b|\s*[-–—(|]|[.!]|\s*$)/,
  /\binterest in (?:working (?:at|for) |joining )?([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|.!]|\s+(?:for|as|has|team)\b|\s*$)/,
  /\b(?:viewed|reviewed) by\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|[.!]|\s*$)/,
  // LinkedIn Turkish: "Başvurunuz Acme şirketine gönderildi / iletildi"
  /başvurunuz\s+(.{1,40}?)\s+(?:şirketine|firmasına)\s+(?:gönderildi|iletildi)/i,
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
  /\b(?:viewed|reviewed) by (?:the (?:hiring )?(?:team|recruiter|manager|employer)(?: at)? )?([A-Z][A-Za-z0-9&.'\- ]{1,40})/,
  /\b(?:application|cv|resume) (?:was |has been )?(?:sent|forwarded|submitted) to\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/,
];

export function companyFromBody(body: string | null | undefined): string | null {
  const b = String(body || "");
  for (const re of BODY_PATS) {
    const m = b.match(re);
    if (m && m[1] !== undefined) {
      const raw = m[1].replace(/\b(for|as|the|role|position|team|and|we|has|have|is|to|on|was|were|will|are|been|being|would|could|should|does|did|do|you|your|our|via|regarding)\b.*$/i, "");
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
      company = companyFromAtsLocalPart(m.from);
      if (company) break;
    }
  }
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
  const mApp = s.match(/\bapplication(?:\s+(?:received|submitted|confirmation|update))?\s*[:\-–—]\s*(.+?)(?:\s+(?:at|with|on)\b.*)?$/i);
  if (mApp && mApp[1]) return tidy(mApp[1]);
  const m2 = s.match(/(.+?) at .+/i);
  if (m2 && m2[1] !== undefined) return tidy(m2[1]);
  if (/\b(application|thank you for|interest in|we (?:have )?received)\b/i.test(s)) return "Application";
  return tidy(s);
}
