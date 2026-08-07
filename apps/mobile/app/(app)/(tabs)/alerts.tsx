// Alerts: the review queue — records the classifier wasn't sure about, each a
// two-tap confirmation. Push notifications will deep-link here (next phase);
// this list is also the pull-model backstop for any missed push.
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useReview } from "../../../src/api/queries";
import { formatDate } from "../../../src/lib/format";
import { Avatar, EmptyState, ErrorState, ListSkeleton, Panel, Screen, StatusPill } from "../../../src/ui/components";
import { color, space, text } from "../../../src/ui/theme";

export default function AlertsScreen() {
  const review = useReview();
  const router = useRouter();

  if (review.isPending && !review.data) {
    return (
      <Screen>
        <ListSkeleton />
      </Screen>
    );
  }
  if (review.isError && !review.data) {
    return (
      <Screen>
        <ErrorState message="Couldn't load your review list." onRetry={() => void review.refetch()} />
      </Screen>
    );
  }

  const items = review.data!.applications;

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(a) => a.threadId}
        contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={review.isRefetching} onRefresh={() => void review.refetch()} tintColor={color.blue} />
        }
        ListHeaderComponent={
          items.length ? (
            <Text style={[text.dim, { marginBottom: space.xs }]}>
              Pipeline wasn't fully sure about {items.length === 1 ? "this one" : `these ${items.length}`} — a quick look keeps
              your board honest.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState title="Nothing needs review" hint="When an email is hard to classify, it will show up here for a quick confirmation." />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(app)/review/${encodeURIComponent(item.threadId)}`)}
            accessibilityRole="button"
            accessibilityLabel={`Review ${item.company}, ${item.role}`}
          >
            {({ pressed }) => (
              <Panel style={[{ flexDirection: "row", alignItems: "center", gap: space.md }, pressed && { backgroundColor: color.elev }]}>
                <Avatar company={item.company} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[text.base, { fontWeight: "600" }]} numberOfLines={1}>
                    {item.company} — {item.role}
                  </Text>
                  <Text style={text.faint}>Last activity {formatDate(item.lastActivity)}</Text>
                  <StatusPill status={item.status} />
                </View>
                <Text style={[text.faint, { fontSize: 18 }]}>›</Text>
              </Panel>
            )}
          </Pressable>
        )}
      />
    </Screen>
  );
}
