// Your numbers, at a glance: a hand-rolled donut of the board's statuses and
// the handful of figures worth knowing on a phone. Deep analytics stay on the
// web by design (plan §5) — this is the glance version.
import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { STATUSES, type Board, type Status } from "@pipeline/contracts";
import { useBoard } from "../../src/api/queries";
import { ErrorState, FadeIn, Label, ListSkeleton, Panel, Screen, StatusDot } from "../../src/ui/components";
import { color, space, statusColor, statusLabel, text } from "../../src/ui/theme";

const R = 64;
const STROKE = 18;
const CIRC = 2 * Math.PI * R;

function Donut({ counts }: { counts: Board["counts"] }) {
  const total = Math.max(1, counts.total);
  let acc = 0;
  const segments = STATUSES.filter((s) => counts[s] > 0).map((s) => {
    const frac = counts[s] / total;
    const seg = { status: s, offset: acc, frac };
    acc += frac;
    return seg;
  });
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Svg width={(R + STROKE) * 2} height={(R + STROKE) * 2}>
        <Circle cx={R + STROKE} cy={R + STROKE} r={R} stroke={color.elev} strokeWidth={STROKE} fill="none" />
        {segments.map((seg) => (
          <Circle
            key={seg.status}
            cx={R + STROKE}
            cy={R + STROKE}
            r={R}
            stroke={statusColor[seg.status]}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="butt"
            strokeDasharray={`${Math.max(1, seg.frac * CIRC - 2)} ${CIRC}`}
            strokeDashoffset={-seg.offset * CIRC}
            transform={`rotate(-90 ${R + STROKE} ${R + STROKE})`}
          />
        ))}
      </Svg>
      <View style={{ position: "absolute", alignItems: "center" }}>
        <Text style={[text.hero, { fontVariant: ["tabular-nums"] }]}>{counts.total}</Text>
        <Text style={text.faint}>applications</Text>
      </View>
    </View>
  );
}

export default function StatsScreen() {
  const board = useBoard();

  if (board.isPending && !board.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Your numbers" }} />
        <ListSkeleton />
      </Screen>
    );
  }
  const data = board.data;
  if (!data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Your numbers" }} />
        <ErrorState message="Couldn't load your numbers." onRetry={() => void board.refetch()} />
      </Screen>
    );
  }

  const counts = data.counts;
  const companies = data.groups.length;
  const active = counts.applied + counts.interview;
  const decided = counts.offer + counts.rejected + counts.cancelled;
  const replyRate = counts.total ? Math.round(((counts.interview + counts.offer + counts.rejected) / counts.total) * 100) : 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Your numbers" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
        <FadeIn>
          <Panel style={{ alignItems: "center", gap: space.lg, paddingVertical: space.xl }}>
            <Donut counts={counts} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md, justifyContent: "center" }}>
              {STATUSES.filter((s) => counts[s] > 0).map((s: Status) => (
                <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 2 }}>
                  <StatusDot status={s} size={8} />
                  <Text style={[text.faint, { fontVariant: ["tabular-nums"] }]}>
                    {statusLabel[s]} {counts[s]}
                  </Text>
                </View>
              ))}
            </View>
          </Panel>
        </FadeIn>

        <FadeIn delay={120}>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Tile label="Companies" value={String(companies)} />
            <Tile label="In play" value={String(active)} />
            <Tile label="Decided" value={String(decided)} />
          </View>
        </FadeIn>

        <FadeIn delay={200}>
          <Panel style={{ gap: space.sm }}>
            <Label>Reply rate</Label>
            <Text style={[text.hero, { fontVariant: ["tabular-nums"] }]}>{replyRate}%</Text>
            <Text style={text.faint}>
              Applications that got any reply — an interview, an offer, or a rejection. Silence is the other {100 - replyRate}%.
            </Text>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: color.elev, overflow: "hidden" }}>
              <View style={{ width: `${replyRate}%`, height: 8, backgroundColor: color.blue }} />
            </View>
          </Panel>
        </FadeIn>

        <Text style={[text.faint, { textAlign: "center" }]}>Deep analytics — funnels, sources, timing — live on the web app.</Text>
      </ScrollView>
    </Screen>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Panel style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: space.lg }}>
      <Text style={[text.title, { fontVariant: ["tabular-nums"] }]}>{value}</Text>
      <Text style={text.faint}>{label}</Text>
    </Panel>
  );
}
