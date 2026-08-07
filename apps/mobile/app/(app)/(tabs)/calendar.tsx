// Calendar: upcoming interviews on top (the part a phone is actually for),
// then the full agenda of dated activity, newest day first.
import { SectionList, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useBoard } from "../../../src/api/queries";
import { agenda, boardEvents, upcomingInterviews, type CalendarEvent } from "../../../src/lib/calendar";
import { formatDate } from "../../../src/lib/format";
import { EmptyState, ErrorState, ListSkeleton, Panel, Screen, StatusDot } from "../../../src/ui/components";
import { color, space, statusColor, statusLabel, text } from "../../../src/ui/theme";
import { Pressable } from "react-native";

export default function CalendarScreen() {
  const board = useBoard();
  const router = useRouter();

  if (board.isPending && !board.data) {
    return (
      <Screen>
        <ListSkeleton />
      </Screen>
    );
  }
  if (board.isError && !board.data) {
    return (
      <Screen>
        <ErrorState message="Couldn't load your calendar." onRetry={() => void board.refetch()} />
      </Screen>
    );
  }

  const apps = board.data!.groups.flatMap((g) => g.applications);
  const events = boardEvents(apps);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = upcomingInterviews(events, today);
  const days = agenda(events.filter((e) => !(e.kind === "interview" && e.date >= today)));

  const sections = [
    ...(upcoming.length ? [{ title: "Upcoming interviews", data: upcoming }] : []),
    ...days.map((d) => ({ title: formatDate(d.date), data: d.events })),
  ];

  if (!sections.length) {
    return (
      <Screen>
        <EmptyState title="No dated activity yet" hint="Interview dates found in your email, and status changes, will appear here." />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(e, i) => `${e.threadId}-${e.kind}-${e.date}-${i}`}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={[text.faint, { textTransform: "uppercase", letterSpacing: 1, fontSize: 11, marginTop: space.lg, marginBottom: space.sm }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <EventRow event={item} onOpen={(id) => router.push(`/(app)/application/${encodeURIComponent(id)}`)} />}
      />
    </Screen>
  );
}

function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: (threadId: string) => void }) {
  return (
    <Pressable
      onPress={() => onOpen(event.threadId)}
      accessibilityRole="button"
      accessibilityLabel={`${event.company}, ${event.role}${event.kind === "interview" ? ", interview" : ""}`}
    >
      {({ pressed }) => (
        <Panel
          style={[
            { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm, paddingVertical: space.md },
            pressed && { backgroundColor: color.elev },
            event.kind === "interview" && { borderColor: `${statusColor.interview}66` },
          ]}
        >
          <StatusDot status={event.status} />
          <View style={{ flex: 1 }}>
            <Text style={text.base} numberOfLines={1}>
              {event.company} — {event.role}
            </Text>
            <Text style={text.faint}>
              {event.kind === "interview"
                ? `Interview${event.time ? ` at ${event.time}` : ""} · ${formatDate(event.date)}`
                : statusLabel[event.status]}
            </Text>
          </View>
          <Text style={[text.faint, { fontSize: 18 }]}>›</Text>
        </Panel>
      )}
    </Pressable>
  );
}
