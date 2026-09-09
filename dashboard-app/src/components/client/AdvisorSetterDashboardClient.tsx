import type { CsvRow } from "@/lib/csv";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";

export default function AdvisorSetterDashboardClient({
  operatoriRows,
  operatoriRowsOggi,
  operators,
  campaigns,
  operatorLabel,
  operatoriAmmessi,
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  operators: string[];
  campaigns: string[];
  operatorLabel?: string;
  operatoriAmmessi?: string[] | null;
}) {
  return (
    <DashboardEnterprise
      operatoriRows={operatoriRows}
      operatoriRowsOggi={operatoriRowsOggi}
      operators={operators}
      campaigns={campaigns}
      operatorLabel={operatorLabel}
      operatoriAmmessi={operatoriAmmessi}
      hideCampagne
      hideInsights
      useHubspot
    />
  );
}
