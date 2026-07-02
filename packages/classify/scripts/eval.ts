// eval.ts — the brain's accuracy scoreboard (harness only; no classifier logic).
//
// Runs the labeled corpus (corpus/cases.json) through the SAME functions the unit
// tests exercise and reports per-category and per-language accuracy, so a change
// to the brain is judged by numbers, not vibes. The scoring semantics per category
// are identical to the vitest suites (classify.test.ts / confidence.test.ts /
// role.test.ts / enrich.test.ts) — this script only aggregates them into rates.
//
// Two categories the unit tests did NOT cover, both matching/grouping layer:
//   - "matching":       threads → Application records → boardFromApplications;
//                       asserts distinct employers stay distinct groups (the
//                       ATS-domain bundling bug, Known Issue A).
//   - "imapThreading":  raw mails → threads via the desktop IMAP mapper
//                       (root imap.js mapParsedToThreads); asserts different
//                       companies' mail never merges into one thread.
//
// Usage:
//   pnpm --filter @pipeline/classify eval               # human-readable table
//   pnpm --filter @pipeline/classify eval -- --failures # + dump every failing case
//   pnpm --filter @pipeline/classify eval -- --json     # machine-readable (for diffing runs)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import {
  detectStatus,
  classifyStatus,
  LOW_CONFIDENCE,
  resolveCompany,
  companyFromDomain,
  companyFromSenderName,
  extractRole,
} from "../src/index";
import { cleanRole, resolveCompanySmart, threadsToApplications } from "../src/aggregate";
import { extractInterview, extractCompensation, extractLocation, extractRecruiterContact } from "../src/extract";
import { boardFromApplications, type Thread } from "@pipeline/contracts";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../corpus/cases.json"), "utf8"));

interface Row {
  category: string;
  lang: string;
  label: string; // short case identifier for the failure dump
  expected: string;
  actual: string;
  pass: boolean;
}

const rows: Row[] = [];
const langOf = (c: { lang?: string }): string => c.lang ?? "en";
const show = (v: unknown): string => (v === null || v === undefined ? "null" : typeof v === "string" ? v : JSON.stringify(v));

function record(category: string, c: { lang?: string }, label: string, expected: unknown, actual: unknown, pass: boolean): void {
  rows.push({ category, lang: langOf(c), label, expected: show(expected), actual: show(actual), pass });
}

/* ---- status: detectStatus(text) === expected (same as classify.test.ts) ---- */
for (const c of (corpus.status ?? []) as { text: string; expected: string | null; lang?: string }[]) {
  const actual = detectStatus(c.text);
  record("status", c, c.text.slice(0, 60), c.expected, actual, actual === c.expected);
}

/* ---- confidence: low flag + reason (same as confidence.test.ts) ---- */
for (const c of (corpus.confidence ?? []) as { text: string; low: boolean; reason: string; lang?: string }[]) {
  const r = classifyStatus(c.text);
  const low = r.confidence < LOW_CONFIDENCE;
  const pass = low === c.low && r.reasons.includes(c.reason);
  record("confidence", c, c.text.slice(0, 60), `low=${c.low} reason=${c.reason}`, `low=${low} reasons=${r.reasons.join(",")}`, pass);
}

/* ---- company: resolveCompany(thread).company (parity-gated base resolver) ---- */
type CompanyCase = { domain: string; from: string; subject: string; body: string; expected: string; lang?: string };
const companyThread = (c: CompanyCase): Thread => ({
  threadId: "t",
  domain: c.domain,
  subject: c.subject,
  messages: [{ date: "2026-06-01", from: c.from, body: c.body }],
});
for (const c of (corpus.company ?? []) as CompanyCase[]) {
  const actual = resolveCompany(companyThread(c)).company;
  record("company", c, `${c.domain} :: ${(c.subject || c.from).slice(0, 44)}`, c.expected, actual, actual === c.expected);
  // Additive breakdown: the hosted path's smarter resolver on the same cases.
  const smart = resolveCompanySmart(companyThread(c)).company;
  record("companySmart", c, `${c.domain} :: ${(c.subject || c.from).slice(0, 44)}`, c.expected, smart, smart === c.expected);
}

/* ---- companyFromDomain / companyFromSenderName-null ---- */
for (const c of (corpus.companyFromDomain ?? []) as { domain: string; expected: string; lang?: string }[]) {
  const actual = companyFromDomain(c.domain);
  record("companyFromDomain", c, c.domain, c.expected, actual, actual === c.expected);
}
for (const c of (corpus.companyFromSenderName_null ?? []) as { from: string; lang?: string }[]) {
  const actual = companyFromSenderName(c.from);
  record("companyFromSenderName_null", c, c.from, null, actual, actual === null);
}

/* ---- role: extractRole(subject); roleClean: cleanRole(raw, company) ---- */
for (const c of (corpus.role ?? []) as { subject: string; expected: string; lang?: string }[]) {
  const actual = extractRole(c.subject);
  record("role", c, c.subject.slice(0, 60), c.expected, actual, actual === c.expected);
}
for (const c of (corpus.roleClean ?? []) as { raw: string; company?: string; clean: string; lang?: string }[]) {
  const actual = cleanRole(c.raw, c.company);
  record("roleClean", c, c.raw.slice(0, 60), c.clean, actual, actual === c.clean);
}

/* ---- enrichment (same pass criteria as enrich.test.ts) ---- */
for (const c of (corpus.interview ?? []) as { text: string; null?: boolean; hasDateTime?: boolean; link?: string; hasLink?: boolean; lang?: string }[]) {
  const r = extractInterview(c.text);
  let pass: boolean;
  if (c.null) pass = r === null;
  else
    pass =
      r !== null &&
      (c.link === undefined || r.bookingLink === c.link) &&
      (c.hasLink !== false || r.bookingLink === null) &&
      (r.dateTimeText != null) === !!c.hasDateTime;
  record("interview", c, c.text.slice(0, 60), c.null ? null : `dt=${!!c.hasDateTime} link=${c.link ?? c.hasLink ?? "-"}`, r, pass);
}
for (const c of (corpus.compensation ?? []) as { text: string; null?: boolean; expect?: string; lang?: string }[]) {
  const r = extractCompensation(c.text);
  const pass = c.null ? r === null : r?.text === c.expect;
  record("compensation", c, c.text.slice(0, 60), c.null ? null : c.expect, r?.text ?? null, pass);
}
for (const c of (corpus.location ?? []) as { text: string; null?: boolean; kind?: string; contains?: string; lang?: string }[]) {
  const r = extractLocation(c.text);
  const pass = c.null
    ? r === null
    : r?.kind === c.kind && (c.contains === undefined || (r?.value ?? "").includes(c.contains));
  record("location", c, c.text.slice(0, 60), c.null ? null : `${c.kind}${c.contains ? `~${c.contains}` : ""}`, r, pass);
}
for (const c of (corpus.recruiterContact ?? []) as { text: string; null?: boolean; name?: string; titleContains?: string; email?: string; lang?: string }[]) {
  const r = extractRecruiterContact(c.text);
  let pass: boolean;
  if (c.null) pass = r === null;
  else
    pass =
      r !== null &&
      (c.name === undefined || r.name === c.name) &&
      (c.titleContains === undefined || (r.title ?? "").includes(c.titleContains)) &&
      (c.email === undefined || r.email === c.email);
  record("recruiterContact", c, c.text.slice(0, 60), c.null ? null : `${c.name ?? ""}/${c.titleContains ?? ""}/${c.email ?? ""}`, r, pass);
}

/* ---- matching: distinct employers must stay distinct board groups ----
   Each case reduces its threads through the REAL hosted pipeline
   (threadsToApplications → boardFromApplications) and asserts the group count —
   and, when given, the exact set of group names. Encodes Known Issue A: two
   companies sharing an ATS domain must never bundle into one record. */
type MatchingCase = { name: string; threads: Thread[]; expectGroups: number; expectCompanies?: string[]; lang?: string };
for (const c of (corpus.matching ?? []) as MatchingCase[]) {
  const board = boardFromApplications(threadsToApplications(c.threads), "eval");
  const got = board.groups.map((g) => g.company);
  let pass = board.groups.length === c.expectGroups;
  if (pass && c.expectCompanies) {
    const want = [...c.expectCompanies].map((s) => s.toLowerCase()).sort();
    const have = [...got].map((s) => s.toLowerCase()).sort();
    pass = want.length === have.length && want.every((w, i) => w === have[i]);
  }
  record("matching", c, c.name, `${c.expectGroups} groups${c.expectCompanies ? `: ${c.expectCompanies.join(", ")}` : ""}`, `${board.groups.length} groups: ${got.join(", ")}`, pass);
}

/* ---- imapThreading: the desktop IMAP mapper must not merge companies ----
   Feeds synthesized parsed-mail objects through the real mapParsedToThreads
   (root imap.js) and asserts how many threads come out. */
type ImapCase = { name: string; mails: { from: string; subject: string; date: string; body: string }[]; expectThreads: number; lang?: string };
const imapCases = (corpus.imapThreading ?? []) as ImapCase[];
if (imapCases.length) {
  const require = createRequire(import.meta.url);
  // repo root is three levels up from packages/classify/scripts (same pattern as parity.test.ts)
  const imap = require("../../../imap.js") as { mapParsedToThreads: (list: unknown[]) => { threadId: string }[] };
  for (const c of imapCases) {
    const parsed = c.mails.map((m) => {
      const addr = (m.from.match(/<([^>]+)>/) ?? [, m.from])[1] ?? m.from;
      return { from: { value: [{ address: addr }], text: m.from }, subject: m.subject, date: new Date(m.date), text: m.body };
    });
    const threads = imap.mapParsedToThreads(parsed);
    record("imapThreading", c, c.name, `${c.expectThreads} threads`, `${threads.length} threads`, threads.length === c.expectThreads);
  }
}

/* ---- report ---- */
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const showFailures = args.includes("--failures");

interface Bucket {
  n: number;
  pass: number;
}
const tally = (sel: (r: Row) => string): Map<string, Bucket> => {
  const m = new Map<string, Bucket>();
  for (const r of rows) {
    const k = sel(r);
    const b = m.get(k) ?? { n: 0, pass: 0 };
    b.n += 1;
    if (r.pass) b.pass += 1;
    m.set(k, b);
  }
  return m;
};

const byCategory = tally((r) => r.category);
const byLang = tally((r) => r.lang);
const overall = { n: rows.length, pass: rows.filter((r) => r.pass).length };
const pct = (b: Bucket): string => (b.n ? ((100 * b.pass) / b.n).toFixed(1) + "%" : "—");

if (asJson) {
  const out = {
    overall: { ...overall, accuracy: overall.n ? overall.pass / overall.n : null },
    categories: Object.fromEntries([...byCategory].map(([k, b]) => [k, { ...b, accuracy: b.pass / b.n }])),
    languages: Object.fromEntries([...byLang].map(([k, b]) => [k, { ...b, accuracy: b.pass / b.n }])),
    failures: rows.filter((r) => !r.pass),
  };
  console.log(JSON.stringify(out, null, 2));
} else {
  const w = Math.max(...[...byCategory.keys()].map((k) => k.length), 8);
  console.log(`${"category".padEnd(w)}  ${"n".padStart(4)}  ${"pass".padStart(4)}  ${"fail".padStart(4)}  acc`);
  for (const [k, b] of [...byCategory].sort((a, b2) => a[0].localeCompare(b2[0]))) {
    console.log(`${k.padEnd(w)}  ${String(b.n).padStart(4)}  ${String(b.pass).padStart(4)}  ${String(b.n - b.pass).padStart(4)}  ${pct(b)}`);
  }
  console.log("-".repeat(w + 22));
  console.log(`${"overall".padEnd(w)}  ${String(overall.n).padStart(4)}  ${String(overall.pass).padStart(4)}  ${String(overall.n - overall.pass).padStart(4)}  ${pct(overall)}`);
  console.log("\nby language:");
  for (const [k, b] of [...byLang].sort((a, b2) => a[0].localeCompare(b2[0]))) {
    console.log(`  ${k.padEnd(6)}  ${String(b.n).padStart(4)}  pass ${String(b.pass).padStart(4)}  ${pct(b)}`);
  }
  if (showFailures) {
    const failures = rows.filter((r) => !r.pass);
    console.log(`\nfailures (${failures.length}):`);
    for (const f of failures) {
      console.log(`  [${f.category}/${f.lang}] ${f.label}`);
      console.log(`      expected: ${f.expected}`);
      console.log(`      actual:   ${f.actual}`);
    }
  }
}

// Non-zero exit only on harness misuse (empty corpus), NOT on failures — the eval
// is a scoreboard, not a gate; the unit tests remain the gate.
if (rows.length === 0) {
  console.error("eval: corpus produced zero cases — harness misconfigured");
  process.exit(2);
}
