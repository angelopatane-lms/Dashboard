import type { CsvRow } from "@/lib/csv";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";

export default function DashboardClient({
  operatoriRows,
  operatoriRowsOggi,
  trackingEventiRows,
  operators,
  campaigns
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  trackingEventiRows: CsvRow[];
  operators: string[];
  campaigns: string[];
}) {
  return (
    <DashboardEnterprise
      operatoriRows={operatoriRows}
      operatoriRowsOggi={operatoriRowsOggi}
      trackingEventiRows={trackingEventiRows}
      operators={operators}
      campaigns={campaigns}
    />
  );
}
