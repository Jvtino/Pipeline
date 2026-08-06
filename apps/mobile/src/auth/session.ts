// The one hook screens use for identity. AUTH_MODE is a build-time constant,
// so exactly one implementation's hooks ever run in a given build — the
// conditional never changes within a render lifetime.
import { AUTH_MODE } from "./mode";
import { useDevSession } from "./dev";
import { useClerkSession } from "./clerk";

export interface Session {
  isLoaded: boolean;
  isSignedIn: boolean;
  email: string | null;
  signOut: () => Promise<void>;
}

export function useSession(): Session {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- AUTH_MODE is constant per build
  return AUTH_MODE === "clerk" ? useClerkSession() : useDevSession();
}
