// Aggregation: reduce raw threads into the DERIVED records the product serves.
// This is the hosted equivalent of the existing app's "Aggregation" layer
// (index.html) — one Application per thread, current status = the latest status
// in the thread, grouped by the real employer. Pure + unit-tested.
import { resolveCompany, detectStatus, extractRole } from "@pipeline/classify";
import type { Thread, Application, Board, CompanyGroup, Status } from "@pipeline/contracts";

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

function latestActivity(g: CompanyGroup): string {
  return g.applications.reduce((max, a) => (a.lastActivity > max ? a.lastActivity : max), "");
}

/** Build the full board payload: applications grouped by employer, plus counts. */
export function buildBoard(threads: Thread[], source: string): Board {
  const apps = threads.filter((t) => t.messages.length > 0).map(threadToApplication);

  const byCompany = new Map<string, CompanyGroup>();
  for (const a of apps) {
    const key = a.company.toLowerCase();
    let group = byCompany.get(key);
    if (!group) {
      group = { company: a.company, domain: a.companyDomain, applications: [] };
      byCompany.set(key, group);
    }
    group.applications.push(a);
  }

  const groups = [...byCompany.values()].sort((x, y) => latestActivity(y).localeCompare(latestActivity(x)));

  const counts = { applied: 0, interview: 0, offer: 0, rejected: 0, total: 0 };
  for (const a of apps) {
    counts[a.status] += 1;
    counts.total += 1;
  }

  return { groups, counts, source };
}
