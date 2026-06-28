// PKCE (RFC 7636) — the same flow the desktop app and providers.py use.
import { randomBytes, createHash } from "node:crypto";

export function pkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest().toString("base64url");
}
