// Aggregation: reduce a raw thread into the DERIVED Application record the
// product persists (company, role, status, dates, <=600-char snippet). Pure;
// lives next to the classifier because "turn a thread into a record" is the
// classifier's job applied across a whole thread. Shared by the API and the
// sync engine so the live-mail and incremental paths derive identically.
import { resolveCompany, detectStatus, extractRole, isAtsDomain, companyFromDomain, guessCompanyDomain, acceptCompany } from "./index";
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

/** Reduce one thread to a derived Application record (no raw body persisted). */
export function threadToApplication(thread: Thread): Application {
  const { company, domain } = resolveCompanySmart(thread);
  const msgs = [...thread.messages].sort(byDateAsc);
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  return {
    id: thread.threadId,
    threadId: thread.threadId,
    company,
    companyDomain: domain,
    role: extractRole(thread.subject),
    status: statusForThread(thread),
    firstSeen: first?.date ?? "",
    lastActivity: last?.date ?? "",
    snippet: (last?.body ?? "").slice(0, 600),
  };
}

/** Reduce a set of threads to derived Application records (drops empty threads). */
export function threadsToApplications(threads: Thread[]): Application[] {
  return threads.filter((t) => t.messages.length > 0).map(threadToApplication);
}
