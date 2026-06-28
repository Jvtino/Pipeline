// Server-side Pro entitlement gate, shared by all Pro routes. Resolves the
// authenticated user, then their effective plan (DB plan ⊔ valid signed license),
// and 402s anything below Pro. Never trusts a client flag.
import type { FastifyReply, FastifyRequest } from "fastify";
import { getUser, type Database } from "@pipeline/db";
import { requireUser, type AuthUser } from "./auth";
import { effectivePlan, planAtLeast, type Plan } from "./entitlement";

export interface GateDeps {
  db: Database;
  licensePublicKey?: string;
}

export type ProUser = AuthUser & { plan: Plan };

export async function requireProUser(req: FastifyRequest, reply: FastifyReply, deps: GateDeps): Promise<ProUser | null> {
  const authed = requireUser(req, reply);
  if (!authed) return null;
  const user = await getUser(deps.db, authed.id);
  const licenseToken = req.headers["x-pipeline-license"] as string | undefined;
  const plan = effectivePlan(user?.plan ?? "free", { licenseToken, licensePublicKey: deps.licensePublicKey });
  if (!planAtLeast(plan, "pro")) {
    reply.code(402).send({ error: "Pro required", upgrade: true });
    return null;
  }
  return { ...authed, plan };
}
