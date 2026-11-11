import { fetchCsv, type CsvRow } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import AdvisorSetterDashboardClient from "@/components/client/AdvisorSetterDashboardClient";
import Container from "@/components/ui/Container";
import { operatoriDelTeam } from "@/lib/operatoriTeam";
import { assegnatiOggiInArchivio, conAssegnatiDiOggi } from "@/lib/assegnatiOggi";

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

  // L'elenco degli Advisor sta in una funzione sola, condivisa con la pagina
  // pubblica: due letture separate erano libere di divergere, ed e' gia'
  // successo - vedi src/lib/operatoriTeam.ts.
  const team = await operatoriDelTeam("Advisor");
  const advisorNomi = team?.nomi ?? null;

  // SI CHIEDE "QUEL GIORNO ERA ADVISOR?", non "lo e' adesso".
  //
  // Il filtro guardava l'elenco di oggi anche sulle righe di mesi fa, e il
  // giorno in cui qualcuno esce dall'azienda il suo passato spariva con lui -
  // dalla tabella, dalle card in alto e dalle campagne, che si calcolano su
  // queste stesse righe. Vedi src/lib/utenti/periodiTeam.ts.
  const ammessa = (r: CsvRow) => team!.ammetteRiga(r["Operatore"] ?? "", r["Data"] ?? "");
  const operatoriRowsFiltered = team ? operatoriRows.filter(ammessa) : operatoriRows;
  const operatoriRowsOggiFiltered = team ? righeOggi.filter(ammessa) : righeOggi;

  // Chi in tabella oggi advisor non e' piu': la sua riga resta al suo posto,
  // nella sezione che aveva allora, ma scritta in grigio.
  const fuoriSquadra = team
    ? [...new Set([...operatoriRowsFiltered, ...operatoriRowsOggiFiltered].map((r) => (r["Operatore"] ?? "").trim()))]
        .filter((n) => n && team.fuoriOggi(n))
    : null;

  // I menu si costruiscono su storico E oggi: una campagna partita stamattina
  // sta solo nel foglio di oggi, e prendendo lo storico soltanto non compariva
  // nel filtro fino al giorno dopo, pur essendo gia' contata in tabella.
  const righeMenu = [...operatoriRowsFiltered, ...operatoriRowsOggiFiltered];
  const operators = uniqueValues(righeMenu, "Operatore");
  const campaigns = uniqueValues(righeMenu, "Campagna");

  return (
    <Container>
      {/* operatoriAmmessi: gli utenti HubSpot con Team Principale "Advisor".
          Sono le colonne dell'agenda, tutte - anche chi oggi non ha niente,
          perche' "questo advisor e' libero" e' un'informazione quanto il
          contrario - e insieme il filtro: l'agenda legge i meeting di TUTTO il
          portale e senza questo elenco mostrerebbe anche chi advisor non e'.
          Null quando il foglio degli utenti non risponde: meglio l'agenda
          intera che nessuna agenda.

          gestioneTeam: i nomi si cliccano per vedere e cambiare i loro team
          su HubSpot. Ce l'ha anche la pagina Setter, e deve averla: spostando
          un Advisor ai Setter la sua riga sparisce da qui, e senza la finestra
          di la' non si potrebbe piu' riportarlo indietro. Le pagine pubbliche
          restano in sola lettura. */}
      <AdvisorSetterDashboardClient
        operatoriRows={operatoriRowsFiltered}
        operatoriRowsOggi={operatoriRowsOggiFiltered}
        operators={operators}
        campaigns={campaigns}
        operatorLabel="Advisor"
        operatoriAmmessi={advisorNomi}
        sottoTeamPerPersona={team?.sottoTeam}
        sottoTeamStoria={team?.sottoTeamStoria}
        periodiNelTeam={team?.periodiNelTeam}
        fuoriSquadra={fuoriSquadra}
        gestioneTeam
      />
    </Container>
  );
}
