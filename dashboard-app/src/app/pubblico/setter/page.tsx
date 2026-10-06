import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";
import Container from "@/components/ui/Container";
import { chiaveNome } from "@/lib/nomi";
import { operatoriDelTeam } from "@/lib/operatoriTeam";

/**
 * La tabella KPI Setter, per chi ha la password dei Setter.
 *
 * E' la gemella di /pubblico/advisor: solo i filtri e la tabella per
 * operatore, numeri aggregati senza nomi di contatti, telefoni o collegamenti
 * alle registrazioni. Riusa il componente grande per lo stesso motivo - il
 * calcolo delle colonne vive li', e una copia darebbe presto numeri diversi
 * dalla pagina interna.
 *
 * La password che la apre e' SETTER_DASHBOARD_PASSWORD, vedi src/lib/auth.ts.
 */

export const dynamic = "force-dynamic";

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID_OPERATORI = "245526930";
const GID_OPERATORI_OGGI = "2032731939";

function sheetCsvUrl(gid: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

export default async function Page() {
  const [operatoriRows, operatoriRowsOggi] = await Promise.all([
    fetchCsv(sheetCsvUrl(GID_OPERATORI)),
    fetchCsv(sheetCsvUrl(GID_OPERATORI_OGGI))
  ]);

  // GLI STESSI SETTER DELLA PAGINA INTERNA, dalla stessa funzione.
  const team = await operatoriDelTeam("Setter");

  const filtra = (righe: Awaited<ReturnType<typeof fetchCsv>>) =>
    team ? righe.filter((r) => team.chiavi.has(chiaveNome((r["Operatore"] ?? "").toString()))) : righe;

  const storico = filtra(operatoriRows);
  const oggi = filtra(operatoriRowsOggi);
  const righeMenu = [...storico, ...oggi];

  return (
    <Container>
      <DashboardEnterprise
        operatoriRows={storico}
        operatoriRowsOggi={oggi}
        operators={uniqueValues(righeMenu, "Operatore")}
        campaigns={uniqueValues(righeMenu, "Campagna")}
        operatorLabel="Setter"
        soloTabella
        hideCampagne
        hideInsights
        useHubspot
      />
    </Container>
  );
}
