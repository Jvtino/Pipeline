// Account creation (Clerk build): email + password, then the emailed
// verification code. Dev builds have no separate sign-up — dev login creates
// the account — so they bounce back to sign-in.
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput } from "react-native";
import { Link, Redirect, useRouter } from "expo-router";
import { useSignUp } from "@clerk/clerk-expo";
import { AUTH_MODE } from "../../src/auth/mode";
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

function ClerkSignUp() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"form" | "verify">("form");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (!isLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      await signUp!.create({ emailAddress: email.trim(), password });
      await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
      setStage("verify");
    });

  const verify = () =>
    run(async () => {
      const attempt = await signUp!.attemptEmailAddressVerification({ code: code.trim() });
      if (attempt.status === "complete") {
        await setActive!({ session: attempt.createdSessionId });
        router.replace("/(app)/(tabs)");
      } else {
        setError("That code didn't verify — check it and try again.");
      }
    });

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: space.xl }}
      >
        <Text style={[text.hero, { textAlign: "center", marginBottom: space.xxl }]}>Create your account</Text>
        <Panel style={{ gap: space.md }}>
          {stage === "form" ? (
            <>
              <TextInput
                style={field}
                placeholder="Email"
                placeholderTextColor={color.textFaint}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={field}
                placeholder="Password"
                placeholderTextColor={color.textFaint}
                secureTextEntry
                autoComplete="new-password"
                value={password}
                onChangeText={setPassword}
              />
              {error ? <Text style={[text.faint, { color: "#f0556b" }]}>{error}</Text> : null}
              <Button title={busy ? "Creating…" : "Create account"} onPress={create} disabled={busy || !email || !password} />
              <Link href="/(auth)/sign-in" style={[text.dim, { color: color.blue2, textAlign: "center" }]}>
                Already have an account? Sign in
              </Link>
            </>
          ) : (
            <>
              <Text style={text.dim}>We emailed a verification code to {email.trim()}.</Text>
              <TextInput
                style={field}
                placeholder="Verification code"
                placeholderTextColor={color.textFaint}
                keyboardType="number-pad"
                value={code}
                onChangeText={setCode}
              />
              {error ? <Text style={[text.faint, { color: "#f0556b" }]}>{error}</Text> : null}
              <Button title={busy ? "Verifying…" : "Verify"} onPress={verify} disabled={busy || code.length < 4} />
            </>
          )}
        </Panel>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default function SignUpScreen() {
  if (AUTH_MODE !== "clerk") return <Redirect href="/(auth)/sign-in" />;
  return <ClerkSignUp />;
}
