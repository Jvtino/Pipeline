// Everything the redesigned screens render is derived here from the real Board
// payload (+ the client overlay). The API only knows 4 statuses and a handful of
// fields, so the 7-status board, donut, trend, top-sources, statistics, calendar,
// companies, tasks and "needs you today" nudges are all computed client-side.
import type { Board } from "@pipeline/contracts";
import type { Overlay, UiApplication } from "../types";
import type { UiStatus } from "./status";
import { STATUS, STATUS_ORDER } from "./status";
import { daysBetween, parseIso, shortDate, MONTHS } from "./format";

const STALE_DAYS = 21; // an "applied" record silent this long reads as no-response

/** Map a sender/company domain to the design's source channels. */
export function sourceFromDomain(domain: string): string {
  const d = (domain || "").toLowerCase();
  if (d.includes("linkedin")) return "LinkedIn";
  if (d.includes("indeed")) return "Job board";
  if (d.includes("glassdoor")) return "Glassdoor";
  if (/greenhouse|lever|workday|myworkday|ashby|workable|smartrecruiters|jobvite|icims|breezy|recruitee/.test(d)) return "Company site";
  return "Company site";
}

function nextStepFor(status: UiStatus, daysSince: number | null): string {
  switch (status) {
    case "wishlist":
      return "Apply";
    case "applied":
      return "Awaiting reply";
    case "screening":
      return "Recruiter call";
    case "interview":
      return "Prepare for the interview";
    case "offer":
      return "Review the offer";
    case "no_response":
      return daysSince != null ? `Nudge — quiet ${daysSince} days` : "Consider a nudge";
    case "rejected":
    default:
      return "—";
  }
}

/** Flatten the server board (+ manual overlay apps) into presentation rows. */
export function flattenBoard(board: Board | null, overlay: Overlay, nowMs: number): UiApplication[] {
  const apps: UiApplication[] = [];

  for (const group of board?.groups ?? []) {
    for (const a of group.applications) {
      let status: UiStatus = a.status; // applied | interview | offer | rejected
      const lastMs = parseIso(a.lastActivity);
      const daysSince = Number.isNaN(lastMs) ? null : daysBetween(nowMs, lastMs);
      // Derive "no response" from a stale, un-progressed application.
      if (status === "applied" && daysSince != null && daysSince >= STALE_DAYS) status = "no_response";
      // A user "Move stage" override always wins.
      const ov = overlay.overrides[a.threadId];
      if (ov) status = ov;

      apps.push({
        id: a.threadId,
        threadId: a.threadId,
        company: a.company,
        companyDomain: a.companyDomain,
        role: a.role,
        status,
        appliedIso: a.firstSeen,
        lastActivityIso: a.lastActivity,
        dateLabel: shortDate(a.firstSeen),
        source: sourceFromDomain(a.companyDomain),
        nextStep: nextStepFor(status, daysSince),
        snippet: a.snippet,
        manual: a.manual ?? false,
      });
    }
  }

  for (const m of overlay.manual) {
    let status = m.status;
    const ov = overlay.overrides[m.id];
    if (ov) status = ov;
    apps.push({
      id: m.id,
      threadId: null,
      company: m.company,
      companyDomain: "",
      role: m.role,
      status,
      appliedIso: m.createdIso,
      lastActivityIso: m.createdIso,
      dateLabel: m.dateLabel || shortDate(m.createdIso),
      source: m.source,
      nextStep: nextStepFor(status, 0),
      snippet: "",
      manual: true,
    });
  }

  // Newest activity first (nulls last).
  apps.sort((x, y) => {
    const a = x.lastActivityIso ? parseIso(x.lastActivityIso) : -Infinity;
    const b = y.lastActivityIso ? parseIso(y.lastActivityIso) : -Infinity;
    return b - a;
  });
  return apps;
}

export type Counts = Record<UiStatus | "total", number>;

export function statusCounts(apps: UiApplication[]): Counts {
  const c: Counts = { wishlist: 0, applied: 0, screening: 0, interview: 0, offer: 0, rejected: 0, no_response: 0, total: 0 };
  for (const a of apps) {
    c[a.status] += 1;
    c.total += 1;
  }
  return c;
}

export interface DonutSegment {
  status: UiStatus;
  label: string;
  count: number;
  dash: number;
  offset: number;
  color: string;
}

const DONUT_R = 70;
export const DONUT_C = 2 * Math.PI * DONUT_R; // ≈ 439.82

export function donutSegments(apps: UiApplication[]): { segments: DonutSegment[]; total: number } {
  const counts = statusCounts(apps);
  const total = counts.total;
  let acc = 0;
  const segments: DonutSegment[] = [];
  for (const s of STATUS_ORDER) {
    const count = counts[s];
    if (count === 0) continue;
    const dash = total ? (count / total) * DONUT_C : 0;
    segments.push({ status: s, label: STATUS[s].label, count, dash, offset: -acc, color: STATUS[s].dot });
    acc += dash;
  }
  return { segments, total };
}

export interface Nudge {
  appId: string;
  tag: string;
  color: string;
  bg: string;
  title: string;
  sub: string;
  cta: string;
}

/** Up to three "Needs you today" cards, prioritising decisions > interviews > follow-ups. */
export function buildNudges(apps: UiApplication[], nowMs: number): Nudge[] {
  const out: Nudge[] = [];
  const offer = apps.find((a) => a.status === "offer");
  if (offer) {
    out.push({
      appId: offer.id,
      tag: "Decision",
      color: STATUS.offer.dot,
      bg: "rgba(47,146,102,.13)",
      title: `${offer.company} is waiting on your decision`,
      sub: `${offer.role} · offer · respond soon`,
      cta: "Review offer",
    });
  }
  const interview = apps.find((a) => a.status === "interview");
  if (interview) {
    out.push({
      appId: interview.id,
      tag: "Interview",
      color: STATUS.interview.dot,
      bg: "rgba(192,138,42,.14)",
      title: `Prep for your ${interview.company} interview`,
      sub: `${interview.role} · ${interview.nextStep}`,
      cta: "Open",
    });
  }
  const quiet = apps
    .filter((a) => a.status === "no_response" || a.status === "applied")
    .map((a) => {
      const ms = a.lastActivityIso ? parseIso(a.lastActivityIso) : NaN;
      return { a, days: Number.isNaN(ms) ? 0 : daysBetween(nowMs, ms) };
    })
    .sort((p, q) => q.days - p.days)[0];
  if (quiet && quiet.a.id !== offer?.id && quiet.a.id !== interview?.id) {
    out.push({
      appId: quiet.a.id,
      tag: "Follow-up",
      color: STATUS.rejected.dot,
      bg: "rgba(192,106,87,.13)",
      title: `${quiet.a.company} has been quiet ${quiet.days} days`,
      sub: `${quiet.a.role} · a gentle nudge often helps`,
      cta: "Draft",
    });
  }
  return out.slice(0, 3);
}

export interface SourceBar {
  label: string;
  count: number;
  pct: number;
}

export function topSources(apps: UiApplication[]): SourceBar[] {
  const map = new Map<string, number>();
  for (const a of apps) map.set(a.source, (map.get(a.source) ?? 0) + 1);
  const rows = [...map.entries()].map(([label, count]) => ({ label, count, pct: 0 }));
  rows.sort((a, b) => b.count - a.count);
  const max = rows[0]?.count ?? 1;
  for (const r of rows) r.pct = Math.round((r.count / max) * 100);
  return rows.slice(0, 5);
}

/** Last 6 months of application volume by first-seen month. */
export function trendSeries(apps: UiApplication[], nowMs: number): { labels: string[]; counts: number[] } {
  const now = new Date(nowMs);
  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: MONTHS[d.getUTCMonth()] ?? "", count: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const a of apps) {
    if (!a.appliedIso) continue;
    const ms = parseIso(a.appliedIso);
    if (Number.isNaN(ms)) continue;
    const d = new Date(ms);
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const i = index.get(k);
    if (i != null) {
      const b = buckets[i];
      if (b) b.count += 1;
    }
  }
  return { labels: buckets.map((b) => b.label), counts: buckets.map((b) => b.count) };
}

export interface CompanyCardData {
  company: string;
  sub: string;
  topStatus: UiStatus;
  dots: UiStatus[];
}

export function companyCards(apps: UiApplication[]): CompanyCardData[] {
  const map = new Map<string, UiApplication[]>();
  for (const a of apps) {
    const key = a.company.toLowerCase();
    const arr = map.get(key) ?? [];
    arr.push(a);
    map.set(key, arr);
  }
  return [...map.values()].map((roles) => {
    const first = roles[0] as UiApplication;
    return {
      company: first.company,
      sub: `${roles.length} role${roles.length > 1 ? "s" : ""}`,
      topStatus: first.status,
      dots: roles.map((r) => r.status),
    };
  });
}

export interface DerivedTask {
  id: string;
  appId: string | null;
  label: string;
  coLine: string;
  due: string;
  group: "Today" | "This week" | "Later";
}

/** Tasks derived from the board: offers to answer, interviews to prep, follow-ups. */
export function deriveTasks(apps: UiApplication[], nowMs: number): DerivedTask[] {
  const tasks: DerivedTask[] = [];
  for (const a of apps) {
    const co = a.company;
    if (a.status === "offer") {
      tasks.push({ id: `t-offer-${a.id}`, appId: a.id, label: `Respond to the ${co} offer`, coLine: co, due: "This week", group: "This week" });
    } else if (a.status === "interview") {
      tasks.push({ id: `t-int-${a.id}`, appId: a.id, label: `Prep for the ${co} interview`, coLine: co, due: "Soon", group: "This week" });
    } else if (a.status === "screening") {
      tasks.push({ id: `t-scr-${a.id}`, appId: a.id, label: `Recruiter call with ${co}`, coLine: co, due: "This week", group: "This week" });
    } else if (a.status === "no_response") {
      const ms = a.lastActivityIso ? parseIso(a.lastActivityIso) : NaN;
      const days = Number.isNaN(ms) ? null : daysBetween(nowMs, ms);
      tasks.push({ id: `t-fu-${a.id}`, appId: a.id, label: `Follow up with ${co}`, coLine: days ? `${co} · quiet ${days} days` : co, due: "Today", group: "Today" });
    } else if (a.status === "wishlist") {
      tasks.push({ id: `t-wish-${a.id}`, appId: a.id, label: `Apply to ${co}`, coLine: co, due: "Later", group: "Later" });
    }
  }
  return tasks;
}

export interface CalendarCell {
  day: number | null;
  events: { label: string; fg: string; bg: string; appId: string }[];
}

export function calendarFor(apps: UiApplication[], year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month, 1));
  const startWeekday = first.getUTCDay(); // 0 = Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const byDay = new Map<number, CalendarCell["events"]>();
  for (const a of apps) {
    if (!a.appliedIso) continue;
    const ms = parseIso(a.appliedIso);
    if (Number.isNaN(ms)) continue;
    const d = new Date(ms);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue;
    const day = d.getUTCDate();
    const arr = byDay.get(day) ?? [];
    if (arr.length < 2) {
      const s = STATUS[a.status];
      arr.push({ label: `${a.company} · ${s.label}`, fg: s.fg, bg: s.bg, appId: a.id });
    }
    byDay.set(day, arr);
  }

  const cells: CalendarCell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null, events: [] });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, events: byDay.get(d) ?? [] });
  while (cells.length % 7 !== 0) cells.push({ day: null, events: [] });
  return cells;
}

export interface FunnelStage {
  label: string;
  count: number;
  pct: number; // width relative to applied
  color: string;
}
export interface Stats {
  responseRate: number; // 0..1
  replied: number;
  sent: number;
  health: "broken" | "ok" | "healthy";
  markerPct: number; // 0..100 along the health bar
  funnel: FunnelStage[];
  advance: (number | null)[]; // advance% between consecutive stages (length = funnel-1)
  biggestLeak: { from: string; to: string; drop: number } | null;
  sources: { label: string; replied: number; total: number; rate: number; pct: number }[];
  aging: { buckets: { label: string; count: number; stale: boolean }[]; silent21: number };
  timeToFirstReply: number | null;
  ghostRate: number;
  activePipeline: number;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

export function computeStats(apps: UiApplication[], nowMs: number): Stats {
  const sentApps = apps.filter((a) => a.status !== "wishlist");
  const sent = sentApps.length;
  const repliedStatuses: UiStatus[] = ["screening", "interview", "offer", "rejected"];
  const replied = sentApps.filter((a) => repliedStatuses.includes(a.status)).length;
  const responseRate = sent ? replied / sent : 0;

  const health: Stats["health"] = responseRate < 0.1 ? "broken" : responseRate < 0.25 ? "ok" : "healthy";
  // Map 0–10%→0–20% of the bar, 10–25%→20–50%, 25%+→50–100% (cap at 50% rate).
  let markerPct: number;
  if (responseRate < 0.1) markerPct = (responseRate / 0.1) * 20;
  else if (responseRate < 0.25) markerPct = 20 + ((responseRate - 0.1) / 0.15) * 30;
  else markerPct = 50 + (Math.min(responseRate, 0.5) - 0.25) / 0.25 * 50;
  markerPct = Math.max(2, Math.min(98, markerPct));

  const appliedN = sent;
  const screenN = apps.filter((a) => ["screening", "interview", "offer"].includes(a.status)).length;
  const interviewN = apps.filter((a) => ["interview", "offer"].includes(a.status)).length;
  const offerN = apps.filter((a) => a.status === "offer").length;
  const funnel: FunnelStage[] = [
    { label: "Applied", count: appliedN, pct: 100, color: STATUS.applied.dot },
    { label: "Screen", count: screenN, pct: appliedN ? (screenN / appliedN) * 100 : 0, color: STATUS.screening.dot },
    { label: "Interview", count: interviewN, pct: appliedN ? (interviewN / appliedN) * 100 : 0, color: STATUS.interview.dot },
    { label: "Offer", count: offerN, pct: appliedN ? (offerN / appliedN) * 100 : 0, color: STATUS.offer.dot },
  ];
  const advance: (number | null)[] = [];
  let biggestLeak: Stats["biggestLeak"] = null;
  for (let i = 1; i < funnel.length; i++) {
    const prevStage = funnel[i - 1];
    const curStage = funnel[i];
    if (!prevStage || !curStage) continue;
    const adv = prevStage.count ? curStage.count / prevStage.count : null;
    advance.push(adv);
    if (adv != null) {
      const drop = 1 - adv;
      if (!biggestLeak || drop > biggestLeak.drop) biggestLeak = { from: prevStage.label, to: curStage.label, drop };
    }
  }

  const srcMap = new Map<string, { replied: number; total: number }>();
  for (const a of sentApps) {
    const cur = srcMap.get(a.source) ?? { replied: 0, total: 0 };
    cur.total += 1;
    if (repliedStatuses.includes(a.status)) cur.replied += 1;
    srcMap.set(a.source, cur);
  }
  const sources = [...srcMap.entries()]
    .map(([label, v]) => ({ label, replied: v.replied, total: v.total, rate: v.total ? v.replied / v.total : 0, pct: 0 }))
    .sort((a, b) => b.rate - a.rate);
  const maxRate = sources[0]?.rate || 1;
  for (const s of sources) s.pct = Math.round((s.rate / maxRate) * 100);

  const openStatuses: UiStatus[] = ["applied", "screening", "interview", "no_response"];
  const ages = apps
    .filter((a) => openStatuses.includes(a.status) && a.lastActivityIso)
    .map((a) => daysBetween(nowMs, parseIso(a.lastActivityIso as string)))
    .filter((d) => !Number.isNaN(d) && d >= 0);
  const bucket = (lo: number, hi: number) => ages.filter((d) => d >= lo && d <= hi).length;
  const aging = {
    buckets: [
      { label: "0–7d", count: bucket(0, 7), stale: false },
      { label: "8–20d", count: bucket(8, 20), stale: false },
      { label: "21–40d", count: bucket(21, 40), stale: true },
      { label: "40+d", count: ages.filter((d) => d > 40).length, stale: true },
    ],
    silent21: ages.filter((d) => d >= 21).length,
  };

  const replyTimes = sentApps
    .filter((a) => repliedStatuses.includes(a.status) && a.appliedIso && a.lastActivityIso)
    .map((a) => daysBetween(parseIso(a.lastActivityIso as string), parseIso(a.appliedIso as string)))
    .filter((d) => !Number.isNaN(d) && d >= 0);
  const timeToFirstReply = median(replyTimes);
  const ghostRate = sent ? apps.filter((a) => a.status === "no_response").length / sent : 0;
  const activePipeline = apps.filter((a) => ["applied", "screening", "interview", "offer"].includes(a.status)).length;

  return { responseRate, replied, sent, health, markerPct, funnel, advance, biggestLeak, sources, aging, timeToFirstReply, ghostRate, activePipeline };
}
