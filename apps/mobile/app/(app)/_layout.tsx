// Authenticated group: everything below requires a session. Push registration
// happens here — after sign-in, once the shell is up (never at cold start) —
// and notification taps deep-link to the application they're about.
import { useEffect } from "react";
import { Redirect, Stack, useRouter } from "expo-router";
import { useSession } from "../../src/auth/session";
import { onNotificationTap, registerForPush } from "../../src/notifications";
import { Loading, Screen } from "../../src/ui/components";
import { color } from "../../src/ui/theme";

export default function AppLayout() {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!session.isSignedIn) return;
    const t = setTimeout(() => void registerForPush(), 1500); // let the board render first
    const off = onNotificationTap(({ threadId }) => router.push(`/(app)/application/${encodeURIComponent(threadId)}`));
    return () => {
      clearTimeout(t);
      off();
    };
  }, [session.isSignedIn, router]);
  if (!session.isLoaded) {
    return (
      <Screen>
        <Loading label="Starting Pipeline…" />
      </Screen>
    );
  }
  if (!session.isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: color.bg },
        headerTintColor: color.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: color.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="application/[threadId]" options={{ title: "" }} />
      <Stack.Screen name="add-position" options={{ presentation: "modal", title: "Add position" }} />
      <Stack.Screen name="review/[threadId]" options={{ presentation: "modal", title: "Review" }} />
    </Stack>
  );
}
