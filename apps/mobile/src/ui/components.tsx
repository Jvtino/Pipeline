// The mobile design system: a handful of primitives that speak the desktop
// app's dark language (tokens only — no ad-hoc colors). Deliberately no UI
// library, matching the repo's ethos across desktop and web.
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { Status } from "@pipeline/contracts";
import { color, panel, radius, space, statusColor, statusLabel, text } from "./theme";
import { hueFor, monogram } from "../lib/format";

/** Full-bleed dark screen with the desktop's blue top glow. */
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.screen, style]}>
      <LinearGradient
        colors={["rgba(47,129,247,0.16)", "rgba(47,129,247,0.04)", "transparent"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.45 }}
      />
      {children}
    </View>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function StatusDot({ status, size = 8 }: { status: Status; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: statusColor[status] }} />;
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <View style={[styles.pill, { borderColor: statusColor[status] }]}>
      <StatusDot status={status} />
      <Text style={[text.faint, { color: statusColor[status] }]}>{statusLabel[status]}</Text>
    </View>
  );
}

/** Lettered company avatar with a deterministic hue (desktop's hueFor). */
export function Avatar({ company, size = 40 }: { company: string; size?: number }) {
  const h = hueFor(company);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `hsla(${h}, 45%, 28%, 0.55)`,
        borderWidth: 1,
        borderColor: `hsla(${h}, 60%, 55%, 0.35)`,
      }}
    >
      <Text style={{ color: color.text, fontWeight: "700", fontSize: size * 0.38 }}>{monogram(company)}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "ghost";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        kind === "primary" ? styles.buttonPrimary : styles.buttonGhost,
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}
    >
      <Text style={[text.base, { fontWeight: "600" }, kind === "primary" && { color: color.white }]}>{title}</Text>
    </Pressable>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function Loading({ label = "Syncing your inbox…" }: { label?: string }) {
  return (
    <Centered>
      <ActivityIndicator color={color.blue} />
      <Text style={[text.dim, { marginTop: space.md }]}>{label}</Text>
    </Centered>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Centered>
      <Text style={[text.base, { textAlign: "center", marginBottom: space.md }]}>{message}</Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} kind="ghost" /> : null}
    </Centered>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Centered>
      <Text style={[text.title, { textAlign: "center" }]}>{title}</Text>
      {hint ? <Text style={[text.dim, { textAlign: "center", marginTop: space.sm }]}>{hint}</Text> : null}
    </Centered>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[text.faint, { textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  panel: { ...panel, padding: space.lg },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs + 2,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md - 2,
    paddingVertical: space.xs,
    alignSelf: "flex-start",
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    alignItems: "center",
  },
  buttonPrimary: { backgroundColor: color.blue },
  buttonGhost: { borderWidth: 1, borderColor: color.border2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxl },
});
