// OAuth connect routes — the hosted equivalent of server.py's /auth/* + the
// desktop loopback flow. On callback we exchange the code and persist the mail
// connection with its token ENVELOPE-ENCRYPTED (@pipeline/crypto via @pipeline/db).
//
// NOTE: pending PKCE state lives in an in-memory Map here. That is correct for a
// single instance; a multi-replica deploy must move it to Redis with a short TTL
// (the plan calls this out — server.py's in-process _pending has the same limit).
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  pkceVerifier,
  pkceChallenge,
  buildAuthUrl,
  exchangeCode,
  getEmail,
  PROVIDERS,
  fetchTransport,
  type ProviderId,
  type HttpTransport,
} from "@pipeline/providers";
import { saveMailConnection, type Database } from "@pipeline/db";
import type { FastifyRequest } from "fastify";
import type { ProviderConfigs } from "./config";
import { CONNECT_TOKEN_PREFIX, type PendingStore } from "./pending-store";

const PENDING_TTL_MS = 10 * 60 * 1000; // an OAuth round-trip should finish well within 10 min

export interface OAuthDeps {
  db: Database;
  masterKey: Buffer;
  resolveUserId: (req: FastifyRequest) => string | null; // the authenticated user
  configs: ProviderConfigs;
  transport?: HttpTransport;
  publicUrl: string; // where the API is reachable (for the redirect_uri)
  webUrl: string; // where to send the user back after connect
  pending: PendingStore;
  /** Where a MOBILE-started flow lands after the callback — a universal link the
   *  phone app owns (https://<domain>/connect/done), so the system browser hands
   *  control back to the app. Defaults to `${webUrl}/connect/done`. */
  mobileReturnUrl?: string;
}

function isProvider(p: string): p is ProviderId {
  return p === "google" || p === "microsoft";
}

// The outcome the web app shows as a toast after a connect round-trip. Kept in
// one place so the start/callback handlers stay consistent (and typo-proof).
type ConnectStatus = "ok" | "error" | "unconfigured";

export function registerOAuthRoutes(app: FastifyInstance, d: OAuthDeps): void {
  const transport = d.transport ?? fetchTransport;
  const redirectUri = (p: ProviderId) => `${d.publicUrl}/auth/${p}/callback`;
  const mobileReturnUrl = d.mobileReturnUrl ?? `${d.webUrl}/connect/done`;
  // Web flows land on the web app; mobile-started flows land on the universal
  // link the phone app owns, so the system browser hands control back to it.
  const connectBack = (status: ConnectStatus, returnTo?: "web" | "mobile") =>
    returnTo === "mobile" ? `${mobileReturnUrl}?connect=${status}` : `${d.webUrl}?connect=${status}`;

  app.get("/auth/:provider/start", async (req, reply) => {
    // These are browser navigations, so on any failure send the user back to the
    // app with a reason (a toast) rather than dumping raw JSON in the tab.
    const { provider } = req.params as { provider: string };
    const q = req.query as Record<string, string | undefined>;
    // A mobile-minted connect token (POST /api/connect-token) identifies the user
    // when the flow runs in the system browser, which carries no cookie/bearer.
    const isMobile = typeof q.ct === "string" && q.ct.length > 0;
    if (!isProvider(provider)) return reply.redirect(connectBack("error", isMobile ? "mobile" : "web"));
    let userId: string | null;
    let returnTo: "web" | "mobile";
    if (isMobile) {
      const entry = await d.pending.take(`${CONNECT_TOKEN_PREFIX}${q.ct}`); // one-time use
      userId = entry && entry.provider === provider ? entry.userId : null;
      returnTo = "mobile";
    } else {
      userId = d.resolveUserId(req);
      returnTo = "web";
    }
    if (!userId) return reply.redirect(connectBack("error", returnTo));
    const conf = d.configs[provider];
    if (!conf?.clientId || (PROVIDERS[provider].needsSecret && !conf.clientSecret)) {
      return reply.redirect(connectBack("unconfigured", returnTo));
    }
    const verifier = pkceVerifier();
    const state = randomBytes(16).toString("base64url");
    await d.pending.set(state, { provider, verifier, userId, returnTo }, PENDING_TTL_MS);
    return reply.redirect(buildAuthUrl(provider, conf.clientId, redirectUri(provider), pkceChallenge(verifier), state));
  });

  app.get("/auth/:provider/callback", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const q = req.query as Record<string, string | undefined>;
    const pend = q.state ? await d.pending.take(q.state) : null;
    const returnTo = pend?.returnTo ?? "web";

    if (!isProvider(provider) || !q.code || !pend || pend.provider !== provider) {
      return reply.redirect(connectBack("error", returnTo));
    }
    try {
      const conf = d.configs[provider]!;
      const tokens = await exchangeCode(provider, conf, redirectUri(provider), q.code, pend.verifier, { transport });
      let email = "mailbox";
      try {
        email = await getEmail(provider, tokens.access_token ?? "", transport);
      } catch {
        /* labeling is best-effort */
      }
      await saveMailConnection(d.db, d.masterKey, {
        id: `${pend.userId}:${provider}:${email}`,
        userId: pend.userId,
        provider,
        email,
        secret: tokens,
      });
      return reply.redirect(connectBack("ok", returnTo));
    } catch (err) {
      app.log.error(err);
      return reply.redirect(connectBack("error", returnTo));
    }
  });
}
