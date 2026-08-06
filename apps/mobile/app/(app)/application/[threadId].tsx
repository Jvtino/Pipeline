// Application detail (read-only this phase): status, timeline of recorded
// events, the ≤600-char snippet, message previews with attachment metadata.
// The record itself comes from the board cache — no extra fetch for the header.
import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Application, Board, Status } from "@pipeline/contracts";
import { useEvents, useMessages } from "../../../src/api/queries";
import { formatDate, senderName } from "../../../src/lib/format";
import { Avatar, EmptyState, Label, Panel, Screen, StatusDot, StatusPill } from "../../../src/ui/components";
import { color, space, statusLabel, text } from "../../../src/ui/theme";

export default function ApplicationDetail() {
  const { threadId: raw } = useLocalSearchParams<{ threadId: string }>();
  const threadId = decodeURIComponent(raw ?? "");
  const qc = useQueryClient();
  const board = qc.getQueryData<Board>(["board"]);
  const app: Application | undefined = board?.groups.flatMap((g) => g.applications).find((a) => a.threadId === threadId);
  const events = useEvents(threadId);
  const messages = useMessages(threadId);

  if (!app) {
    return (
      <Screen>
        <EmptyState title="Not on your board" hint="This application may have been removed. Pull to refresh the board." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: app.company }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
        <Panel style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
          <Avatar company={app.company} size={52} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={[text.title]} numberOfLines={2}>
              {app.role}
            </Text>
            <Text style={text.dim}>{app.company}</Text>
            <StatusPill status={app.status} />
          </View>
        </Panel>

        <Panel style={{ gap: space.sm }}>
          <Label>Timeline</Label>
          {events.data?.events.length ? (
            events.data.events.map((e, i) => (
              <View key={`${e.occurredAt}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <StatusDot status={e.status as Status} />
                <Text style={[text.base, { flex: 1 }]}>{statusLabel[e.status as Status] ?? e.status}</Text>
                <Text style={text.faint}>
                  {formatDate(e.occurredAt)}
                  {e.source === "user" ? " · you" : ""}
                </Text>
              </View>
            ))
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <StatusDot status={app.status} />
              <Text style={[text.base, { flex: 1 }]}>{statusLabel[app.status]}</Text>
              <Text style={text.faint}>{formatDate(app.lastActivity)}</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space.sm }}>
            <Text style={text.faint}>First seen {formatDate(app.firstSeen)}</Text>
            <Text style={text.faint}>Last activity {formatDate(app.lastActivity)}</Text>
          </View>
        </Panel>

        {app.snippet ? (
          <Panel style={{ gap: space.sm }}>
            <Label>Latest message</Label>
            <Text style={text.dim}>{app.snippet}</Text>
          </Panel>
        ) : null}

        {messages.data?.messages.length ? (
          <Panel style={{ gap: space.md }}>
            <Label>Messages</Label>
            {messages.data.messages.map((m, i) => (
              <View key={`${m.date}-${i}`} style={{ gap: space.xs, borderTopWidth: i ? 1 : 0, borderTopColor: color.border, paddingTop: i ? space.md : 0 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                  <Text style={[text.base, { fontWeight: "600", flex: 1 }]} numberOfLines={1}>
                    {senderName(m.from)}
                  </Text>
                  <Text style={text.faint}>{formatDate(m.date)}</Text>
                </View>
                <Text style={text.dim} numberOfLines={4}>
                  {m.bodyPreview}
                </Text>
                {m.attachments.length ? (
                  <Text style={text.faint}>
                    {m.attachments.map((a) => a.name).join(" · ")}
                  </Text>
                ) : null}
              </View>
            ))}
          </Panel>
        ) : null}

        {app.manual ? <Text style={[text.faint, { textAlign: "center" }]}>Added by hand — no email thread attached.</Text> : null}
      </ScrollView>
    </Screen>
  );
}
