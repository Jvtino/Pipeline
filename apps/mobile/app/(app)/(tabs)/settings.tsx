// Settings: account, mailbox connect (the system-browser hand-off — the phone
// never sees a mail token), notification prefs (next phase), and the danger
// zone. Deleting the account is the App Store-required in-app erasure.
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useQueryClient } from "@tanstack/react-query";
import { useConnections, useMeta } from "../../../src/api/queries";
import { useConnectToken, useDeleteAccount } from "../../../src/api/mutations";
import { API_URL } from "../../../src/api/client";
import { AUTH_MODE } from "../../../src/auth/mode";
import { useSession } from "../../../src/auth/session";
import { Button, Label, Panel, Screen } from "../../../src/ui/components";
import { color, space, statusColor, text } from "../../../src/ui/theme";

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

export default function SettingsScreen() {
  const session = useSession();
  const connections = useConnections();
  const meta = useMeta();
  const connectToken = useConnectToken();
  const deleteAccount = useDeleteAccount();
  const qc = useQueryClient();
  const router = useRouter();
  const version = (Constants.expoConfig?.version as string | undefined) ?? "0.0.0";

  const [connectError, setConnectError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const signOut = async () => {
    await session.signOut();
    qc.clear(); // one account's cached board must never show for the next
  };

  // The mail-OAuth hand-off: trade our bearer auth for a one-time nonce, open
  // the SYSTEM browser on the server's start URL (it shows the confirmation
  // page naming this account), and refetch connections when the browser hands
  // back — or when the user closes it after finishing.
  const connect = async (provider: "google" | "microsoft") => {
    setConnectError(null);
    try {
      const { startPath } = await connectToken.mutateAsync(provider);
      await WebBrowser.openAuthSessionAsync(`${API_URL}${startPath}`, Linking.createURL("connect/done"));
      await connections.refetch();
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Couldn't start the connection. Try again.");
    }
  };

  const erase = () => {
    deleteAccount.mutate(undefined, {
      onSuccess: async () => {
        await session.signOut().catch(() => {});
        router.replace("/(auth)/sign-in");
      },
    });
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
            <Text style={text.dim}>No mailbox connected yet — connect one and the board fills itself.</Text>
          )}
          {meta.data?.features.microsoftConnect ? (
            <Button
              title={connectToken.isPending ? "Opening…" : "Connect Outlook / Hotmail"}
              onPress={() => void connect("microsoft")}
              disabled={connectToken.isPending}
              style={{ marginTop: space.sm }}
            />
          ) : null}
          {meta.data?.features.gmailConnect ? (
            <Button
              title={connectToken.isPending ? "Opening…" : "Connect Gmail"}
              onPress={() => void connect("google")}
              disabled={connectToken.isPending}
              kind="ghost"
            />
          ) : (
            <Text style={text.faint}>Gmail is coming soon — it's waiting on Google's approval process.</Text>
          )}
          {connectError ? <Text style={[text.faint, { color: statusColor.rejected }]}>{connectError}</Text> : null}
          <Text style={text.faint}>
            Connecting happens in your browser. Pipeline's server does the reading; this phone never holds your email password
            or mail access.
          </Text>
        </Panel>

        <Panel style={{ gap: space.xs }}>
          <Label>About</Label>
          <Row k="App version" v={version} />
          <Row k="Server" v={API_URL} />
          <Row k="Privacy" v="Only derived records — never your raw email" />
        </Panel>

        <Panel style={{ gap: space.sm, borderColor: `${statusColor.rejected}55` }}>
          <Label style={{ color: statusColor.rejected }}>Danger zone</Label>
          <Text style={text.dim}>
            Deleting your account erases everything on the server — applications, timelines, connected mailboxes — and cannot
            be undone. Type <Text style={{ fontWeight: "700", color: color.text }}>delete</Text> to arm the button.
          </Text>
          <TextInput
            style={field}
            placeholder="delete"
            placeholderTextColor={color.textFaint}
            autoCapitalize="none"
            value={confirmText}
            onChangeText={setConfirmText}
          />
          {deleteAccount.isError ? (
            <Text style={[text.faint, { color: statusColor.rejected }]}>Couldn't delete — check your connection and try again.</Text>
          ) : null}
          <Button
            title={deleteAccount.isPending ? "Deleting…" : "Delete my account"}
            onPress={erase}
            disabled={confirmText.trim().toLowerCase() !== "delete" || deleteAccount.isPending}
            style={{ backgroundColor: statusColor.rejected }}
          />
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
