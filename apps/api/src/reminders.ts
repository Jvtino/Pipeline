// Follow-up nudges (Pro): surface applications that have gone quiet. An application
// still in "applied" (no interview/offer/rejection yet) whose last activity is
// older than the threshold is a candidate to follow up on. Pure + unit-tested.
import type { Application } from "@pipeline/contracts";

export interface Nudge {
  threadId: string;
  company: string;
  role: string;
  lastActivity: string;
  daysSince: number;
  suggestion: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeNudges(apps: Application[], now: number, thresholdDays = 10): Nudge[] {
  const nudges: Nudge[] = [];
  for (const a of apps) {
    if (a.status !== "applied") continue; // only nudge things that haven't progressed
    const last = Date.parse(`${a.lastActivity}T00:00:00Z`);
    if (Number.isNaN(last)) continue;
    const daysSince = Math.floor((now - last) / DAY_MS);
    if (daysSince >= thresholdDays) {
      nudges.push({
        threadId: a.threadId,
        company: a.company,
        role: a.role,
        lastActivity: a.lastActivity,
        daysSince,
        suggestion: `No update from ${a.company} in ${daysSince} days — consider a follow-up.`,
      });
    }
  }
  nudges.sort((x, y) => y.daysSince - x.daysSince);
  return nudges;
}
