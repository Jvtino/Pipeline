// Alerts tab — the review queue + notifications land with the actions/push
// phases. The tab exists now so the spine is complete.
import { EmptyState, Screen } from "../../../src/ui/components";

export default function AlertsScreen() {
  return (
    <Screen>
      <EmptyState
        title="Alerts are coming"
        hint="Status changes that need your confirmation, and interview reminders, will appear here in the next update."
      />
    </Screen>
  );
}
