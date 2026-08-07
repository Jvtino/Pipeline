// App-side push: permission → Expo token → POST /api/devices, plus tap
// routing. Fails soft everywhere — a phone with notifications denied (or a
// simulator, or the web/demo build) is a fully working pull-only app; the
// Alerts tab is the source of truth that backstops any missed push.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { z } from "zod";
import { request } from "./api/client";
import { DEMO } from "./auth/mode";

const deviceEnvelope = z.object({
  device: z.object({
    id: z.string(),
    platform: z.string(),
    expoPushToken: z.string(),
    notifyStatusChanges: z.boolean(),
    notifyReminders: z.boolean(),
  }),
});

/** The token this installation registered with — how Settings finds "this
 *  device" among the account's registrations. Null when push isn't available. */
export let currentPushToken: string | null = null;

/** Foreground presentation: show alerts even while the app is open. */
export function configureNotificationHandling(): void {
  if (DEMO || Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask permission (the caller times this for AFTER the first board render —
 * never at cold start) and register the token server-side. Safe to call
 * repeatedly; re-registration just bumps the row.
 */
export async function registerForPush(): Promise<void> {
  if (DEMO || Platform.OS === "web" || !Device.isDevice) return; // simulator/web: pull-only
  try {
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted ? perm : await Notifications.requestPermissionsAsync();
    if (!granted.granted) return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("status-changes", {
        name: "Application updates",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Interview reminders",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    currentPushToken = token;
    await request("/api/devices", deviceEnvelope, {
      method: "POST",
      body: JSON.stringify({ expoPushToken: token, platform: Platform.OS, deviceName: Device.deviceName ?? undefined }),
    });
  } catch {
    // No EAS project yet, or a transient failure: the app works pull-only and
    // the next launch retries. Registration is never worth an error screen.
  }
}

export interface NotificationTarget {
  threadId: string;
}

/** Route a notification tap. Both kinds land on the application detail — the
 *  payload carries ids only, never content. */
export function targetFromResponse(response: Notifications.NotificationResponse): NotificationTarget | null {
  const data = response.notification.request.content.data as { type?: string; threadId?: string } | undefined;
  return data?.threadId ? { threadId: data.threadId } : null;
}

export function onNotificationTap(handle: (t: NotificationTarget) => void): () => void {
  if (DEMO || Platform.OS === "web") return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const target = targetFromResponse(response);
    if (target) handle(target);
  });
  return () => sub.remove();
}
