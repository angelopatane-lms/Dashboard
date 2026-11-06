/**
 * Aggiunge a `report_inviato` la colonna che dice com'e' andata la copia
 * privata del report.
 *
 * PERCHE' SERVE. La riga del giorno dimostra che il messaggio e' arrivato sul
 * canale: se Slack lo rifiuta, il codice la cancella apposta. La copia privata
 * invece e' best-effort - se non parte, il report sul canale resta valido e
 * dell'errore non resta traccia. Con questa colonna la traccia c'e'.
 *
 * E' una aggiunta e basta: colonna nuova, che puo' restare vuota, e il codice
 * di adesso non la guarda. Si toglie con
 *   ALTER TABLE report_inviato DROP COLUMN copia_privata;
 */
import "./env";
import { getDb } from "../src/lib/db";

(async () => {
  const db = getDb();
  await db.query(`ALTER TABLE report_inviato ADD COLUMN IF NOT EXISTS copia_privata text`);
  const { rows } = await db.query<{ colonna: string; tipo: string }>(
    `SELECT column_name AS colonna, data_type AS tipo
       FROM information_schema.columns
      WHERE table_name = 'report_inviato'
      ORDER BY ordinal_position`
  );
  console.log("report_inviato adesso:");
  for (const r of rows) console.log(`   ${r.colonna.padEnd(16)} ${r.tipo}`);
  process.exit(0);
})();
