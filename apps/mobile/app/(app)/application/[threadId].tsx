// Application detail: status (with the "move stage" picker — the user's word
// outranks the classifier), a railed timeline of recorded events, facts the
// classifier extracted from the mail (compensation/location/recruiter/
// interview), the ≤600-char snippet, and message previews with attachment
// metadata + open-in-mailbox links. The record itself comes from the board
// cache — no extra fetch for the header.
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { STATUSES, type Application, type Board, type Status } from "@pipeline/contracts";
import { useEvents, useMessages } from "../../../src/api/queries";
import { useOverrideStatus } from "../../../src/api/mutations";
import { formatDate, senderName } from "../../../src/lib/format";
import { Avatar, EmptyState, FadeIn, Label, Panel, Screen, StatusDot, StatusPill } from "../../../src/ui/components";
import { color, radius, space, statusColor, statusLabel, text } from "../../../src/ui/theme";

const open = (url: string) => void Linking.openURL(url).catch(() => {});

export default function ApplicationDetail() {
  const { threadId: raw } = useLocalSearchParams<{ threadId: string }>();
  const threadId = decodeURIComponent(raw ?? "");
  const qc = useQueryClient();
  const board = qc.getQueryData<Board>(["board"]);
  const app: Application | undefined = board?.groups.flatMap((g) => g.applications).find((a) => a.threadId === threadId);
  const events = useEvents(threadId);
  const messages = useMessages(threadId);
  const override = useOverrideStatus();

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
          <Label>Move stage</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {STATUSES.map((s) => {
              const active = app.status === s;
              return (
                <Pressable
                  key={s}
                  disabled={active || override.isPending}
                  onPress={() => override.mutate({ threadId, status: s })}
                  accessibilityRole="button"
                  accessibilityLabel={`Set status to ${statusLabel[s]}`}
                  accessibilityState={{ selected: active, disabled: active || override.isPending }}
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
                    opacity: override.isPending && !active ? 0.5 : 1,
                  }}
                >
                  <StatusDot status={s} size={7} />
                  <Text style={[text.faint, active && { color: statusColor[s] }]}>{statusLabel[s]}</Text>
                </Pressable>
              );
            })}
          </View>
          {override.isError ? (
            <Text style={[text.faint, { color: statusColor.rejected }]}>Couldn't save — check your connection and try again.</Text>
          ) : (
            <Text style={text.faint}>Your choice sticks — future email syncs can't change it back.</Text>
          )}
        </Panel>

        <Panel style={{ gap: 0 }}>
          <Label style={{ marginBottom: space.sm }}>Timeline</Label>
          {(events.data?.events.length
            ? events.data.events
            : [{ status: app.status as string, occurredAt: app.lastActivity, source: "sync" }]
          ).map((e, i, all) => (
            <View key={`${e.occurredAt}-${i}`} style={{ flexDirection: "row", gap: space.md }}>
              {/* the rail: dot + connecting line to the next event */}
              <View style={{ alignItems: "center", width: 10 }}>
                <View style={{ paddingTop: 5 }}>
                  <StatusDot status={e.status as Status} size={9} />
                </View>
                {i < all.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: color.border, marginVertical: 3 }} /> : null}
              </View>
              <View style={{ flex: 1, flexDirection: "row", paddingBottom: i < all.length - 1 ? space.lg : 0 }}>
                <Text style={[text.base, { flex: 1 }]}>{statusLabel[e.status as Status] ?? e.status}</Text>
                <Text style={text.faint}>
                  {formatDate(e.occurredAt)}
                  {e.source === "user" ? " · you" : ""}
                </Text>
              </View>
            </View>
          ))}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space.md }}>
            <Text style={text.faint}>First seen {formatDate(app.firstSeen)}</Text>
            <Text style={text.faint}>Last activity {formatDate(app.lastActivity)}</Text>
          </View>
        </Panel>

        <FactsPanel app={app} />

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
                {m.webLink ? (
                  <Pressable onPress={() => open(m.webLink!)} accessibilityRole="link" accessibilityLabel="Open in mailbox" hitSlop={6}>
                    <Text style={[text.faint, { color: color.blue2 }]}>Open in mailbox ↗</Text>
                  </Pressable>
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

/** Facts the classifier extracted from the thread — shown only when present,
 *  each actionable where it can be (call, email, join link). */
function FactsPanel({ app }: { app: Application }) {
  const e = app.enrichment;
  if (!e) return null;
  const rows: { label: string; value: string; action?: () => void; hint?: string }[] = [];
  if (e.interviewDateTime) {
    rows.push({ label: "Interview", value: formatDate(e.interviewDateTime) + (/T(\d{2}:\d{2})/.exec(e.interviewDateTime)?.[1] ? ` at ${/T(\d{2}:\d{2})/.exec(e.interviewDateTime)![1]}` : "") });
  }
  if (e.interviewLink) rows.push({ label: "Join link", value: e.interviewLink, action: () => open(e.interviewLink!), hint: "opens the meeting" });
  if (e.compensation) rows.push({ label: "Compensation", value: e.compensation });
  if (e.location) rows.push({ label: "Location", value: e.location });
  if (e.recruiterName) {
    rows.push({
      label: "Recruiter",
      value: e.recruiterName + (e.recruiterTitle ? ` · ${e.recruiterTitle}` : ""),
    });
  }
  if (e.recruiterEmail) rows.push({ label: "Email", value: e.recruiterEmail, action: () => open(`mailto:${e.recruiterEmail}`) });
  if (e.recruiterPhone) rows.push({ label: "Phone", value: e.recruiterPhone, action: () => open(`tel:${e.recruiterPhone!.replace(/[^+\d]/g, "")}`) });
  if (!rows.length) return null;
  return (
    <Panel style={{ gap: space.sm }}>
      <Label>From your email</Label>
      {rows.map((r) => (
        <Pressable
          key={r.label + r.value}
          disabled={!r.action}
          onPress={r.action}
          accessibilityRole={r.action ? "link" : undefined}
          accessibilityLabel={`${r.label}: ${r.value}`}
          style={{ flexDirection: "row", gap: space.md }}
        >
          <Text style={[text.faint, { width: 108 }]}>{r.label}</Text>
          <Text style={[text.dim, { flex: 1 }, r.action && { color: color.blue2 }]} numberOfLines={2}>
            {r.value}
          </Text>
        </Pressable>
      ))}
      <Text style={text.faint}>Pulled automatically from the thread — verify anything important against the original email.</Text>
    </Panel>
  );
}
