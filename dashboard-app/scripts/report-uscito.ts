/** E' uscito il report? Solo la traccia nel database, senza ricalcolare niente. */
import "./env";
import { getDb } from "../src/lib/db";

(async () => {
  const db = getDb();
  const quando = `to_char(inviato_at AT TIME ZONE 'Europe/Rome', 'DD/MM HH24:MI:SS') AS ora`;
  const r = await db
    .query<{ giorno: string; ora: string; copia: string | null }>(
      `SELECT to_char(giorno, 'YYYY-MM-DD') AS giorno, ${quando}, copia_privata AS copia
         FROM report_inviato ORDER BY giorno DESC LIMIT 3`
    )
    .catch(() =>
      db.query<{ giorno: string; ora: string; copia: string | null }>(
        `SELECT to_char(giorno, 'YYYY-MM-DD') AS giorno, ${quando}, NULL::text AS copia
           FROM report_inviato ORDER BY giorno DESC LIMIT 3`
      )
    );
  for (const x of r.rows) {
    console.log(`${x.giorno}  mandato il ${x.ora}` + (x.copia ? `  copia privata -> ${x.copia}` : ""));
  }
  process.exit(0);
})();
