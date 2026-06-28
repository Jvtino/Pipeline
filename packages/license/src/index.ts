// @pipeline/license — offline-verifiable license tokens (plan §12 / open-core).
//
// The app embeds only the PUBLIC key and can verify a license with no network
// call; licenses are issued server-side (e.g. a Lemon Squeezy / Paddle webhook)
// with the PRIVATE key. Ed25519: small, fast, deterministic signatures.
//
// Token = base64url(JSON claims) + "." + base64url(signature).
import { generateKeyPairSync, sign, verify } from "node:crypto";

export type LicensedPlan = "pro" | "teams";

export interface LicenseClaims {
  sub: string; // who the license is for (user id / email / order id)
  plan: LicensedPlan;
  iat: number; // issued-at (ms epoch)
  exp?: number; // optional expiry (ms epoch); omit for perpetual
  seats?: number; // Teams seat count
}

export interface VerifyResult {
  valid: boolean;
  claims?: LicenseClaims;
  reason?: string;
}

/** Generate an Ed25519 keypair (PEM). Keep the private key secret; ship the public key in the app. */
export function generateLicenseKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Sign claims into a license token. Run server-side with the private key only. */
export function issueLicense(privateKeyPem: string, claims: LicenseClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(payload), privateKeyPem).toString("base64url"); // Ed25519 → algorithm null
  return `${payload}.${signature}`;
}

/** Verify a license token with the public key. Checks the signature and expiry. */
export function verifyLicense(publicKeyPem: string, token: string, now: number = Date.now()): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0) return { valid: false, reason: "malformed token" };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let ok = false;
  try {
    ok = verify(null, Buffer.from(payload), publicKeyPem, Buffer.from(sig, "base64url"));
  } catch {
    return { valid: false, reason: "bad signature encoding" };
  }
  if (!ok) return { valid: false, reason: "signature mismatch" };

  let claims: LicenseClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LicenseClaims;
  } catch {
    return { valid: false, reason: "bad payload" };
  }
  if (claims.exp && now > claims.exp) return { valid: false, reason: "expired", claims };
  return { valid: true, claims };
}
