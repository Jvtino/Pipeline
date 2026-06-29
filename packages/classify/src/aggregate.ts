// Aggregation: reduce a raw thread into the DERIVED Application record the
// product persists (company, role, status, dates, <=600-char snippet). Pure;
// lives next to the classifier because "turn a thread into a record" is the
// classifier's job applied across a whole thread. Shared by the API and the
// sync engine so the live-mail and incremental paths derive identically.
import { resolveCompany, detectStatus, extractRole, isJobApplication } from "./index";
import type { Thread, Application, Status } from "@pipeline/contracts";

const byDateAsc = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

/**
 * Keep a thread only if it shows REAL application activity (see isJobApplication):
 * a detected status or an explicit "you applied / application submitted"
 * confirmation. This drops job-board alerts and marketing that merely mention
 * application keywords — cleaner than the desktop's keyword-only search.
 */
export function isLikelyApplication(thread: Pick<Thread, "domain" | "subject" | "messages">): boolean {
  const text = thread.subject + " " + thread.messages.map((m) => m.body).join(" ");
  return isJobApplication(text);
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

/** Reduce one thread to a derived Application record + its per-message timeline. */
export function threadToApplication(thread: Thread): Application {
  const { company, domain } = resolveCompany(thread);
  const msgs = [...thread.messages].sort(byDateAsc);
  // Walk oldest→newest, carrying the last decisive status forward; each event
  // records the status in force after its message (mirrors statusForThread).
  let carried: Status = "applied";
  const timeline = msgs.map((m) => {
    const s = detectStatus(thread.subject + " " + m.body);
    if (s) carried = s;
    return { date: m.date, from: m.from, status: carried, snippet: (m.body ?? "").slice(0, 600) };
  });
  const last = timeline[timeline.length - 1];
  return {
    id: thread.threadId,
    threadId: thread.threadId,
    company,
    companyDomain: domain,
    role: extractRole(thread.subject),
    status: last?.status ?? "applied",
    firstSeen: timeline[0]?.date ?? "",
    lastActivity: last?.date ?? "",
    snippet: last?.snippet ?? "",
    timeline,
  };
}

/** Reduce threads to derived Application records, dropping empty threads and
 * mail that isn't a job application (newsletters, account alerts, marketing). */
export function threadsToApplications(threads: Thread[]): Application[] {
  return threads.filter((t) => t.messages.length > 0 && isLikelyApplication(t)).map(threadToApplication);
}
