// Entry: route by session state.
import { Redirect } from "expo-router";
import { useSession } from "../src/auth/session";
import { Booting, Screen } from "../src/ui/components";

export default function Index() {
  const session = useSession();
  if (!session.isLoaded) {
    return (
      <Screen>
        <Booting />
      </Screen>
    );
  }
  return <Redirect href={session.isSignedIn ? "/(app)/(tabs)" : "/(auth)/sign-in"} />;
}
