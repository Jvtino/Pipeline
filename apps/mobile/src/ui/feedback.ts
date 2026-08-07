// Touch feedback policy — one module so the whole app speaks with one hand.
// Haptics fire ONLY on meaningful state changes (a save landing, a mistake),
// never on mere navigation; that restraint is what makes the taps that DO
// buzz feel intentional. No-ops everywhere haptics can't run (web, demo).
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

const canBuzz = Platform.OS === "ios" || Platform.OS === "android";

/** A change was saved (status moved, review resolved, position added). */
export function hapticSuccess(): void {
  if (canBuzz) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** A save failed — pair with the visible error, never alone. */
export function hapticError(): void {
  if (canBuzz) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

/** A selection changed (picker chip toggled). Light, unobtrusive. */
export function hapticSelect(): void {
  if (canBuzz) void Haptics.selectionAsync().catch(() => {});
}

/** Crossing into destructive territory (arming account deletion). */
export function hapticWarn(): void {
  if (canBuzz) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
