#!/usr/bin/env node
// add-case.mjs — grow the golden corpus from a real misclassification, OFFLINE.
// No dependencies, no network, no telemetry: it just reads corpus/cases.json,
// appends one case to the right bucket, and (with --write) saves it back.
//
// The corpus is supposed to grow from real inbox mistakes. When the brain gets
// one wrong, capture it here so a test locks in the fix forever.
//
// Usage (prints the JSON to paste by default; add --write to persist):
//   node scripts/add-case.mjs status       --text "..."     --expected interview
//   node scripts/add-case.mjs role         --subject "..."  --expected "Senior Engineer"
//   node scripts/add-case.mjs roleClean    --raw "SWE (Remote) — Req #12" --company Acme --clean "SWE"
//   node scripts/add-case.mjs confidence   --text "..."     --low true --reason mixed_signal
//   node scripts/add-case.mjs compensation --text "..."     --expect "$120k"
//   node scripts/add-case.mjs location     --text "..."     --kind remote
//   node scripts/add-case.mjs interview    --text "..."     --hasDateTime true --hasLink true
//   node scripts/add-case.mjs recruiterContact --text "..." --name "Jordan Lee" --email j@acme.com
// Flags accept null/true/false/numbers (coerced); everything else stays a string.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KNOWN = new Set([
  "status", "company", "companyFromDomain", "companyFromSenderName_null",
  "role", "roleClean", "confidence", "interview", "compensation", "location", "recruiterContact", "sourcing",
]);

const here = dirname(fileURLToPath(import.meta.url));
const casesPath = join(here, "..", "corpus", "cases.json");

const argv = process.argv.slice(2);
const kind = argv[0];
const write = argv.includes("--write");

if (!kind || kind.startsWith("--")) {
  console.error("Usage: node scripts/add-case.mjs <kind> [--field value ...] [--write]");
  console.error(`Known kinds: ${[...KNOWN].join(", ")}`);
  process.exit(1);
}
if (!KNOWN.has(kind)) {
  console.error(`Unknown kind "${kind}". Known: ${[...KNOWN].join(", ")}`);
  process.exit(1);
}

// Coerce "null"/"true"/"false"/numbers; leave real strings alone.
const coerce = (v) => {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  return v;
};

const theCase = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--write") continue;
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      theCase[key] = true; // bare flag, e.g. --null
    } else {
      theCase[key] = coerce(val);
      i++;
    }
  }
}

if (Object.keys(theCase).length === 0) {
  console.error("No fields given. Example: --text \"...\" --expected interview");
  process.exit(1);
}

const corpus = JSON.parse(readFileSync(casesPath, "utf8"));
if (corpus[kind] !== undefined && !Array.isArray(corpus[kind])) {
  console.error(`Corpus key "${kind}" is not an array; refusing to touch it.`);
  process.exit(1);
}

console.log(`\nCase for "${kind}":\n${JSON.stringify(theCase, null, 2)}`);

if (write) {
  const arr = Array.isArray(corpus[kind]) ? corpus[kind] : (corpus[kind] = []);
  arr.push(theCase);
  writeFileSync(casesPath, JSON.stringify(corpus, null, 2) + "\n", "utf8");
  console.log(`\n✔ Appended to ${kind} in corpus/cases.json (now ${arr.length} cases).`);
  console.log("  Run: pnpm --filter @pipeline/classify test");
} else {
  console.log(`\n(dry run) Re-run with --write to append it to the "${kind}" array in corpus/cases.json,`);
  console.log("or paste the object above into that array yourself. Then run the classify tests.");
}
