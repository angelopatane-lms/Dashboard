import "./env";
import { getDb } from "../src/lib/db";
// Quanto tempo di compute costa il webhook, da solo: ogni scrittura tiene
// sveglio il database almeno 5 minuti, quindi si contano le finestre da 5
// minuti distinte in cui c'e' stata almeno una scrittura.
(async () => {
  const col = process.argv[2] ?? "visto_at";
  const { rows } = await getDb().query<any>(`
    SELECT giorno::text, finestre, finestre * 5 / 60.0 AS ore, scritture
      FROM (
        SELECT (${col} AT TIME ZONE 'Europe/Rome')::date AS giorno,
               count(DISTINCT date_trunc('hour', ${col}) + interval '5 min' * floor(extract(minute FROM ${col}) / 5)) AS finestre,
               count(*) AS scritture
          FROM stato_lead_storia
         WHERE ${col} > now() - interval '10 days'
         GROUP BY 1
      ) x ORDER BY giorno DESC`);
  console.log("IL WEBHOOK DEGLI STATI LEAD, DA SOLO (ogni scrittura = 5 minuti di compute):");
  console.log("  giorno       scritture   finestre da 5'   ore di compute");
  let ore = 0;
  for (const r of rows) {
    console.log(`  ${r.giorno}  ${String(r.scritture).padStart(9)}   ${String(r.finestre).padStart(14)}   ${Number(r.ore).toFixed(1).padStart(8)} h`);
    ore += Number(r.ore);
  }
  const media = ore / Math.max(rows.length, 1);
  console.log(`\n  media: ${media.toFixed(1)} ore al giorno = ${(media * 0.25 * 30).toFixed(0)} CU-ora al mese a 0,25 CU`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
