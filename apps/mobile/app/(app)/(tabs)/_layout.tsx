// The spine: four tabs, desktop-dark chrome.
import { Tabs } from "expo-router";
import { IconBell, IconBoard, IconCalendar, IconSettings } from "../../../src/ui/icons";
import { color } from "../../../src/ui/theme";

export default function TabsLayout() {
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
      <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarIcon: ({ color: c }) => <IconBell color={c} /> }} />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color: c }) => <IconSettings color={c} /> }}
      />
    </Tabs>
  );
}
