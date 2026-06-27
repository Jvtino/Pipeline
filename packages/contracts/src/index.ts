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
