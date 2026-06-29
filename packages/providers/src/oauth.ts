// OAuth 2.0 Authorization Code + PKCE for Google (Gmail) and Microsoft (Graph),
// plus token refresh. Ported from providers.py / gmail.js / msgraph.js. The HTTP
// calls go through an injectable transport so the flow is unit-testable without
// the network; the default transport uses global fetch.

export type ProviderId = "google" | "microsoft";

export interface ProviderConfig {
  clientId: string;
  clientSecret?: string;
}

export interface OAuthTokens {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  obtained_at?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

interface ProviderDef {
  label: string;
  scope: string;
  authUrl: string;
  tokenUrl: string;
  needsSecret: boolean;
  extraAuth: Record<string, string>;
}

const MS_TENANT = "common"; // any Microsoft account — personal (outlook/live/hotmail) or work/school

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  google: {
    label: "Google",
    scope: "https://www.googleapis.com/auth/gmail.readonly", // RESTRICTED scope — needs verification + CASA at scale
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    needsSecret: true, // Google "Web application" clients require a client secret
    extraAuth: { access_type: "offline", prompt: "consent" }, // always return a refresh token
  },
  microsoft: {
    label: "Microsoft",
    scope: "openid email offline_access https://graph.microsoft.com/Mail.Read",
    authUrl: `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`,
    needsSecret: true, // confidential "Web" client + secret — reliable server-side redemption for local AND hosted
    extraAuth: { response_mode: "query", prompt: "select_account" },
  },
};

export interface HttpTransport {
  postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>>;
  getJson(url: string, token: string): Promise<Record<string, unknown>>;
}

export const fetchTransport: HttpTransport = {
  async postForm(url, form) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  },
  async getJson(url, token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  },
};

export function buildAuthUrl(
  provider: ProviderId,
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: p.scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...p.extraAuth,
  });
  return `${p.authUrl}?${params.toString()}`;
}

function tokenError(j: Record<string, unknown>): string | null {
  const e = (j.error_description ?? j.error) as string | undefined;
  return e && !j.access_token ? String(e) : null;
}

interface CallOpts {
  transport?: HttpTransport;
  now?: number;
}

export async function exchangeCode(
  provider: ProviderId,
  conf: ProviderConfig,
  redirectUri: string,
  code: string,
  verifier: string,
  opts: CallOpts = {},
): Promise<OAuthTokens> {
  const p = PROVIDERS[provider];
  const transport = opts.transport ?? fetchTransport;
  const form: Record<string, string> = {
    client_id: conf.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: p.scope,
  };
  if (p.needsSecret) form.client_secret = conf.clientSecret ?? "";
  const j = await transport.postForm(p.tokenUrl, form);
  const err = tokenError(j);
  if (err) throw new Error(err);
  return { ...(j as OAuthTokens), obtained_at: opts.now ?? Date.now() };
}

export async function refresh(
  provider: ProviderId,
  conf: ProviderConfig,
  refreshToken: string,
  opts: CallOpts = {},
): Promise<OAuthTokens> {
  const p = PROVIDERS[provider];
  const transport = opts.transport ?? fetchTransport;
  const form: Record<string, string> = {
    client_id: conf.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: p.scope,
  };
  if (p.needsSecret) form.client_secret = conf.clientSecret ?? "";
  const j = await transport.postForm(p.tokenUrl, form);
  const err = tokenError(j);
  if (err) throw new Error(err);
  return { ...(j as OAuthTokens), obtained_at: opts.now ?? Date.now() };
}

/**
 * Return a usable access token, transparently refreshing if expired. Calls
 * onRefresh(newSecret) so the caller can persist rotated tokens (re-encrypted).
 * Refresh tokens are preserved when the provider doesn't return a new one.
 */
export async function validAccessToken(
  provider: ProviderId,
  conf: ProviderConfig,
  secret: OAuthTokens,
  opts: CallOpts & { onRefresh?: (t: OAuthTokens) => void | Promise<void> } = {},
): Promise<string | null> {
  const now = opts.now ?? Date.now();
  const expiresMs = (secret.expires_in ?? 3600) * 1000;
  const expired = now - (secret.obtained_at ?? 0) > expiresMs - 60_000; // refresh 60s early
  if (secret.access_token && !expired) return secret.access_token;
  if (!secret.refresh_token) return null;
  const nt = await refresh(provider, conf, secret.refresh_token, { transport: opts.transport, now });
  if (!nt.refresh_token) nt.refresh_token = secret.refresh_token;
  if (opts.onRefresh) await opts.onRefresh(nt);
  return nt.access_token ?? null;
}
