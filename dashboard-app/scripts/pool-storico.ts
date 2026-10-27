/**
 * Lo storico delle fotografie del serbatoio, giorno per giorno.
 *
 * COME SI LANCIA
 *   npx tsx scripts/pool-storico.ts         ultimi 10 giorni
 *   npx tsx scripts/pool-storico.ts 30      ultimi 30
 *
 * A COSA SERVE. `pool-oggi.ts` mostra le fotografie di oggi, e se oggi non ce
 * ne sono non si capisce se e' un guasto o se non ce ne sono mai state. Qui si
 * vede quando l'app ha smesso (o cominciato) a scriverle, e insieme quanti
 * lead ha assegnato ogni giorno: due numeri che vanno letti accanto, perche'
 * il serbatoio senza il consumo non dice se basta.
 */
import "./env";
import { getDb } from "../src/lib/db";

const giorni = Number(process.argv[2] || 10);

(async () => {
  const db = getDb();

  const f = await db.query<any>(
    `SELECT preso_at::date::text AS giorno, count(*) AS quante,
            min(assegnabili_a) AS min_ass_a, max(pool_a) AS max_pool_a,
            min(assegnabili_b) AS min_ass_b, max(pool_b) AS max_pool_b,
            max(preso_at)::text AS ultima
       FROM assegnazione_pool
      WHERE preso_at >= CURRENT_DATE - $1::int
      GROUP BY 1 ORDER BY 1 DESC`, [giorni]);

  console.log("\nFOTOGRAFIE DEL SERBATOIO");
  console.log("  giorno       quante   A assegnabili(min)/totale(max)   B assegnabili(min)/totale(max)   ultima");
  for (const r of f.rows)
    console.log(`  ${r.giorno}   ${String(r.quante).padStart(5)}   ${String(r.min_ass_a).padStart(10)} / ${String(r.max_pool_a).padStart(6)}        ${String(r.min_ass_b).padStart(10)} / ${String(r.max_pool_b).padStart(6)}      ${String(r.ultima).slice(11, 19)}`);
  if (!f.rows.length) console.log("  (nessuna fotografia negli ultimi giorni)");

  const r = await db.query<any>(
    `SELECT giorno::text, count(*) AS richieste,
            count(*) FILTER (WHERE esito = 'assegnato') AS ok,
            count(*) FILTER (WHERE esito <> 'assegnato') AS no,
            coalesce(sum(lead), 0) AS lead,
            count(DISTINCT nome) FILTER (WHERE esito = 'assegnato') AS persone,
            count(*) FILTER (WHERE motivo LIKE '%esteso%') AS con_esteso
       FROM assegnazione_richiesta
      WHERE giorno >= CURRENT_DATE - $1::int
      GROUP BY 1 ORDER BY 1 DESC`, [giorni]);

  console.log("\nRICHIESTE E CONSUMO");
  console.log("  giorno       richieste  assegnate  rifiutate   lead  persone   con pool esteso");
  for (const x of r.rows)
    console.log(`  ${x.giorno}   ${String(x.richieste).padStart(9)}  ${String(x.ok).padStart(9)}  ${String(x.no).padStart(9)}  ${String(x.lead).padStart(5)}  ${String(x.persone).padStart(7)}   ${String(x.con_esteso).padStart(15)}`);

  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
