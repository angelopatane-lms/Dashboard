/**
 * Il report delle 8 e' uscito? E dice i numeri giusti?
 *
 *   npx tsx scripts/controlla-report.ts            ieri
 *   npx tsx scripts/controlla-report.ts 2026-11-05 un giorno preciso
 *
 * Legge la tabella `report_inviato` - una riga per giorno consegnato, con
 * l'ora e l'esito della copia privata - e ricalcola il report di quel giorno
 * SENZA mandarlo su Slack, cosi' si vede cosa direbbe. Non manda niente e non
 * scrive niente.
 *
 * COSA VUOL DIRE UNA RIGA. Che il messaggio e' arrivato sul CANALE: se Slack
 * lo rifiuta, la rotta cancella la riga apposta, perche' la seconda sveglia
 * possa riprovare. La colonna `copia_privata` dice com'e' andata la copia a
 * chi la riceve in privato, che invece e' best-effort e non fa fallire il
 * giro.
 */
import "./env";
import { getDb } from "../src/lib/db";
import { ieriRoma, reportDelGiorno, messaggio } from "../src/lib/report/giornaliero";
import { operatoriDelTeam } from "../src/lib/operatoriTeam";

type Riga = { giorno: string; ora: string; copia: string | null };

(async () => {
  const giorno = process.argv[2] ?? ieriRoma();
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const db = getDb();

  const quando = `to_char(inviato_at AT TIME ZONE 'Europe/Rome', 'DD/MM HH24:MI') AS ora`;
  // La colonna dell'esito e' nata il 6 novembre 2026: sui giorni di prima non
  // c'e', e sulle installazioni che non l'hanno ancora non c'e' affatto.
  const righe = await db
    .query<Riga>(
      `SELECT to_char(giorno, 'YYYY-MM-DD') AS giorno, ${quando}, copia_privata AS copia
         FROM report_inviato ORDER BY giorno DESC LIMIT 8`
    )
    .catch(() =>
      db.query<Riga>(
        `SELECT to_char(giorno, 'YYYY-MM-DD') AS giorno, ${quando}, NULL::text AS copia
           FROM report_inviato ORDER BY giorno DESC LIMIT 8`
      )
    );

  console.log("GIORNI CONSEGNATI SUL CANALE (dal piu' recente):");
  for (const r of righe.rows) {
    console.log(
      `   ${r.giorno}   mandato il ${r.ora}` + (r.copia ? `   copia privata -> ${r.copia}` : "")
    );
  }

  console.log(`\nRICALCOLO DEL REPORT DEL ${giorno} (non viene mandato):\n`);
  const team = await operatoriDelTeam("Setter").catch(() => null);
  const r = await reportDelGiorno({ token, data: giorno, sottoTeam: team?.sottoTeam });
  console.log(messaggio(r));
  process.exit(0);
})();
