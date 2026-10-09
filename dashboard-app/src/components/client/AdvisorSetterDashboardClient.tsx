import type { CsvRow } from "@/lib/csv";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";

export default function AdvisorSetterDashboardClient({
  operatoriRows,
  operatoriRowsOggi,
  operators,
  campaigns,
  operatorLabel,
  operatoriAmmessi,
  gestioneTeam,
  sottoTeamPerPersona,
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  operators: string[];
  campaigns: string[];
  operatorLabel?: string;
  operatoriAmmessi?: string[] | null;
  gestioneTeam?: boolean;
  sottoTeamPerPersona?: Record<string, string>;
}) {
  return (
    <DashboardEnterprise
      operatoriRows={operatoriRows}
      operatoriRowsOggi={operatoriRowsOggi}
      operators={operators}
      campaigns={campaigns}
      operatorLabel={operatorLabel}
      operatoriAmmessi={operatoriAmmessi}
      gestioneTeam={gestioneTeam}
      sottoTeamPerPersona={sottoTeamPerPersona}
      hideCampagne
      hideInsights
      useHubspot
    />
  );
}
