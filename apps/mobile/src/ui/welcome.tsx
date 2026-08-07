// First-run welcome — one screen, three promises, one button. Shown exactly
// once after the first sign-in (device-local flag); the demo shows it too
// because it IS the pitch. No carousel to swipe through: respect for the
// user's time is part of the premium feel.
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Button, FadeIn, Panel, Screen } from "./components";
import { LogoMark } from "./logo";
import { space, statusColor, text } from "./theme";

const KEY = "pipeline.welcomed.v1";

export function useWelcomed(): { isLoaded: boolean; welcomed: boolean; markWelcomed: () => void } {
  const [state, setState] = useState<{ isLoaded: boolean; welcomed: boolean }>({ isLoaded: false, welcomed: false });
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(KEY)
      .then((v) => live && setState({ isLoaded: true, welcomed: v === "1" }))
      .catch(() => live && setState({ isLoaded: true, welcomed: false }));
    return () => {
      live = false;
    };
  }, []);
  return {
    ...state,
    markWelcomed: () => {
      setState({ isLoaded: true, welcomed: true });
      AsyncStorage.setItem(KEY, "1").catch(() => {});
    },
  };
}

const PROMISES = [
  {
    dot: statusColor.interview,
    title: "Your inbox becomes a board",
    body: "Pipeline reads your job-application email — read-only — and keeps a live board of where every application stands. No spreadsheets.",
  },
  {
    dot: statusColor.offer,
    title: "Private by design",
    body: "Only derived facts are kept: company, role, status, dates, a short snippet. Never your full emails, never sold, deletable in two taps.",
  },
  {
    dot: statusColor.applied,
    title: "Your word is final",
    body: "One tap corrects any status, forever. And when Pipeline isn't sure how to read an email, it asks instead of guessing.",
  },
];

export function Welcome({ onDone }: { onDone: () => void }) {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.md }}>
        <FadeIn style={{ alignItems: "center" }}>
          <LogoMark size={64} />
          <Text style={[text.hero, { textAlign: "center", marginTop: space.lg, marginBottom: space.xs }]}>Welcome to Pipeline</Text>
          <Text style={[text.dim, { textAlign: "center", marginBottom: space.lg }]}>Three things worth knowing.</Text>
        </FadeIn>
        {PROMISES.map((p, i) => (
          <FadeIn key={p.title} delay={120 + i * 110}>
            <Panel style={{ flexDirection: "row", gap: space.lg }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.dot, marginTop: 6 }} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[text.base, { fontWeight: "600" }]}>{p.title}</Text>
                <Text style={text.dim}>{p.body}</Text>
              </View>
            </Panel>
          </FadeIn>
        ))}
        <FadeIn delay={480}>
          <Button title="Show me my board" onPress={onDone} style={{ marginTop: space.md }} />
        </FadeIn>
      </ScrollView>
    </Screen>
  );
}
