// The board: server-grouped company cards, search, status-chip filtering,
// pull-to-refresh, long-press to pin a company to the top (device-local).
// Offline shows the persisted cache + a banner.
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import type { CompanyGroup, Status } from "@pipeline/contracts";
import { useBoard } from "../../../src/api/queries";
import { AuthError } from "../../../src/api/client";
import { countChips, filterBoard, filterByStatus } from "../../../src/lib/board";
import { relativeAge } from "../../../src/lib/format";
import { usePins, sortPinnedFirst } from "../../../src/lib/pins";
import { hapticSelect } from "../../../src/ui/feedback";
import { Avatar, BoardSkeleton, Button, EmptyState, ErrorState, FadeIn, Panel, Screen, StatusDot } from "../../../src/ui/components";
import { color, radius, space, statusColor, statusLabel, text } from "../../../src/ui/theme";

export default function BoardScreen() {
  const board = useBoard();
  const router = useRouter();
  const { pinned, isLoaded: pinsLoaded, toggle } = usePins();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | null>(null);

  const groups = useMemo(
    () => (board.data ? sortPinnedFirst(filterByStatus(filterBoard(board.data.groups, query), status), pinned) : []),
    [board.data, query, status, pinned],
  );

  // Hold for pins too (they hydrate in milliseconds) — otherwise pinned cards
  // visibly leap to the top of an already-painted list on cold start.
  if ((board.isPending && !board.data) || !pinsLoaded) {
    return (
      <Screen>
        <BoardSkeleton />
      </Screen>
    );
  }
  if (board.isError && !board.data) {
    const msg = board.error instanceof AuthError ? "Your session ended — sign in again." : "Couldn't load your board.";
    return (
      <Screen>
        <ErrorState message={msg} onRetry={() => void board.refetch()} />
      </Screen>
    );
  }

  const counts = board.data!.counts;
  const offline = board.isError && !!board.data;

  return (
    <Screen>
      {offline ? (
        <View style={{ backgroundColor: color.blueDeep, paddingVertical: space.xs, alignItems: "center" }}>
          <Text style={text.faint}>Can't reach the server — showing your last update</Text>
        </View>
      ) : null}
      <FadeIn style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
        <View>
          <TextInput
            style={{
              backgroundColor: color.elev,
              borderColor: color.border,
              borderWidth: 1,
              borderRadius: radius.sm,
              paddingHorizontal: space.lg,
              paddingRight: 40,
              paddingVertical: space.sm + 2,
              color: color.text,
              fontSize: 15,
            }}
            placeholder="Search company or role"
            placeholderTextColor={color.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable
              onPress={() => setQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              style={{ position: "absolute", right: 10, top: 0, bottom: 0, justifyContent: "center" }}
            >
              <Text style={[text.dim, { fontSize: 16 }]}>✕</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {countChips(counts, status).map((chip) => {
            const active = status === chip.status;
            return (
              <Pressable
                key={chip.status}
                onPress={() => setStatus(active ? null : chip.status)}
                accessibilityRole="button"
                accessibilityLabel={`Filter: ${statusLabel[chip.status]}, ${chip.count}`}
                accessibilityState={{ selected: active }}
                hitSlop={6}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs + 2,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active ? statusColor[chip.status] : color.border,
                  backgroundColor: active ? `${statusColor[chip.status]}22` : color.panel,
                  paddingHorizontal: space.md,
                  paddingVertical: space.xs + 1,
                }}
              >
                <StatusDot status={chip.status} size={7} />
                <Text style={[text.faint, active && { color: statusColor[chip.status] }]}>
                  {statusLabel[chip.status]} {chip.count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </FadeIn>
      <FlatList
        data={groups}
        // Platform-fallback groups ("Myworkday", …) all share the ATS name —
        // the contract keeps them one-per-thread, so the thread is the key.
        keyExtractor={(g) => (g.applications[0]?.platformFallback ? `ats:${g.applications[0].threadId}` : g.company + g.domain)}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={board.isRefetching} onRefresh={() => void board.refetch()} tintColor={color.blue} />
        }
        ListEmptyComponent={
          query || status ? (
            <EmptyState title="No matches" hint="Try a different search or clear the filter." />
          ) : (
            <View style={{ alignItems: "center", padding: space.xxl, gap: space.md }}>
              <Text style={[text.title, { textAlign: "center" }]}>Your board is empty</Text>
              <Text style={[text.dim, { textAlign: "center", marginBottom: space.sm }]}>
                Connect a mailbox and it fills itself — or start by hand.
              </Text>
              <Button title="Connect a mailbox" onPress={() => router.push("/(app)/(tabs)/settings")} style={{ alignSelf: "stretch" }} />
              <Button title="Add a position" kind="ghost" onPress={() => router.push("/(app)/add-position")} style={{ alignSelf: "stretch" }} />
            </View>
          )
        }
        renderItem={({ item }) => (
          <CompanyCard
            group={item}
            isPinned={pinned.has(item.company)}
            onTogglePin={(company) => {
              hapticSelect();
              toggle(company);
            }}
            onOpen={(id) => router.push(`/(app)/application/${encodeURIComponent(id)}`)}
          />
        )}
      />
      <Pressable
        onPress={() => router.push("/(app)/add-position")}
        accessibilityRole="button"
        style={({ pressed }) => [
          {
            position: "absolute",
            right: space.xl,
            bottom: space.xl,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: color.blue,
            alignItems: "center",
            justifyContent: "center",
          },
          pressed && { opacity: 0.8 },
        ]}
        accessibilityLabel="Add position"
      >
        <Text style={{ color: color.white, fontSize: 28, lineHeight: 30, fontWeight: "600" }}>＋</Text>
      </Pressable>
    </Screen>
  );
}

function CompanyCard({
  group,
  isPinned,
  onTogglePin,
  onOpen,
}: {
  group: CompanyGroup;
  isPinned: boolean;
  onTogglePin: (company: string) => void;
  onOpen: (threadId: string) => void;
}) {
  // one dot per distinct status, board order — the company's story at a glance
  const distinct = [...new Set(group.applications.map((a) => a.status))];
  // A fallback group's "company" is a shared ATS name — pinning is keyed by
  // company, so it would pin every record relayed through that platform.
  const pinnable = !group.applications[0]?.platformFallback;
  return (
    <Panel style={[{ padding: 0, overflow: "hidden" }, isPinned && { borderColor: color.border2 }]}>
      <Pressable
        onLongPress={pinnable ? () => onTogglePin(group.company) : undefined}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={pinnable ? `${group.company}. Long press to ${isPinned ? "unpin" : "pin"}.` : group.company}
        style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg }}
      >
        <Avatar company={group.company} />
        <View style={{ flex: 1 }}>
          <Text style={[text.base, { fontWeight: "600" }]} numberOfLines={1}>
            {isPinned ? "⤒ " : ""}
            {group.company}
          </Text>
          <Text style={text.faint} numberOfLines={1}>
            {group.applications.length === 1 ? "1 position" : `${group.applications.length} positions`}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: space.xs }}>
          {distinct.map((s) => (
            <StatusDot key={s} status={s} size={7} />
          ))}
        </View>
      </Pressable>
      {group.applications.map((a) => (
        <Pressable
          key={a.threadId}
          onPress={() => onOpen(a.threadId)}
          accessibilityRole="button"
          accessibilityLabel={`${a.role} at ${group.company}, ${statusLabel[a.status]}`}
          style={({ pressed }) => [
            {
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              borderTopWidth: 1,
              borderTopColor: color.border,
            },
            pressed && { backgroundColor: color.elev },
          ]}
        >
          <StatusDot status={a.status} />
          <View style={{ flex: 1 }}>
            <Text style={text.base} numberOfLines={1}>
              {a.role}
            </Text>
            <Text style={text.faint}>
              {statusLabel[a.status]} · {relativeAge(a.lastActivity)}
            </Text>
          </View>
          <Text style={[text.faint, { fontSize: 18 }]}>›</Text>
        </Pressable>
      ))}
    </Panel>
  );
}
