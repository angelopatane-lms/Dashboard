import type { CsvRow } from "@/lib/csv";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";

export default function AdvisorSetterDashboardClient({
  operatoriRows,
  operatoriRowsOggi,
  trackingEventiRows,
  operators,
  campaigns,
  operatorLabel,
  hubspotIdToName
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  trackingEventiRows: CsvRow[];
  operators: string[];
  campaigns: string[];
  operatorLabel?: string;
  hubspotIdToName?: Record<string, string>;
}) {
  return (
    <DashboardEnterprise
      operatoriRows={operatoriRows}
      operatoriRowsOggi={operatoriRowsOggi}
      trackingEventiRows={trackingEventiRows}
      operators={operators}
      campaigns={campaigns}
      operatorLabel={operatorLabel}
      hubspotIdToName={hubspotIdToName}
      hideCampagne
      hideInsights
      hideTimelineEventi
      useHubspot
    />
  );
}
