import type { CsvRow } from "@/lib/csv";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";

export default function AdvisorSetterDashboardClient({
  operatoriRows,
  dispatchRows,
  dispatchRowsAll,
  operatoriRowsOggi,
  dispatchRowsOggi,
  dispatchRowsAllOggi,
  trackingEventiRows,
  operators,
  campaigns
}: {
  operatoriRows: CsvRow[];
  dispatchRows: CsvRow[];
  dispatchRowsAll: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  dispatchRowsOggi: CsvRow[];
  dispatchRowsAllOggi: CsvRow[];
  trackingEventiRows: CsvRow[];
  operators: string[];
  campaigns: string[];
}) {
  return (
    <DashboardEnterprise
      operatoriRows={operatoriRows}
      dispatchRows={dispatchRows}
      dispatchRowsAll={dispatchRowsAll}
      operatoriRowsOggi={operatoriRowsOggi}
      dispatchRowsOggi={dispatchRowsOggi}
      dispatchRowsAllOggi={dispatchRowsAllOggi}
      trackingEventiRows={trackingEventiRows}
      operators={operators}
      campaigns={campaigns}
      hideDispatchment
      hideCampagne
      hideInsights
      hideTimelineEventi
    />
  );
}
