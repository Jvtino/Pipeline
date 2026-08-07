// The spine: four tabs, desktop-dark chrome. The Alerts tab carries a live
// badge with the review-queue count — the number a returning user came for.
import { Tabs } from "expo-router";
import { useReview } from "../../../src/api/queries";
import { IconBell, IconBoard, IconCalendar, IconSettings } from "../../../src/ui/icons";
import { color } from "../../../src/ui/theme";

export default function TabsLayout() {
  const review = useReview();
  const pending = review.data?.applications.length ?? 0;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: color.bg },
        headerTintColor: color.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: color.panel, borderTopColor: color.border },
        tabBarActiveTintColor: color.blue2,
        tabBarInactiveTintColor: color.textFaint,
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Applications", tabBarIcon: ({ color: c }) => <IconBoard color={c} /> }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: "Calendar", tabBarIcon: ({ color: c }) => <IconCalendar color={c} /> }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color: c }) => <IconBell color={c} />,
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: color.blue, color: color.white, fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color: c }) => <IconSettings color={c} /> }}
      />
    </Tabs>
  );
}
