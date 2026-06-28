// Provider OAuth client config from the environment. Without these set, the
// connect routes report "not configured" rather than failing obscurely — you
// supply your own Google/Microsoft client IDs (and Google's secret) to enable
// real mailbox connect.
import type { ProviderConfig, ProviderId } from "@pipeline/providers";

export type ProviderConfigs = Partial<Record<ProviderId, ProviderConfig>>;

export function loadProviderConfigs(env: NodeJS.ProcessEnv = process.env): ProviderConfigs {
  const c: ProviderConfigs = {};
  if (env.GOOGLE_CLIENT_ID) {
    c.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env.MS_CLIENT_ID) {
    c.microsoft = { clientId: env.MS_CLIENT_ID };
  }
  return c;
}
