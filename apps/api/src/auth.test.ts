import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "./auth";

const secret = "test-session-secret";

describe("session tokens", () => {
  it("round-trips a user", () => {
    const token = signSession(secret, { id: "u@x.com", email: "u@x.com" }, 1000);
    expect(verifySession(secret, token, 2000)).toEqual({ id: "u@x.com", email: "u@x.com" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession(secret, { id: "u@x.com", email: "u@x.com" });
    expect(verifySession("other-secret", token)).toBeNull();
  });

  it("rejects a tampered payload (privilege escalation attempt)", () => {
    const token = signSession(secret, { id: "u@x.com", email: "u@x.com" });
    const forged = Buffer.from(
      JSON.stringify({ id: "admin@x.com", email: "admin@x.com", iat: 0, exp: Date.now() + 1e9 }),
      "utf8",
    ).toString("base64url");
    expect(verifySession(secret, `${forged}.${token.slice(token.indexOf(".") + 1)}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signSession(secret, { id: "u@x.com", email: "u@x.com" }, 1000, 10);
    expect(verifySession(secret, token, 2000)).toBeNull();
  });

  it("returns null on a missing/garbage token", () => {
    expect(verifySession(secret, undefined)).toBeNull();
    expect(verifySession(secret, "garbage")).toBeNull();
  });
});
