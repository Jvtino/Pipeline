// Password reset (Clerk build): request the emailed code, then set a new
// password. Clerk sends the email — no mail service of our own involved.
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput } from "react-native";
import { Link, Redirect, useRouter } from "expo-router";
import { useSignIn } from "@clerk/clerk-expo";
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

function ClerkForgotPassword() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<"request" | "reset">("request");
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

  const requestCode = () =>
    run(async () => {
      await signIn!.create({ strategy: "reset_password_email_code", identifier: email.trim() });
      setStage("reset");
    });

  const reset = () =>
    run(async () => {
      const attempt = await signIn!.attemptFirstFactor({ strategy: "reset_password_email_code", code: code.trim(), password });
      if (attempt.status === "complete") {
        await setActive!({ session: attempt.createdSessionId });
        router.replace("/(app)/(tabs)");
      } else {
        setError("Couldn't reset with that code — request a fresh one and retry.");
      }
    });

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", padding: space.xl }}
      >
        <Text style={[text.hero, { textAlign: "center", marginBottom: space.xxl }]}>Reset password</Text>
        <Panel style={{ gap: space.md }}>
          {stage === "request" ? (
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
              {error ? <Text style={[text.faint, { color: "#f0556b" }]}>{error}</Text> : null}
              <Button title={busy ? "Sending…" : "Email me a reset code"} onPress={requestCode} disabled={busy || !email} />
              <Link href="/(auth)/sign-in" style={[text.dim, { color: color.blue2, textAlign: "center" }]}>
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <Text style={text.dim}>Enter the code we emailed to {email.trim()} and choose a new password.</Text>
              <TextInput
                style={field}
                placeholder="Reset code"
                placeholderTextColor={color.textFaint}
                keyboardType="number-pad"
                value={code}
                onChangeText={setCode}
              />
              <TextInput
                style={field}
                placeholder="New password"
                placeholderTextColor={color.textFaint}
                secureTextEntry
                autoComplete="new-password"
                value={password}
                onChangeText={setPassword}
              />
              {error ? <Text style={[text.faint, { color: "#f0556b" }]}>{error}</Text> : null}
              <Button title={busy ? "Resetting…" : "Set new password"} onPress={reset} disabled={busy || !code || !password} />
            </>
          )}
        </Panel>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default function ForgotPasswordScreen() {
  if (AUTH_MODE !== "clerk") return <Redirect href="/(auth)/sign-in" />;
  return <ClerkForgotPassword />;
}
