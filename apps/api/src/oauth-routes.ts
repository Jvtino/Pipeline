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
import type { PendingStore } from "./pending-store";

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
}

function isProvider(p: string): p is ProviderId {
  return p === "google" || p === "microsoft";
}

export function registerOAuthRoutes(app: FastifyInstance, d: OAuthDeps): void {
  const transport = d.transport ?? fetchTransport;
  const redirectUri = (p: ProviderId) => `${d.publicUrl}/auth/${p}/callback`;

  app.get("/auth/:provider/start", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!isProvider(provider)) return reply.code(404).send({ error: "unknown provider" });
    const userId = d.resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "sign in before connecting a mailbox" });
    const conf = d.configs[provider];
    if (!conf?.clientId || (PROVIDERS[provider].needsSecret && !conf.clientSecret)) {
      return reply.code(400).send({ error: `${provider} OAuth is not configured`, hint: "set the client id/secret env vars" });
    }
    const verifier = pkceVerifier();
    const state = randomBytes(16).toString("base64url");
    await d.pending.set(state, { provider, verifier, userId }, PENDING_TTL_MS);
    return reply.redirect(buildAuthUrl(provider, conf.clientId, redirectUri(provider), pkceChallenge(verifier), state));
  });

  app.get("/auth/:provider/callback", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const q = req.query as Record<string, string | undefined>;
    const pend = q.state ? await d.pending.take(q.state) : null;

    if (!isProvider(provider) || !q.code || !pend || pend.provider !== provider) {
      return reply.redirect(`${d.webUrl}?connect=error`);
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
      return reply.redirect(`${d.webUrl}?connect=ok`);
    } catch (err) {
      app.log.error(err);
      return reply.redirect(`${d.webUrl}?connect=error`);
    }
  });
}
