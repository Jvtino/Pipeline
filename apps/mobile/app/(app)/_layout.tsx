// Authenticated group: everything below requires a session. Push registration
// happens here — after sign-in, once the shell is up (never at cold start) —
// and notification taps deep-link to the application they're about.
import { useEffect } from "react";
import { Platform } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../src/auth/session";
import { consumeColdStartTap, onNotificationTap, registerForPush } from "../../src/notifications";
import { Booting, Screen } from "../../src/ui/components";
import { Welcome, useWelcomed } from "../../src/ui/welcome";
import { color } from "../../src/ui/theme";

export default function AppLayout() {
  const session = useSession();
  const welcome = useWelcomed();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    // Register only once the user is PAST the welcome screen — the OS
    // permission dialog must never interrupt the three promises they're
    // reading on a fresh install (and iOS only asks once, ever).
    if (!session.isSignedIn || !welcome.welcomed) return;
    const toDetail = ({ threadId }: { threadId: string }) => router.push(`/(app)/application/${encodeURIComponent(threadId)}`);
    const t = setTimeout(
      () =>
        void registerForPush().then((registered) => {
          // surface the Settings notification toggles without an app restart
          if (registered) void qc.invalidateQueries({ queryKey: ["devices"] });
        }),
      1500, // let the board render first
    );
    const off = onNotificationTap(toDetail);
    // A push tapped while the app was KILLED launched us — its event predates
    // any listener, so it's only visible via the last-response API. Now is the
    // first moment routing is safe (signed in, past the welcome gate).
    consumeColdStartTap(toDetail);
    return () => {
      clearTimeout(t);
      off();
    };
  }, [session.isSignedIn, welcome.welcomed, router, qc]);
  if (!session.isLoaded || !welcome.isLoaded) {
    return (
      <Screen>
        <Booting />
      </Screen>
    );
  }
  if (!session.isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (!welcome.welcomed) return <Welcome onDone={welcome.markWelcomed} />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: color.bg },
        headerTintColor: color.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: color.bg },
        // Web renders instant page changes (browser convention); native keeps
        // the platform slide transition.
        animation: Platform.OS === "web" ? "none" : undefined,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="application/[threadId]" options={{ title: "" }} />
      <Stack.Screen name="add-position" options={{ presentation: "modal", title: "Add position" }} />
      <Stack.Screen name="stats" options={{ title: "Your numbers" }} />
      <Stack.Screen name="review/[threadId]" options={{ presentation: "modal", title: "Review" }} />
    </Stack>
  );
}
