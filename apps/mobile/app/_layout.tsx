// Root layout: providers (identity by AUTH_MODE, query cache persisted to
// AsyncStorage so the last board survives offline), the desktop-dark chrome,
// and the /api/meta forced-upgrade gate.
import type { ReactNode } from "react";
import { Text } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AUTH_MODE } from "../src/auth/mode";
import { ClerkAuth } from "../src/auth/clerk";
import { DevAuthProvider } from "../src/auth/dev";
import { configureNotificationHandling } from "../src/notifications";
import { useMeta } from "../src/api/queries";
import { versionAtLeast } from "../src/lib/version";
import { Centered, Screen } from "../src/ui/components";
import { color, space, text } from "../src/ui/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 7 * 24 * 60 * 60 * 1000, // keep a week of cache for offline reads
      retry: 2,
    },
  },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "pipeline.query-cache.v1" });

configureNotificationHandling(); // foreground alerts show as banners

function AuthProvider({ children }: { children: ReactNode }) {
  return AUTH_MODE === "clerk" ? <ClerkAuth>{children}</ClerkAuth> : <DevAuthProvider>{children}</DevAuthProvider>;
}

/** Blocks the app when the server says this build is too old to trust the
 *  contract. Unreachable/errored meta never blocks (fail open by design). */
function MetaGate({ children }: { children: ReactNode }) {
  const meta = useMeta();
  const version = (Constants.expoConfig?.version as string | undefined) ?? "0.0.0";
  if (meta.data && !versionAtLeast(version, meta.data.minMobileVersion)) {
    return (
      <Screen>
        <Centered>
          <Text style={[text.title, { textAlign: "center" }]}>Update required</Text>
          <Text style={[text.dim, { textAlign: "center", marginTop: space.md }]}>
            This version of Pipeline ({version}) is older than the server supports. Please update the app from the store.
          </Text>
        </Centered>
      </Screen>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <AuthProvider>
        <MetaGate>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.bg },
            }}
          />
        </MetaGate>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
