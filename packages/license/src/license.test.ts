import { describe, it, expect } from "vitest";
import { generateLicenseKeypair, issueLicense, verifyLicense, type LicenseClaims } from "./index";

const kp = generateLicenseKeypair();
const claims: LicenseClaims = { sub: "user-1", plan: "pro", iat: 1_000 };

describe("@pipeline/license (Ed25519)", () => {
  it("issues and verifies a valid license", () => {
    const token = issueLicense(kp.privateKeyPem, claims);
    const v = verifyLicense(kp.publicKeyPem, token);
    expect(v.valid).toBe(true);
    expect(v.claims).toEqual(claims);
  });

  it("rejects a token signed by a different key", () => {
    const other = generateLicenseKeypair();
    const token = issueLicense(other.privateKeyPem, claims);
    expect(verifyLicense(kp.publicKeyPem, token).valid).toBe(false);
  });

  it("rejects a tampered payload (e.g. free → teams escalation)", () => {
    const token = issueLicense(kp.privateKeyPem, claims);
    const forged = Buffer.from(JSON.stringify({ ...claims, plan: "teams", seats: 999 }), "utf8").toString("base64url");
    const tampered = `${forged}.${token.slice(token.indexOf(".") + 1)}`;
    expect(verifyLicense(kp.publicKeyPem, tampered).valid).toBe(false);
  });

  it("rejects an expired license", () => {
    const token = issueLicense(kp.privateKeyPem, { ...claims, exp: 5_000 });
    expect(verifyLicense(kp.publicKeyPem, token, 4_999).valid).toBe(true);
    const v = verifyLicense(kp.publicKeyPem, token, 5_001);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("rejects a malformed token", () => {
    expect(verifyLicense(kp.publicKeyPem, "not-a-token").valid).toBe(false);
    expect(verifyLicense(kp.publicKeyPem, "").valid).toBe(false);
  });
});
