import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import AdvisorSetterDashboardClient from "@/components/client/AdvisorSetterDashboardClient";
import Container from "@/components/ui/Container";
import { chiaveNome } from "@/lib/nomi";
import { operatoriDelTeam } from "@/lib/operatoriTeam";

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

  // L'elenco dei Setter sta in una funzione sola, condivisa con la pagina
  // pubblica: vedi src/lib/operatoriTeam.ts.
  const team = await operatoriDelTeam("Setter");
  const allowedOperatorSet = team?.chiavi ?? null;

  const operatoriRowsFiltered = allowedOperatorSet
    ? operatoriRows.filter((r) => allowedOperatorSet!.has(chiaveNome((r["Operatore"] ?? "").toString())))
    : operatoriRows;
  const operatoriRowsOggiFiltered = allowedOperatorSet
    ? operatoriRowsOggi.filter((r) => allowedOperatorSet!.has(chiaveNome((r["Operatore"] ?? "").toString())))
    : operatoriRowsOggi;

  // I menu si costruiscono su storico E oggi: una campagna partita stamattina
  // sta solo nel foglio di oggi, e prendendo lo storico soltanto non compariva
  // nel filtro fino al giorno dopo, pur essendo gia' contata in tabella.
  const righeMenu = [...operatoriRowsFiltered, ...operatoriRowsOggiFiltered];
  const operators = uniqueValues(righeMenu, "Operatore");
  const campaigns = uniqueValues(righeMenu, "Campagna");

  return (
    <Container>
      <AdvisorSetterDashboardClient
        operatoriRows={operatoriRowsFiltered}
        operatoriRowsOggi={operatoriRowsOggiFiltered}
        operators={operators}
        campaigns={campaigns}
        operatorLabel="Setter"
        sottoTeamPerPersona={team?.sottoTeam}
        gestioneTeam
      />
    </Container>
  );
}
