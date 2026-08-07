// Review modal — the two-tap confirmation this app exists for. Shows why the
// classifier hesitated (its evidence and confidence), then: "Looks right"
// keeps the status, or pick the correct one (which also pins it). Push
// notification taps will land directly here in the next phase.
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { STATUSES, type Application } from "@pipeline/contracts";
import { useReview } from "../../../src/api/queries";
import { useResolveReview } from "../../../src/api/mutations";
import { formatDate } from "../../../src/lib/format";
import { Avatar, Button, EmptyState, Label, Panel, Screen, StatusDot, StatusPill } from "../../../src/ui/components";
import { color, radius, space, statusColor, statusLabel, text } from "../../../src/ui/theme";

export default function ReviewModal() {
  const { threadId: raw } = useLocalSearchParams<{ threadId: string }>();
  const threadId = decodeURIComponent(raw ?? "");
  const review = useReview();
  const resolve = useResolveReview();
  const router = useRouter();

  const item: Application | undefined = review.data?.applications.find((a) => a.threadId === threadId);

  if (!item) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Review" }} />
        <EmptyState title="Already handled" hint="This one is no longer waiting for review." />
      </Screen>
    );
  }

  const done = () => router.back();

  return (
    <Screen>
      <Stack.Screen options={{ title: item.company }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Panel style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
          <Avatar company={item.company} size={48} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={[text.title]} numberOfLines={2}>
              {item.role}
            </Text>
            <Text style={text.dim}>{item.company}</Text>
            <StatusPill status={item.status} />
          </View>
        </Panel>

        <Panel style={{ gap: space.sm }}>
          <Label>Why it's here</Label>
          {item.classification ? (
            <>
              <Text style={text.dim}>
                Pipeline read this as “{statusLabel[item.status]}” with {Math.round(item.classification.confidence * 100)}%
                confidence.
              </Text>
              {item.classification.evidence.slice(0, 3).map((e) => (
                <Text key={e} style={text.faint}>
                  · “{e}”
                </Text>
              ))}
            </>
          ) : (
            <Text style={text.dim}>Pipeline wasn't confident about this one.</Text>
          )}
          {item.snippet ? <Text style={[text.faint, { marginTop: space.xs }]}>{item.snippet}</Text> : null}
          <Text style={text.faint}>Last activity {formatDate(item.lastActivity)}</Text>
        </Panel>

        <Panel style={{ gap: space.md }}>
          <Button
            title={resolve.isPending ? "Saving…" : `Looks right — keep “${statusLabel[item.status]}”`}
            onPress={() => resolve.mutate({ threadId, action: "confirm" }, { onSuccess: done })}
            disabled={resolve.isPending}
          />
          <Label>Or set the correct stage</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {STATUSES.filter((s) => s !== item.status).map((s) => (
              <Pressable
                key={s}
                disabled={resolve.isPending}
                onPress={() => resolve.mutate({ threadId, action: "set", status: s }, { onSuccess: done })}
                accessibilityRole="button"
                accessibilityLabel={`Set status to ${statusLabel[s]}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs + 2,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: color.border,
                  backgroundColor: color.elev,
                  paddingHorizontal: space.md,
                  paddingVertical: space.xs + 1,
                }}
              >
                <StatusDot status={s} size={7} />
                <Text style={text.faint}>{statusLabel[s]}</Text>
              </Pressable>
            ))}
          </View>
          {resolve.isError ? (
            <Text style={[text.faint, { color: statusColor.rejected }]}>Couldn't save — check your connection and try again.</Text>
          ) : null}
        </Panel>
      </ScrollView>
    </Screen>
  );
}
