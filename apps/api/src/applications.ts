// Aggregation: reduce raw threads into the DERIVED records the product serves.
// This is the hosted equivalent of the existing app's "Aggregation" layer
// (index.html) — one Application per thread, current status = the latest status
// in the thread, grouped by the real employer. Pure + unit-tested.
import { resolveCompany, detectStatus, extractRole } from "@pipeline/classify";
import { boardFromApplications, type Thread, type Application, type Board, type Status } from "@pipeline/contracts";

const byDateAsc = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

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

/** Reduce a set of threads to derived Application records (drops empty threads). */
export function threadsToApplications(threads: Thread[]): Application[] {
  return threads.filter((t) => t.messages.length > 0).map(threadToApplication);
}

/** Build the full board payload from raw threads (classify → derive → group). */
export function buildBoard(threads: Thread[], source: string): Board {
  return boardFromApplications(threadsToApplications(threads), source);
}
