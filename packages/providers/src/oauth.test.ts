import { describe, it, expect } from "vitest";
import { pkceVerifier, pkceChallenge } from "./pkce";
import {
  buildAuthUrl,
  exchangeCode,
  refresh,
  validAccessToken,
  type HttpTransport,
  type OAuthTokens,
} from "./oauth";

function mockTransport(resp: Record<string, unknown>, capture?: { url: string; form: Record<string, string> }[]): HttpTransport {
  return {
    async postForm(url, form) {
      capture?.push({ url, form });
      return resp;
    },
    async getJson() {
      return {};
    },
  };
}

describe("PKCE", () => {
  it("challenge is deterministic per verifier and base64url", () => {
    const v = "a".repeat(43);
    expect(pkceChallenge(v)).toBe(pkceChallenge(v));
    expect(pkceChallenge(v)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge(pkceVerifier())).not.toBe(pkceChallenge(pkceVerifier()));
  });
});

describe("buildAuthUrl", () => {
  it("builds a Google consent URL with offline access + S256 challenge", () => {
    const url = new URL(buildAuthUrl("google", "cid", "https://app/cb", "chal", "st8"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("cid");
    expect(q.get("redirect_uri")).toBe("https://app/cb");
    expect(q.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(q.get("code_challenge")).toBe("chal");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("state")).toBe("st8");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
  });

  it("builds a Microsoft common-tenant URL with Mail.Read scope", () => {
    const url = new URL(buildAuthUrl("microsoft", "cid", "https://app/cb", "chal", "st8"));
    expect(url.pathname).toContain("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toContain("https://graph.microsoft.com/Mail.Read");
    expect(url.searchParams.get("response_mode")).toBe("query");
  });
});

describe("exchangeCode", () => {
  it("posts an auth_code grant and stamps obtained_at; Google sends a client_secret", async () => {
    const capture: { url: string; form: Record<string, string> }[] = [];
    const transport = mockTransport({ access_token: "AT", refresh_token: "RT", expires_in: 3599 }, capture);
    const tokens = await exchangeCode(
      "google",
      { clientId: "cid", clientSecret: "sec" },
      "https://app/cb",
      "the-code",
      "verifier",
      { transport, now: 1000 },
    );
    expect(tokens.access_token).toBe("AT");
    expect(tokens.obtained_at).toBe(1000);
    const form = capture[0]!.form;
    expect(form.grant_type).toBe("authorization_code");
    expect(form.code).toBe("the-code");
    expect(form.code_verifier).toBe("verifier");
    expect(form.client_secret).toBe("sec");
  });

  it("confidential Microsoft client sends a client_secret", async () => {
    const capture: { url: string; form: Record<string, string> }[] = [];
    const transport = mockTransport({ access_token: "AT" }, capture);
    await exchangeCode("microsoft", { clientId: "cid", clientSecret: "ms-sec" }, "https://app/cb", "c", "v", { transport, now: 1 });
    expect(capture[0]!.form.client_secret).toBe("ms-sec");
  });

  it("throws on an OAuth error response", async () => {
    const transport = mockTransport({ error: "invalid_grant", error_description: "bad code" });
    await expect(
      exchangeCode("google", { clientId: "c", clientSecret: "s" }, "r", "code", "v", { transport }),
    ).rejects.toThrow(/bad code/);
  });
});

describe("validAccessToken", () => {
  const conf = { clientId: "c", clientSecret: "s" };

  it("returns the current token when it is not near expiry (no network)", async () => {
    let called = false;
    const transport: HttpTransport = {
      async postForm() {
        called = true;
        return {};
      },
      async getJson() {
        return {};
      },
    };
    const secret: OAuthTokens = { access_token: "AT", refresh_token: "RT", expires_in: 3600, obtained_at: 1000 };
    const tok = await validAccessToken("google", conf, secret, { transport, now: 1000 + 10_000 });
    expect(tok).toBe("AT");
    expect(called).toBe(false);
  });

  it("refreshes when expired and preserves the refresh token if a new one is not returned", async () => {
    const transport = mockTransport({ access_token: "AT2", expires_in: 3600 }); // note: no refresh_token back
    const secret: OAuthTokens = { access_token: "old", refresh_token: "RT", expires_in: 3600, obtained_at: 0 };
    let persisted: OAuthTokens | null = null;
    const tok = await validAccessToken("google", conf, secret, {
      transport,
      now: 10_000_000, // far past expiry
      onRefresh: (t) => {
        persisted = t;
      },
    });
    expect(tok).toBe("AT2");
    expect(persisted!.refresh_token).toBe("RT"); // preserved
    expect(persisted!.access_token).toBe("AT2");
  });

  it("returns null when expired and there is no refresh token", async () => {
    const secret: OAuthTokens = { access_token: "old", expires_in: 3600, obtained_at: 0 };
    expect(await validAccessToken("google", conf, secret, { now: 10_000_000 })).toBeNull();
  });

  it("refresh() posts a refresh_token grant", async () => {
    const capture: { url: string; form: Record<string, string> }[] = [];
    await refresh("microsoft", { clientId: "c" }, "RT", { transport: mockTransport({ access_token: "x" }, capture), now: 5 });
    expect(capture[0]!.form.grant_type).toBe("refresh_token");
    expect(capture[0]!.form.refresh_token).toBe("RT");
  });
});
