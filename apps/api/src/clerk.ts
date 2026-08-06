// Bearer identity for mobile (and any non-cookie client): verify a Clerk
// session JWT against the instance's JWKS, then hand back the same
// `{ id, email }` shape the cookie path resolves — the `req.user` seam that
// auth.ts always reserved for a hosted IdP.
//
// Config (all env; absent CLERK_ISSUER leaves bearer auth off entirely):
//   CLERK_ISSUER             https://<instance>.clerk.accounts.dev (no trailing /)
//   CLERK_JWKS_URL           optional override; defaults to `${issuer}/.well-known/jwks.json`
//   CLERK_AUTHORIZED_PARTIES optional comma-separated azp allowlist (the app's origins)
//
// The session token should carry the user's email as an `email` claim (Clerk
// dashboard → Sessions → Customize session token → {"email": "{{user.primary_email_address}}"}).
// Tokens without it still authenticate — the row falls back to a per-subject
// sentinel address so the NOT NULL/UNIQUE email column stays valid.
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthUser } from "./auth";

export interface ClerkConfig {
  issuer: string;
  jwksUrl?: string;
  authorizedParties?: string[];
}

export function clerkConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClerkConfig | null {
  const issuer = env.CLERK_ISSUER?.trim().replace(/\/+$/, "");
  if (!issuer) return null;
  const parties = (env.CLERK_AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    issuer,
    jwksUrl: env.CLERK_JWKS_URL?.trim() || undefined,
    authorizedParties: parties.length ? parties : undefined,
  };
}

/** Resolves an Authorization header to a verified identity, or null. */
export type BearerVerifier = (authorization: string | undefined) => Promise<AuthUser | null>;

type KeySource = Parameters<typeof jwtVerify>[1];

/**
 * Build the verifier. `keySource` is injectable for tests (a local JWKS);
 * production uses the remote JWKS with jose's built-in fetch + cache + rotation.
 * Every failure mode — bad signature, expiry, wrong issuer, foreign azp, missing
 * sub — resolves to null (the request simply stays unauthenticated), never throws.
 */
export function createBearerVerifier(cfg: ClerkConfig, keySource?: KeySource): BearerVerifier {
  const keys: KeySource = keySource ?? createRemoteJWKSet(new URL(cfg.jwksUrl ?? `${cfg.issuer}/.well-known/jwks.json`));
  const parties = cfg.authorizedParties?.length ? new Set(cfg.authorizedParties) : null;

  return async (authorization) => {
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, keys, { issuer: cfg.issuer });
      const sub = typeof payload.sub === "string" ? payload.sub : "";
      if (!sub) return null;
      if (parties) {
        const azp = typeof payload.azp === "string" ? payload.azp : "";
        if (!parties.has(azp)) return null;
      }
      const email = typeof payload.email === "string" && payload.email.includes("@") ? payload.email.toLowerCase() : `${sub}@clerk.local`;
      return { id: sub, email };
    } catch {
      return null;
    }
  };
}
