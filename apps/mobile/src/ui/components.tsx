// The mobile design system: a handful of primitives that speak the desktop
// app's dark language (tokens only — no ad-hoc colors). Deliberately no UI
// library, matching the repo's ethos across desktop and web.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { Status } from "@pipeline/contracts";
import { LogoMark } from "./logo";
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
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled === true }}
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

/** OS "reduce motion" preference — every animation in the app respects it. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setReduce(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Content entrance: a short fade-and-rise. Under reduce-motion it renders
 *  statically — motion is a garnish here, never information. */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay]);
  if (reduce) return <View style={style}>{children}</View>;
  return (
    <Animated.View
      style={[
        style,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Loading placeholder that holds the layout's shape (no spinner jump-cuts).
 *  Pulses gently; static under reduce-motion. */
export function Skeleton({ width, height = 14, radiusSize = 7, style }: { width: number | `${number}%`; height?: number; radiusSize?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radiusSize, backgroundColor: color.elev, opacity: reduce ? 0.6 : pulse }, style]}
    />
  );
}

/** The board's shape while it loads: search bar, chip row, two company cards. */
export function BoardSkeleton() {
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      <Skeleton width="100%" height={40} radiusSize={10} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Skeleton width={84} height={26} radiusSize={13} />
        <Skeleton width={96} height={26} radiusSize={13} />
        <Skeleton width={72} height={26} radiusSize={13} />
      </View>
      {[0, 1].map((i) => (
        <View key={i} style={[styles.panel, { gap: space.md }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Skeleton width={40} height={40} radiusSize={10} />
            <View style={{ gap: 6, flex: 1 }}>
              <Skeleton width="55%" />
              <Skeleton width="30%" height={11} />
            </View>
          </View>
          <Skeleton width="88%" />
          <Skeleton width="72%" />
        </View>
      ))}
    </View>
  );
}

/** A list's shape while it loads (alerts, calendar): three row cards. */
export function ListSkeleton() {
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.panel, { flexDirection: "row", alignItems: "center", gap: space.md }]}>
          <Skeleton width={40} height={40} radiusSize={10} />
          <View style={{ gap: 6, flex: 1 }}>
            <Skeleton width="65%" />
            <Skeleton width="40%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function Loading({ label = "Syncing your inbox…" }: { label?: string }) {
  return (
    <Centered>
      <ActivityIndicator color={color.blue} />
      <Text style={[text.dim, { marginTop: space.md }]}>{label}</Text>
    </Centered>
  );
}

/** Cold-start gate: the brand mark breathing, not a bare spinner — the splash
 *  hands off to this seamlessly. Static under reduce-motion. */
export function Booting() {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.7, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return (
    <Centered>
      <Animated.View style={{ opacity: reduce ? 1 : pulse, transform: [{ scale: reduce ? 1 : pulse.interpolate({ inputRange: [0.7, 1], outputRange: [0.97, 1] }) }] }}>
        <LogoMark size={72} />
      </Animated.View>
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
