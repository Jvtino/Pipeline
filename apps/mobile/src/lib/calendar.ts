// Calendar derivation — pure and unit-tested. Two event sources, both already
// server-derived: extracted interview date/times (enrichment) and the recorded
// status timeline dates. Grouped into an agenda (newest day first, upcoming
// interviews surfaced separately).
import type { Application, Status } from "@pipeline/contracts";

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM when the source carried one
  threadId: string;
  company: string;
  role: string;
  kind: "interview" | "status";
  status: Status;
}

export interface AgendaDay {
  date: string;
  events: CalendarEvent[];
}

const dayOf = (iso: string): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1]! : null;
};

const timeOf = (iso: string): string | undefined => {
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : undefined;
};

/** Every dated event on the board. Interview events come from the extracted
 *  enrichment; each application also contributes its status milestones. */
export function boardEvents(apps: Application[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const a of apps) {
    const interview = a.enrichment?.interviewDateTime;
    if (interview) {
      const date = dayOf(interview);
      if (date) {
        out.push({ date, time: timeOf(interview), threadId: a.threadId, company: a.company, role: a.role, kind: "interview", status: a.status });
      }
    }
    const activity = dayOf(a.lastActivity);
    if (activity) {
      out.push({ date: activity, threadId: a.threadId, company: a.company, role: a.role, kind: "status", status: a.status });
    }
  }
  return out;
}

/** Agenda grouping, newest day first; interviews sort before status events
 *  within a day, then by time. */
export function agenda(events: CalendarEvent[]): AgendaDay[] {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.date) ?? [];
    list.push(e);
    byDay.set(e.date, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({
      date,
      events: list.sort((x, y) => {
        if (x.kind !== y.kind) return x.kind === "interview" ? -1 : 1;
        return (x.time ?? "").localeCompare(y.time ?? "");
      }),
    }));
}

/** Interviews on or after `today` (YYYY-MM-DD), soonest first. */
export function upcomingInterviews(events: CalendarEvent[], today: string): CalendarEvent[] {
  return events
    .filter((e) => e.kind === "interview" && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

/** The user's LOCAL calendar day as YYYY-MM-DD. Never use toISOString() for
 *  this — that's the UTC day, which flips a "today/tomorrow" label to the
 *  wrong word every evening (west of UTC) or morning (east of it). */
export function localToday(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** "today" / "tomorrow" / "in 5 days" — calendar-day distance, timezone-free
 *  (both sides are YYYY-MM-DD strings). */
export function untilLabel(date: string, today: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
