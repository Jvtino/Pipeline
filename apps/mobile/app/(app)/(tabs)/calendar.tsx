// Calendar tab — lands with the actions phase (interview dates from the
// server's extracted enrichment). The tab exists now so the spine is complete.
import { EmptyState, Screen } from "../../../src/ui/components";

export default function CalendarScreen() {
  return (
    <Screen>
      <EmptyState title="Calendar is coming" hint="Interview dates from your applications will appear here in the next update." />
    </Screen>
  );
}
