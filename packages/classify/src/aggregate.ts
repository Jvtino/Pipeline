// Aggregation: reduce a raw thread into the DERIVED Application record the
// product persists (company, role, status, dates, <=600-char snippet). Pure;
// lives next to the classifier because "turn a thread into a record" is the
// classifier's job applied across a whole thread. Shared by the API and the
// sync engine so the live-mail and incremental paths derive identically.
import { resolveCompany, detectStatus, extractRole, matchesApplicationSearch } from "./index";
import type { Thread, Application, Status } from "@pipeline/contracts";

const byDateAsc = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

/**
 * Is this thread a job application — by the SAME test the desktop app uses? The
 * desktop keeps a thread iff its mail search matched (an application keyword or
 * phrase in the subject/body). Mirroring that here keeps the hosted board in sync
 * with the desktop and drops the inbox noise a raw Outlook delta would pull in.
 */
export function isLikelyApplication(thread: Pick<Thread, "domain" | "subject" | "messages">): boolean {
  const text = thread.subject + " " + thread.messages.map((m) => m.body).join(" ");
  return matchesApplicationSearch(text);
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
  const { company, domain } = resolveCompany(thread);
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

/** Reduce threads to derived Application records, dropping empty threads and
 * mail that isn't a job application (newsletters, account alerts, marketing). */
export function threadsToApplications(threads: Thread[]): Application[] {
  return threads.filter((t) => t.messages.length > 0 && isLikelyApplication(t)).map(threadToApplication);
}
