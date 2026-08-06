// Development identity: the API's dev login (only mounted on non-production
// servers). React Native's fetch persists Set-Cookie via the native HTTP stack,
// so the session cookie rides along on every later request — no token handling
// at all. This mode exists so the app runs end-to-end before the Clerk account
// does; a store build (with EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY set) never uses it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_URL } from "../api/client";

export interface DevSession {
  isLoaded: boolean;
  isSignedIn: boolean;
  email: string | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<DevSession | null>(null);

export function DevAuthProvider({ children }: { children: ReactNode }) {
  const [isLoaded, setLoaded] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    // Probe the cookie session once at startup.
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/me`);
        if (res.ok) {
          const body = (await res.json()) as { user?: { email?: string } };
          setEmail(body.user?.email ?? null);
        }
      } catch {
        // offline / API down: stay signed out; the screen offers retry via sign-in
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const signIn = useCallback(async (address: string) => {
    const res = await fetch(`${API_URL}/auth/dev/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: address }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "development sign-in is not available on this server");
    }
    setEmail(address.trim().toLowerCase());
  }, []);

  const signOut = useCallback(async () => {
    await fetch(`${API_URL}/auth/logout`, { method: "POST" }).catch(() => {});
    setEmail(null);
  }, []);

  const value = useMemo<DevSession>(
    () => ({ isLoaded, isSignedIn: email !== null, email, signIn, signOut }),
    [isLoaded, email, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDevSession(): DevSession {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDevSession outside DevAuthProvider");
  return v;
}
