// Unauthenticated group: anyone already signed in skips straight to the app.
import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/auth/session";
import { Loading, Screen } from "../../src/ui/components";
import { color } from "../../src/ui/theme";

export default function AuthLayout() {
  const session = useSession();
  if (!session.isLoaded) {
    return (
      <Screen>
        <Loading label="Starting Pipeline…" />
      </Screen>
    );
  }
  if (session.isSignedIn) return <Redirect href="/(app)/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}
