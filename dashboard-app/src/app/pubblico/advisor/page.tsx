import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";
import Container from "@/components/ui/Container";
import { chiaveNome } from "@/lib/nomi";

/**
 * La tabella KPI Advisor senza password.
 *
 * COSA MOSTRA E COSA NO. Solo i filtri e la tabella per operatore: numeri
 * aggregati - chiamate, appuntamenti, consulenze, chiusure - senza nomi di
 * contatti, senza telefoni e senza i collegamenti alle registrazioni. Il resto
 * della dashboard, che quei dati li contiene, resta dietro la password.
 *
 * PERCHE' RIUSA IL COMPONENTE GRANDE invece di avere una tabella propria: il
 * calcolo di quelle colonne non sta nella tabella, sta nel componente - le
 * correzioni lette da HubSpot, le consulenze svolte dal database, gli
 * obiettivi del mese. Una copia darebbe numeri diversi dalla pagina interna
 * appena una delle tre fonti cambia, e nessuno se ne accorgerebbe finche'
 * qualcuno non mette le due schermate una accanto all'altra.
 *
 * L'indirizzo e' escluso dal controllo della password nel middleware.
 */

export const dynamic = "force-dynamic";

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID_OPERATORI = "245526930";
const GID_OPERATORI_OGGI = "2032731939";
const HUBSPOT_USERS_SHEET_ID = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_HUBSPOT_USERS = "0";

function sheetCsvUrl(gid: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

export default async function Page() {
  const [operatoriRows, operatoriRowsOggi] = await Promise.all([
    fetchCsv(sheetCsvUrl(GID_OPERATORI)),
    fetchCsv(sheetCsvUrl(GID_OPERATORI_OGGI))
  ]);

  // Gli stessi advisor della pagina interna: l'elenco viene dal foglio degli
  // utenti HubSpot e si legge senza cache, perche' chi lo modifica si aspetta
  // di vedere l'effetto subito. Se il foglio non risponde non si filtra,
  // esattamente come sulla pagina interna.
  let advisorAmmessi: Set<string> | null = null;
  try {
    const righe = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${HUBSPOT_USERS_SHEET_ID}/export?format=csv&gid=${GID_HUBSPOT_USERS}`,
      { next: { revalidate: 0 } }
    );
    advisorAmmessi = new Set(
      righe
        .filter((r) => chiaveNome((r["Team Principale"] ?? "").toString()).startsWith("advisor"))
        .map((r) => chiaveNome((r["User"] ?? "").toString()))
        .filter(Boolean)
    );
  } catch {
    advisorAmmessi = null;
  }

  const filtra = (righe: Awaited<ReturnType<typeof fetchCsv>>) =>
    advisorAmmessi ? righe.filter((r) => advisorAmmessi!.has(chiaveNome((r["Operatore"] ?? "").toString()))) : righe;

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
        operatorLabel="Advisor"
        operatoriAmmessi={advisorAmmessi ? [...advisorAmmessi] : null}
        soloTabella
        hideCampagne
        hideInsights
        useHubspot
      />
    </Container>
  );
}
