// Settings (this phase): who you are, what's connected, sign out, and the
// build/server facts that make support conversations short. Mailbox connect,
// notification prefs, and account deletion arrive with the actions phase.
import { ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";
import { useConnections, useMeta } from "../../../src/api/queries";
import { API_URL } from "../../../src/api/client";
import { AUTH_MODE } from "../../../src/auth/mode";
import { useSession } from "../../../src/auth/session";
import { Button, Label, Panel, Screen } from "../../../src/ui/components";
import { color, space, text } from "../../../src/ui/theme";

export default function SettingsScreen() {
  const session = useSession();
  const connections = useConnections();
  const meta = useMeta();
  const qc = useQueryClient();
  const version = (Constants.expoConfig?.version as string | undefined) ?? "0.0.0";

  const signOut = async () => {
    await session.signOut();
    qc.clear(); // one account's cached board must never show for the next
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
        <Panel style={{ gap: space.sm }}>
          <Label>Account</Label>
          <Text style={text.base}>{session.email ?? "—"}</Text>
          {AUTH_MODE === "dev" ? <Text style={text.faint}>Development sign-in (no Clerk key configured)</Text> : null}
          <Button title="Sign out" kind="ghost" onPress={() => void signOut()} style={{ marginTop: space.sm }} />
        </Panel>

        <Panel style={{ gap: space.sm }}>
          <Label>Connected mailboxes</Label>
          {connections.data?.mailboxes.length ? (
            connections.data.mailboxes.map((m) => (
              <View key={m.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={text.base}>{m.email}</Text>
                <Text style={text.faint}>{m.provider}</Text>
              </View>
            ))
          ) : (
            <Text style={text.dim}>None yet — connecting a mailbox from the phone arrives in the next update.</Text>
          )}
          {meta.data ? (
            <Text style={[text.faint, { marginTop: space.xs }]}>
              Available now: {[meta.data.features.microsoftConnect && "Outlook/Hotmail", meta.data.features.gmailConnect && "Gmail"]
                .filter(Boolean)
                .join(", ") || "none configured on this server"}
            </Text>
          ) : null}
        </Panel>

        <Panel style={{ gap: space.xs }}>
          <Label>About</Label>
          <Row k="App version" v={version} />
          <Row k="Server" v={API_URL} />
          <Row k="Privacy" v="Only derived records — never your raw email" />
        </Panel>
      </ScrollView>
    </Screen>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text style={text.faint}>{k}</Text>
      <Text style={[text.faint, { color: color.textDim, flexShrink: 1, textAlign: "right" }]} numberOfLines={2}>
        {v}
      </Text>
    </View>
  );
}
