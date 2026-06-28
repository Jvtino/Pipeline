// @pipeline/crypto — envelope encryption for secrets at rest.
//
// Mail OAuth tokens are the crown jewels (plan §10). This replaces the desktop
// base64 fallback and the web backend's plaintext chmod-600 JSON with proper
// authenticated envelope encryption:
//
//   - a fresh random 256-bit DATA key (DEK) encrypts the secret (AES-256-GCM)
//   - the MASTER key (KEK) wraps (encrypts) the DEK (AES-256-GCM)
//   - we persist only { wrapped DEK, IVs, auth tags, ciphertext }
//
// In production the master key comes from a KMS / secrets manager; here it is
// loaded from PIPELINE_MASTER_KEY. The envelope design means rotating the master
// key only re-wraps DEKs, never re-encrypts payloads, and a leaked ciphertext is
// useless without the KEK. GCM auth tags make tampering detectable on decrypt.
import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

const VERSION = 1;
const ALG = "aes-256-gcm";
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12; // 96-bit nonce, recommended for GCM

/** Opaque, self-describing ciphertext string (base64url of a small JSON blob). */
export type EncryptedBlob = string;

interface BlobShape {
  v: number;
  wk: string; // wrapped DEK ciphertext
  wi: string; // wrap IV
  wt: string; // wrap auth tag
  di: string; // data IV
  dt: string; // data auth tag
  ct: string; // data ciphertext
}

/** Generate a new base64 master key. Run once; store in your secrets manager. */
export function generateMasterKey(): string {
  return randomBytes(KEY_LEN).toString("base64");
}

/** Load + validate the master key from the environment (base64, 32 bytes). */
export function masterKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const b64 = env.PIPELINE_MASTER_KEY;
  if (!b64) throw new Error("PIPELINE_MASTER_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`PIPELINE_MASTER_KEY must decode to ${KEY_LEN} bytes (got ${key.length})`);
  }
  return key;
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) {
    throw new Error(`key must be a ${KEY_LEN}-byte Buffer`);
  }
}

function aesEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ct, tag: cipher.getAuthTag() };
}

function aesDecrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Envelope-encrypt a UTF-8 string. Output is safe to store as text. */
export function encrypt(plaintext: string, masterKey: Buffer): EncryptedBlob {
  assertKey(masterKey);
  const dek = randomBytes(KEY_LEN);
  try {
    const data = aesEncrypt(dek, Buffer.from(plaintext, "utf8"));
    const wrap = aesEncrypt(masterKey, dek);
    const blob: BlobShape = {
      v: VERSION,
      wk: wrap.ct.toString("base64"),
      wi: wrap.iv.toString("base64"),
      wt: wrap.tag.toString("base64"),
      di: data.iv.toString("base64"),
      dt: data.tag.toString("base64"),
      ct: data.ct.toString("base64"),
    };
    return Buffer.from(JSON.stringify(blob), "utf8").toString("base64url");
  } finally {
    dek.fill(0); // best-effort wipe of the data key from memory
  }
}

/** Decrypt an envelope blob. Throws if the master key is wrong or data was tampered. */
export function decrypt(blob: EncryptedBlob, masterKey: Buffer): string {
  assertKey(masterKey);
  let parsed: BlobShape;
  try {
    parsed = JSON.parse(Buffer.from(blob, "base64url").toString("utf8")) as BlobShape;
  } catch {
    throw new Error("malformed ciphertext blob");
  }
  if (parsed.v !== VERSION) throw new Error(`unsupported ciphertext version ${parsed.v}`);
  const dek = aesDecrypt(
    masterKey,
    Buffer.from(parsed.wi, "base64"),
    Buffer.from(parsed.wk, "base64"),
    Buffer.from(parsed.wt, "base64"),
  );
  try {
    const pt = aesDecrypt(
      dek,
      Buffer.from(parsed.di, "base64"),
      Buffer.from(parsed.ct, "base64"),
      Buffer.from(parsed.dt, "base64"),
    );
    return pt.toString("utf8");
  } finally {
    dek.fill(0);
  }
}

/** Convenience: encrypt/decrypt a JSON-serializable value (e.g. an OAuth token record). */
export function encryptJson(value: unknown, masterKey: Buffer): EncryptedBlob {
  return encrypt(JSON.stringify(value), masterKey);
}

export function decryptJson<T = unknown>(blob: EncryptedBlob, masterKey: Buffer): T {
  return JSON.parse(decrypt(blob, masterKey)) as T;
}

/** True if two byte strings are equal in constant time (for token/secret compares). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
