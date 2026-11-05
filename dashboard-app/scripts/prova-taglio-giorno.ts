/**
 * Il taglio del giorno: a mezzanotte di Roma o a mezzanotte del server?
 *
 * Le rotte della tabella confrontano `svolta_ts` con una data nuda, quindi
 * usano il fuso del server; la fotografia delle squadre e il report delle 8
 * convertono a Europe/Rome. Su un giorno singolo le due strade possono
 * differire di qualche consulenza. Questo script lo misura.
 */
import "./env";
import { getDb } from "../src/lib/db";

(async () => {
  const giorno = process.argv[2] ?? "2026-11-04";
  const db = getDb();

  const { rows } = await db.query<{ roma: string; server: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE t.svolta_ts >= ($1::date::timestamp AT TIME ZONE 'Europe/Rome')
                          AND t.svolta_ts <  (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Rome'))::text AS roma,
       COUNT(*) FILTER (WHERE t.svolta_ts >= $1::date
                          AND t.svolta_ts <  ($1::date + INTERVAL '1 day'))::text AS server
     FROM trattativa t
     WHERE t.svolta_ts >= ($1::date - INTERVAL '1 day') AND t.svolta_ts < ($1::date + INTERVAL '2 day')`,
    [giorno]
  );
  console.log(`TUTTE LE CONSULENZE DEL ${giorno}`);
  console.log(`   taglio di Roma:   ${rows[0].roma}`);
  console.log(`   taglio del server: ${rows[0].server}`);

  const d = await db.query<{ roma: string; grezzo: string; setter: string }>(
    `SELECT to_char(t.svolta_ts AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD HH24:MI') AS roma,
            to_char(t.svolta_ts, 'YYYY-MM-DD HH24:MI') AS grezzo,
            COALESCE(p.nome, '-') AS setter
       FROM trattativa t
       LEFT JOIN proprietario p ON p.id = t.setter_id
      WHERE t.svolta_ts >= ($1::date::timestamp AT TIME ZONE 'Europe/Rome')
        AND t.svolta_ts <  (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Rome')
        AND (t.svolta_ts < $1::date OR t.svolta_ts >= ($1::date + INTERVAL '1 day'))
      ORDER BY 1`,
    [giorno]
  );
  console.log(`\nLE CONSULENZE CHE CADONO DA UNA PARTE SOLA: ${d.rows.length}`);
  for (const r of d.rows) console.log(`   ${r.roma} a Roma (${r.grezzo} grezzo)  setter ${r.setter}`);
  process.exit(0);
})();
