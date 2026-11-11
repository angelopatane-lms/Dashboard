import type { CsvRow } from "@/lib/csv";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";

export default function AdvisorSetterDashboardClient({
  operatoriRows,
  operatoriRowsOggi,
  operators,
  campaigns,
  operatorLabel,
  operatoriAmmessi,
  fuoriSquadra,
  sottoTeamStoria,
  periodiNelTeam,
  gestioneTeam,
  sottoTeamPerPersona,
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  operators: string[];
  campaigns: string[];
  operatorLabel?: string;
  operatoriAmmessi?: string[] | null;
  /** Chi in questa squadra oggi non c'e' piu': le sue righe vanno in fondo. */
  fuoriSquadra?: string[] | null;
  sottoTeamStoria?: Record<string, { da: number | null; a: number; team: string }[]>;
  periodiNelTeam?: Record<string, { da: number | null; a: number }[]>;
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
      fuoriSquadra={fuoriSquadra}
      sottoTeamStoria={sottoTeamStoria}
      periodiNelTeam={periodiNelTeam}
      gestioneTeam={gestioneTeam}
      sottoTeamPerPersona={sottoTeamPerPersona}
      hideCampagne
      hideInsights
      useHubspot
    />
  );
}
