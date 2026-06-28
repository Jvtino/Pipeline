// Entitlement = what the user is allowed to use. The hosted source of truth is
// the user's plan in the DB (set by the billing webhook); a signed @pipeline/license
// token can additionally unlock Pro/Teams offline (the desktop/open-core path).
// Either way, gating is ALWAYS server-side — never a client-trusted flag.
import { verifyLicense } from "@pipeline/license";

export type Plan = "free" | "pro" | "teams";

const RANK: Record<Plan, number> = { free: 0, pro: 1, teams: 2 };

export function planAtLeast(have: Plan, need: Plan): boolean {
  return RANK[have] >= RANK[need];
}

/** Effective plan = the higher of the DB plan and any valid signed license. */
export function effectivePlan(
  userPlan: Plan,
  opts: { licenseToken?: string; licensePublicKey?: string } = {},
): Plan {
  let plan = userPlan;
  if (opts.licenseToken && opts.licensePublicKey) {
    const v = verifyLicense(opts.licensePublicKey, opts.licenseToken);
    if (v.valid && v.claims && RANK[v.claims.plan] > RANK[plan]) plan = v.claims.plan;
  }
  return plan;
}
