// Add a position by hand (modal). Server-persisted (threadId manual:<uuid>),
// so it shows up on every device — unlike the web app's local-only overlay.
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { STATUSES, type Status } from "@pipeline/contracts";
import { useAddPosition } from "../../src/api/mutations";
import { hapticSelect } from "../../src/ui/feedback";
import { Button, Label, Panel, Screen, StatusDot } from "../../src/ui/components";
import { color, radius, space, statusColor, statusLabel, text } from "../../src/ui/theme";

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

export default function AddPositionScreen() {
  const router = useRouter();
  const add = useAddPosition();
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<Status>("applied");

  const submit = () => {
    add.mutate(
      { company, role, status },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: "Add position", presentation: "modal", headerShown: true }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <Panel style={{ gap: space.md }}>
            <View style={{ gap: space.sm }}>
              <Label>Company</Label>
              <TextInput style={field} placeholder="Acme Robotics" placeholderTextColor={color.textFaint} value={company} onChangeText={setCompany} />
            </View>
            <View style={{ gap: space.sm }}>
              <Label>Role</Label>
              <TextInput style={field} placeholder="Staff Engineer" placeholderTextColor={color.textFaint} value={role} onChangeText={setRole} />
            </View>
            <View style={{ gap: space.sm }}>
              <Label>Status</Label>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {STATUSES.map((s) => {
                  const active = status === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => {
                        hapticSelect();
                        setStatus(s);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Status ${statusLabel[s]}`}
                      accessibilityState={{ selected: active }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.xs + 2,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: active ? statusColor[s] : color.border,
                        backgroundColor: active ? `${statusColor[s]}22` : color.elev,
                        paddingHorizontal: space.md,
                        paddingVertical: space.xs + 1,
                      }}
                    >
                      <StatusDot status={s} size={7} />
                      <Text style={[text.faint, active && { color: statusColor[s] }]}>{statusLabel[s]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {add.isError ? (
              <Text style={[text.faint, { color: statusColor.rejected }]}>Couldn't save — check your connection and try again.</Text>
            ) : null}
            <Button
              title={add.isPending ? "Adding…" : "Add position"}
              onPress={submit}
              disabled={add.isPending || !company.trim() || !role.trim()}
            />
          </Panel>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
