// Clerk identity: session lives in the OS keychain (expo-secure-store token
// cache), API calls carry the session JWT as a Bearer header — the exact shape
// apps/api/src/clerk.ts verifies against the instance's JWKS.
import { useEffect, type ReactNode } from "react";
import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { setAuthHeaderProvider } from "../api/client";
import { CLERK_PUBLISHABLE_KEY } from "./mode";

export function ClerkAuth({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <HeaderBridge>{children}</HeaderBridge>
    </ClerkProvider>
  );
}

/** Feeds Clerk's getToken into the API client (fresh token per request —
 *  Clerk rotates short-lived session JWTs internally). */
function HeaderBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthHeaderProvider(async () => {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      return headers;
    });
  }, [getToken]);
  return <>{children}</>;
}

export interface ClerkSession {
  isLoaded: boolean;
  isSignedIn: boolean;
  email: string | null;
  signOut: () => Promise<void>;
}

export function useClerkSession(): ClerkSession {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  return {
    isLoaded,
    isSignedIn: isSignedIn === true,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    signOut: async () => {
      await signOut();
    },
  };
}
