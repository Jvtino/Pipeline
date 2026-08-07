// A one-message toast: confirmation for actions whose result isn't already
// obvious on screen, and failures. Imperative `toast()` from anywhere; the
// single Host lives in the root layout. Auto-dismisses; never stacks (a second
// message replaces the first — this is a whisper channel, not a log).
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, View } from "react-native";
import { color, radius, space, statusColor, text } from "./theme";

type Kind = "success" | "error";
let emit: (msg: string, kind: Kind) => void = () => {};

export function toast(message: string, kind: Kind = "success"): void {
  // iOS VoiceOver ignores live regions (Android/web prop) — announce directly,
  // since for some actions the toast is the only confirmation there is.
  if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  emit(message, kind);
}

export function ToastHost() {
  const [current, setCurrent] = useState<{ msg: string; kind: Kind; key: number } | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    emit = (msg, kind) => setCurrent({ msg, kind, key: Date.now() });
    return () => {
      emit = () => {};
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    const mine = current.key; // a stale fade-out must never erase a newer toast
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        ({ finished }) => finished && setCurrent((c) => (c?.key === mine ? null : c)),
      );
    }, 2400);
    return () => clearTimeout(t);
  }, [current, progress]);

  if (!current) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 96, alignItems: "center" }}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={{
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          backgroundColor: color.elev,
          borderColor: current.kind === "error" ? `${statusColor.rejected}88` : color.border2,
          borderWidth: 1,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          maxWidth: "86%",
        }}
      >
        <Text style={[text.base, current.kind === "error" && { color: statusColor.rejected }]}>{current.msg}</Text>
      </Animated.View>
    </View>
  );
}
