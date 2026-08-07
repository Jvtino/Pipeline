// Authenticated group: everything below requires a session.
import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/auth/session";
import { Loading, Screen } from "../../src/ui/components";
import { color } from "../../src/ui/theme";

export default function AppLayout() {
  const session = useSession();
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
