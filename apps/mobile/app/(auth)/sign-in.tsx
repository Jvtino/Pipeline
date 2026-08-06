// Sign-in. Two builds, one screen file:
//  - Clerk build: email + password against the Clerk instance (social/Apple
//    buttons join in Phase 3 once the Clerk app is configured).
//  - Dev build (no publishable key): email-only sign-in against the API's dev
//    login — clearly labeled, only works on non-production servers.
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useSignIn } from "@clerk/clerk-expo";
import { AUTH_MODE } from "../../src/auth/mode";
import { useDevSession } from "../../src/auth/dev";
import { Button, Panel, Screen } from "../../src/ui/components";
import { color, space, text } from "../../src/ui/theme";

const field = {
  backgroundColor: color.elev,
  borderColor: color.border2,
  borderWidth: 1,
  borderRadius: 12,
  paddingHorizontal: space.lg,
  paddingVertical: space.md,
  color: color.text,
  fontSize: 15,
} as const;

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: space.xl }}
      >
        <Text style={[text.hero, { textAlign: "center" }]}>Pipeline</Text>
        <Text style={[text.dim, { textAlign: "center", marginTop: space.sm, marginBottom: space.xxl }]}>{subtitle}</Text>
        <Panel style={{ gap: space.md }}>{children}</Panel>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ClerkSignIn() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email.trim(), password });
      if (attempt.status === "complete") {
        await setActive({ session: attempt.createdSessionId });
        router.replace("/(app)/(tabs)");
      } else {
        setError("Additional verification is required — finish signing in on the web for now.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in. Check your email and password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell subtitle="Job applications, from your inbox">
      <TextInput
        style={field}
        placeholder="Email"
        placeholderTextColor={color.textFaint}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={field}
        placeholder="Password"
        placeholderTextColor={color.textFaint}
        secureTextEntry
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={[text.faint, { color: "#f0556b" }]}>{error}</Text> : null}
      <Button title={busy ? "Signing in…" : "Sign in"} onPress={submit} disabled={busy || !email || !password} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space.xs }}>
        <Link href="/(auth)/sign-up" style={[text.dim, { color: color.blue2 }]}>
          Create account
        </Link>
        <Link href="/(auth)/forgot-password" style={[text.dim, { color: color.blue2 }]}>
          Forgot password?
        </Link>
      </View>
    </Shell>
  );
}

function DevSignIn() {
  const { signIn } = useDevSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email);
      router.replace("/(app)/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell subtitle="Development build — dev sign-in">
      <TextInput
        style={field}
        placeholder="you@example.com"
        placeholderTextColor={color.textFaint}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {error ? <Text style={[text.faint, { color: "#f0556b" }]}>{error}</Text> : null}
      <Button title={busy ? "Signing in…" : "Sign in (dev)"} onPress={submit} disabled={busy || !email.includes("@")} />
      <Text style={text.faint}>
        No Clerk key configured, so this build signs in through the API's development login. Real sign-in (email/password,
        Google, Microsoft, Apple) activates when EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is set.
      </Text>
    </Shell>
  );
}

export default function SignInScreen() {
  return AUTH_MODE === "clerk" ? <ClerkSignIn /> : <DevSignIn />;
}
