import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import DashboardEnterprise from "@/components/client/DashboardEnterprise";
import Container from "@/components/ui/Container";
import { operatoriDelTeam } from "@/lib/operatoriTeam";
import { assegnatiOggiInArchivio, conAssegnatiDiOggi } from "@/lib/assegnatiOggi";

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

  // GLI ASSEGNATI DI OGGI VENGONO DA HUBSPOT, non dal foglio: vedi
  // src/lib/assegnatiOggi.ts. Lo storico resta del foglio, che e' una
  // fotografia e non cambia quando un lead passa di mano; il giorno in corso
  // una fotografia non ce l'ha ancora.
  //
  // QUI SI LEGGE SOLO L'ARCHIVIO, mai HubSpot: il conto vero costa venti
  // secondi e lo rifa' /api/assegnati-oggi, che il browser chiama da solo.
  const contiOggi = await assegnatiOggiInArchivio();
  const righeOggi = conAssegnatiDiOggi(
    operatoriRowsOggi,
    contiOggi?.conteggi ?? null,
    "Operatore",
    // Lo storico porta i nomi scritti per esteso: serve a non far comparire
    // una riga in minuscolo accanto a quella vera. Vedi conAssegnatiDiOggi().
    operatoriRows.map((r) => String(r["Operatore"] ?? ""))
  );

  // GLI STESSI SETTER DELLA PAGINA INTERNA, dalla stessa funzione.
  const team = await operatoriDelTeam("Setter");

  // "QUEL GIORNO ERA SETTER?", non "lo e' adesso": vedi
  // src/lib/utenti/periodiTeam.ts.
  const filtra = (righe: Awaited<ReturnType<typeof fetchCsv>>) =>
    team ? righe.filter((r) => team.ammetteRiga(r["Operatore"] ?? "", r["Data"] ?? "")) : righe;

  const storico = filtra(operatoriRows);
  const oggi = filtra(righeOggi);
  const righeMenu = [...storico, ...oggi];

  // Chi oggi in squadra non c'e' piu': la riga resta dov'era allora, in grigio.
  const fuoriSquadra = team
    ? [...new Set(righeMenu.map((r) => (r["Operatore"] ?? "").trim()))].filter((n) => n && team.fuoriOggi(n))
    : null;

  return (
    <Container>
      <DashboardEnterprise
        operatoriRows={storico}
        operatoriRowsOggi={oggi}
        operators={uniqueValues(righeMenu, "Operatore")}
        campaigns={uniqueValues(righeMenu, "Campagna")}
        operatorLabel="Setter"
        // L'ELENCO DEI SETTER VERI, come sulla pagina interna. Senza, la
        // tabella mostra solo chi ha righe nel foglio Operatori, e tre chatter
        // su cinque - Annalisa Cafora, Laura Monaco e Lorenza De Santis - di
        // righe non ne hanno nessuna: il foglio registra l'attivita' al
        // telefono, e loro non telefonano. I numeri di Sales Copilot ci sono,
        // mancava la riga dove metterli.
        operatoriAmmessi={team?.nomi ?? null}
        sottoTeamPerPersona={team?.sottoTeam}
        sottoTeamStoria={team?.sottoTeamStoria}
        periodiNelTeam={team?.periodiNelTeam}
        fuoriSquadra={fuoriSquadra}
        soloTabella
        hideCampagne
        hideInsights
        useHubspot
      />
    </Container>
  );
}
