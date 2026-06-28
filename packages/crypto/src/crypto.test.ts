import { describe, it, expect } from "vitest";
import {
  generateMasterKey,
  masterKeyFromEnv,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  safeEqual,
} from "./index";

const key = () => Buffer.from(generateMasterKey(), "base64");

describe("@pipeline/crypto envelope encryption", () => {
  it("round-trips a string", () => {
    const k = key();
    const secret = "ya29.a0Af-very-secret-refresh-token";
    expect(decrypt(encrypt(secret, k), k)).toBe(secret);
  });

  it("round-trips a JSON token record", () => {
    const k = key();
    const token = { access_token: "abc", refresh_token: "xyz", expires_in: 3600, obtained_at: 1782600000000 };
    expect(decryptJson(encryptJson(token, k), k)).toEqual(token);
  });

  it("ciphertext leaks neither the plaintext nor the same bytes twice", () => {
    const k = key();
    const secret = "super-secret-token";
    const a = encrypt(secret, k);
    const b = encrypt(secret, k);
    expect(a).not.toBe(b); // random DEK + IV per call
    expect(Buffer.from(a, "base64url").toString("utf8")).not.toContain(secret);
  });

  it("decrypting with the wrong master key fails (does not return plaintext)", () => {
    const blob = encrypt("secret", key());
    expect(() => decrypt(blob, key())).toThrow();
  });

  it("a tampered ciphertext is rejected by the GCM auth tag", () => {
    const k = key();
    const blob = encrypt("secret", k);
    const obj = JSON.parse(Buffer.from(blob, "base64url").toString("utf8"));
    const ctBytes = Buffer.from(obj.ct, "base64");
    ctBytes[0] = ctBytes[0]! ^ 0xff; // flip a bit in the data ciphertext
    obj.ct = ctBytes.toString("base64");
    const tampered = Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
    expect(() => decrypt(tampered, k)).toThrow();
  });

  it("masterKeyFromEnv validates length", () => {
    expect(() => masterKeyFromEnv({ PIPELINE_MASTER_KEY: "" })).toThrow();
    expect(() => masterKeyFromEnv({ PIPELINE_MASTER_KEY: Buffer.alloc(16).toString("base64") })).toThrow();
    const good = generateMasterKey();
    expect(masterKeyFromEnv({ PIPELINE_MASTER_KEY: good }).length).toBe(32);
  });

  it("safeEqual compares correctly", () => {
    expect(safeEqual("token-abc", "token-abc")).toBe(true);
    expect(safeEqual("token-abc", "token-abd")).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});
