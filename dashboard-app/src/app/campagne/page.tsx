import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import CampaignsDashboard from "@/components/client/CampaignsDashboard";
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
    // SENZA CACHE, di proposito.
    //
    // E' l'elenco delle persone: chi lo modifica si aspetta di vedere l'effetto
    // subito, ed e' gia' la seconda volta che una cache ci fa perdere tempo -
    // prima teneva la lista ferma fino alle 19:30, poi cinque minuti, e in
    // entrambi i casi la conclusione e' stata "il filtro non funziona" mentre
    // funzionava benissimo su dati vecchi. Sono 6 KB per apertura di pagina.
    const hubspotUsersRows = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${HUBSPOT_USERS_SHEET_ID}/export?format=csv&gid=${GID_HUBSPOT_USERS}`,
      { next: { revalidate: 0 } }
    );

    const allowedTeams = new Set(["advisor", "setter"]);
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

  const campaigns = uniqueValues(operatoriRowsFiltered, "Campagna");

  return (
    <Container>
      <CampaignsDashboard
        operatoriRows={operatoriRowsFiltered}
        operatoriRowsOggi={operatoriRowsOggiFiltered}
        campaigns={campaigns}
      />
    </Container>
  );
}
