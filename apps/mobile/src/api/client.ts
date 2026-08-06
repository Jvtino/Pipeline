// The phone's only data plane: HTTP to @pipeline/api, every response validated
// against @pipeline/contracts at the boundary. No mail, no tokens, no sync —
// the phone is a pure consumer of server-derived records.
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { z } from "zod";

/** API origin. Dev default targets the local API; a real build sets
 *  EXPO_PUBLIC_API_URL (Android emulators reach the host via 10.0.2.2). */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:3001" : "http://localhost:3001");

const APP_VERSION = (Constants.expoConfig?.version as string | undefined) ?? "0.0.0";

/** 401 from the API — session gone; the UI routes to sign-in. */
export class AuthError extends Error {
  constructor() {
    super("not authenticated");
    this.name = "AuthError";
  }
}

/** Non-2xx with the API's error envelope attached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type GetAuthHeaders = () => Promise<Record<string, string>>;

/** Set by the auth layer once at startup (Clerk getToken, or a no-op in dev
 *  mode where the native cookie jar carries the session). */
let getAuthHeaders: GetAuthHeaders = async () => ({});
export function setAuthHeaderProvider(fn: GetAuthHeaders): void {
  getAuthHeaders = fn;
}

export async function request<S extends z.ZodTypeAny>(path: string, schema: S, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Pipeline-Client": `mobile/${APP_VERSION} (${Platform.OS})`,
      ...(await getAuthHeaders()),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401) throw new AuthError();
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  // The contract is the law: fail loud on drift, never render partial garbage.
  return schema.parse(body) as z.infer<S>;
}
