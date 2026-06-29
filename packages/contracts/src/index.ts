// @pipeline/contracts — the one definition of Pipeline's data contract.
//
// Every surface (hosted web, mobile companion, the API, the classifier) speaks
// this shape. Today it mirrors the unified thread shape the existing app already
// uses end to end (see classify.js, providers.py, server.py, main.js):
//
//     { threadId, domain, subject, messages: [{ date, from, body }] }
//
// Defining it once as a zod schema means raw -> unified mapping is type-checked
// and runtime-validated at the boundary, instead of trusting whatever a provider
// returned. See docs/Pipeline-Transformation-Plan.md §7 (Data Model) and §6.
import { z } from "zod";

/** The four application states the classifier resolves, in precedence order. */
export const STATUSES = ["applied", "interview", "offer", "rejected"] as const;
export const statusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof statusSchema>;

/**
 * "How advanced / decisive a status is" — used when blending subject + body
 * signals. Mirrors STATUS_RANK in the legacy classify.js.
 */
export const STATUS_RANK: Readonly<Record<Status, number>> = Object.freeze({
  applied: 1,
  interview: 2,
  offer: 3,
  rejected: 3,
});

/** One message in a thread. `body` is a short snippet (<=600 chars), never the full raw email. */
export const messageSchema = z.object({
  date: z.string(), // ISO date (YYYY-MM-DD)
  from: z.string(),
  body: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

/** A mail thread reduced to the unified shape the UI + classifier consume. */
export const threadSchema = z.object({
  threadId: z.string(),
  domain: z.string(),
  subject: z.string(),
  messages: z.array(messageSchema),
});
export type Thread = z.infer<typeof threadSchema>;

/** Result of resolving the real employer behind a thread (handles ATS routing). */
export const resolvedCompanySchema = z.object({
  company: z.string(),
  domain: z.string(),
});
export type ResolvedCompany = z.infer<typeof resolvedCompanySchema>;

/**
 * Validate + normalize an unknown value into a Thread. Throws (zod) on a bad
 * shape — the contract is the law at the boundary, per the plan (§5.6/§8).
 */
export function parseThread(value: unknown): Thread {
  return threadSchema.parse(value);
}

/** Non-throwing variant for places that want to handle invalid input gracefully. */
export function safeParseThread(value: unknown): z.SafeParseReturnType<unknown, Thread> {
  return threadSchema.safeParse(value);
}

/* ----------------------------------------------------------------------------
   DERIVED records — what the hosted product persists and serves (NOT raw mail).
   One Application per thread: company/role/status + dates + a short snippet.
   This is the privacy-preserving "store derived, not raw" shape from plan §7.
   -------------------------------------------------------------------------- */

/** One event in an application's history — a single message, classified. */
export const timelineEventSchema = z.object({
  date: z.string(), // ISO date (YYYY-MM-DD)
  from: z.string(),
  status: statusSchema, // the status in force after this message
  snippet: z.string().max(600),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

/** A single tracked application — one reduced thread. The board's atom. */
export const applicationSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  company: z.string(),
  companyDomain: z.string(),
  role: z.string(),
  status: statusSchema,
  firstSeen: z.string(), // ISO date of the earliest message
  lastActivity: z.string(), // ISO date of the latest message
  snippet: z.string().max(600), // latest message snippet only — never the full body
  timeline: z.array(timelineEventSchema).optional(), // per-message history (click-to-expand)
  manual: z.boolean().optional(),
});
export type Application = z.infer<typeof applicationSchema>;

/** Applications grouped under their employer — the unit the board renders. */
export const companyGroupSchema = z.object({
  company: z.string(),
  domain: z.string(),
  applications: z.array(applicationSchema),
});
export type CompanyGroup = z.infer<typeof companyGroupSchema>;

/** The board read payload returned by GET /api/applications. */
export const boardSchema = z.object({
  groups: z.array(companyGroupSchema),
  counts: z.object({
    applied: z.number(),
    interview: z.number(),
    offer: z.number(),
    rejected: z.number(),
    total: z.number(),
  }),
  source: z.string(), // e.g. "demo" | a connected mailbox label
});
export type Board = z.infer<typeof boardSchema>;

/**
 * Group derived Application records into the board payload (by employer, with
 * counts), newest-active company first. Pure + shared, so the API (reducing live
 * mail) and the DB layer (reading stored records) build the board identically.
 */
export function boardFromApplications(apps: Application[], source: string): Board {
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

  // Within each company, newest activity first (so a card's top rows are the most
  // recent — and a UI that shows only the first few shows the latest).
  for (const g of byCompany.values()) {
    g.applications.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }

  const latest = (g: CompanyGroup): string =>
    g.applications.reduce((max, a) => (a.lastActivity > max ? a.lastActivity : max), "");
  const groups = [...byCompany.values()].sort((x, y) => latest(y).localeCompare(latest(x)));

  const counts = { applied: 0, interview: 0, offer: 0, rejected: 0, total: 0 };
  for (const a of apps) {
    counts[a.status] += 1;
    counts.total += 1;
  }
  return { groups, counts, source };
}
