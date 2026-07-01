// try.ts — feed ONE email to the classifier and print the rich result. Offline.
//
// Run it with tsx (bundled with the API package), from the repo root:
//   pnpm --filter @pipeline/api exec tsx packages/classify/scripts/try.ts
//   pnpm --filter @pipeline/api exec tsx packages/classify/scripts/try.ts \
//     --subject "..." --body "..." [--domain greenhouse.io] [--from "Acme <x@greenhouse.io>"]
import { classifyThread } from "../src/index";
import type { Thread } from "@pipeline/contracts";

const argv = process.argv.slice(2);
const flag = (name: string, def: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : def;
};

const domain = flag("domain", "greenhouse.io");
const from = flag("from", "Acme via Greenhouse <no-reply@greenhouse.io>");
const subject = flag("subject", "Interview scheduled — Data Scientist at Acme");
const body = flag(
  "body",
  "Thank you for applying to Acme. Your interview is confirmed for Tuesday, June 12 at 3:00pm PT. " +
    "Join: https://calendly.com/acme/loop. This role is Remote (US) with a base salary range of $150,000–$180,000.\n" +
    "Best,\nJordan Lee\nSenior Technical Recruiter\njordan.lee@acme.com",
);

const thread: Thread = { threadId: "demo", domain, subject, messages: [{ date: "2026-06-01", from, body }] };
const r = classifyThread(thread);

console.log("\nINPUT");
console.log("  domain :", domain);
console.log("  from   :", from);
console.log("  subject:", subject);
console.log("  body   :", body.replace(/\n/g, " / "));
console.log("\nCLASSIFIER RESULT");
console.log(JSON.stringify(r, null, 2));
console.log(
  `\n${r.confidence < 0.5 ? '⚠︎  LOW CONFIDENCE → would be flagged "needs review"' : "✓  confident"}` +
    `  (confidence ${r.confidence}; reasons: ${r.reasons.join(", ")})\n`,
);
