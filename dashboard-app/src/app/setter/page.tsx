import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import AdvisorSetterDashboardClient from "@/components/client/AdvisorSetterDashboardClient";
import Container from "@/components/ui/Container";
import { chiaveNome } from "@/lib/nomi";

export const dynamic = "force-dynamic";

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
// L'elenco delle persone si ricontrolla ogni cinque minuti, come gli altri
// fogli. Prima era in cache fino alle 19:30 di Roma: aggiungendo un Advisor la
// mattina non compariva fino a sera, ed e' il motivo per cui la lista sembrava
// non aggiornarsi. Sono 6 KB, non c'era ragione di tenerli fermi un giorno.
//
// NOTA SUL TEAM: le persone marcate "Advisor*" o "Setter*" restano fuori di
// proposito. Verificato che sono ferme da mesi - l'ultima attivita' e' fra
// maggio e agosto, contro il giorno prima di chi non ha l'asterisco - quindi
// l'asterisco segna chi non e' piu' operativo.
const HUBSPOT_USERS_SHEET_ID = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_OPERATORI = "245526930";
const GID_OPERATORI_OGGI = "2032731939";
const GID_HUBSPOT_USERS = "0";

function sheetCsvUrl(gid: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

export default async function Page() {
  const [operatoriRows, operatoriRowsOggi] = await Promise.all([
    fetchCsv(sheetCsvUrl(GID_OPERATORI)),
    fetchCsv(sheetCsvUrl(GID_OPERATORI_OGGI))
  ]);

  let allowedOperatorSet: Set<string> | null = null;
  try {
    const hubspotUsersRows = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${HUBSPOT_USERS_SHEET_ID}/export?format=csv&gid=${GID_HUBSPOT_USERS}`
    );

    const allowedTeams = new Set(["setter"]);
    allowedOperatorSet = new Set(
      hubspotUsersRows
        .filter((r) => allowedTeams.has(chiaveNome((r["Team Principale"] ?? "").toString())))
        .map((r) => chiaveNome((r["User"] ?? "").toString()))
        .filter((name) => name)
    );
  } catch {
    allowedOperatorSet = null;
  }

  const operatoriRowsFiltered = allowedOperatorSet
    ? operatoriRows.filter((r) => allowedOperatorSet!.has(chiaveNome((r["Operatore"] ?? "").toString())))
    : operatoriRows;
  const operatoriRowsOggiFiltered = allowedOperatorSet
    ? operatoriRowsOggi.filter((r) => allowedOperatorSet!.has(chiaveNome((r["Operatore"] ?? "").toString())))
    : operatoriRowsOggi;

  const operators = uniqueValues(operatoriRowsFiltered, "Operatore");
  const campaigns = uniqueValues(operatoriRowsFiltered, "Campagna");

  return (
    <Container>
      <AdvisorSetterDashboardClient
        operatoriRows={operatoriRowsFiltered}
        operatoriRowsOggi={operatoriRowsOggiFiltered}
        operators={operators}
        campaigns={campaigns}
        operatorLabel="Setter"
      />
    </Container>
  );
}
