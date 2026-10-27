/**
 * La Dashboard sa raccontare le assegnazioni dei giorni scorsi? E i contatori
 * del serbatoio sono allineati con quelli dell'app?
 *
 * COME SI LANCIA
 *   npx tsx scripts/dashboard-assegnazioni-stato.ts
 *
 * PERCHE'. Il 27 ottobre 2026 nella sezione Assegnazione Contatti non si
 * vedevano gli assegnati di ieri ne' di sabato, ma si vedevano i rifiuti. I
 * due dati arrivano da strade diverse:
 *   - i RIFIUTI e tutte le richieste: li scrive l'app nel nostro database a
 *     ogni richiesta (webhook), quindi ci sono sempre;
 *   - il DETTAGLIO per persona: lo calcola la Dashboard da HubSpot, ma SOLO
 *     mentre la giornata e' in corso, e solo quando qualcuno apre la pagina.
 *     Un giorno in cui nessuno l'ha aperta resta vuoto per sempre, perche'
 *     `hubspot_owner_assigneddate` e' un valore unico che la riassegnazione
 *     successiva sovrascrive: dopo non e' piu' ricostruibile da HubSpot.
 *
 * Qui si misura quali giorni hanno l'archivio e quali no, e si mostra che per
 * quelli mancanti il dato per persona si puo' ricostruire dalle richieste -
 * che sono complete.
 */
import "./env";
import { getDb } from "../src/lib/db";

(async () => {
  const db = getDb();

  console.log("\nARCHIVIO DEL DETTAGLIO PER PERSONA (assegnazione_giorno_calcolo)");
  const c = await db.query<{ giorno: string; totale: number; persone: number; atteso: number | null; quando: string }>(
    `SELECT giorno::text, totale, persone, atteso, aggiornato_at::text AS quando
       FROM assegnazione_giorno_calcolo WHERE giorno >= CURRENT_DATE - 10 ORDER BY giorno DESC`);
  console.log("  giorno        totale  persone  atteso dall'app  calcolato alle");
  for (const r of c.rows)
    console.log(`  ${r.giorno}  ${String(r.totale).padStart(6)}  ${String(r.persone).padStart(7)}  ${String(r.atteso ?? "-").padStart(15)}  ${r.quando.slice(0, 19)}`);
  if (!c.rows.length) console.log("  (nessun giorno in archivio)");

  console.log("\nFOTOGRAFIE DEL SERBATOIO (assegnazione_pool)");
  const p = await db.query<{ giorno: string; quante: number; ultima: string }>(
    `SELECT preso_at::date::text AS giorno, count(*)::int AS quante, max(preso_at)::text AS ultima
       FROM assegnazione_pool WHERE preso_at >= CURRENT_DATE - 10 GROUP BY 1 ORDER BY 1 DESC`);
  for (const r of p.rows) console.log(`  ${r.giorno}  ${String(r.quante).padStart(4)} fotografie, ultima ${r.ultima.slice(11, 19)}`);
  if (!p.rows.length) console.log("  (nessuna fotografia)");

  console.log("\nCOSA SI RECUPERA DALLE RICHIESTE (sempre complete, scritte dall'app)");
  const r = await db.query<{ giorno: string; richieste: number; servite: number; lead: number; persone: number }>(
    `SELECT giorno::text, count(*)::int AS richieste,
            count(*) FILTER (WHERE esito = 'assegnato')::int AS servite,
            coalesce(sum(lead) FILTER (WHERE esito = 'assegnato'), 0)::int AS lead,
            count(DISTINCT nome) FILTER (WHERE esito = 'assegnato')::int AS persone
       FROM assegnazione_richiesta WHERE giorno >= CURRENT_DATE - 10 GROUP BY 1 ORDER BY 1 DESC`);
  console.log("  giorno        richieste  servite   lead  persone   archivio presente?");
  const conArchivio = new Set(c.rows.map((x) => x.giorno));
  for (const x of r.rows)
    console.log(`  ${x.giorno}  ${String(x.richieste).padStart(9)}  ${String(x.servite).padStart(7)}  ${String(x.lead).padStart(5)}  ${String(x.persone).padStart(7)}   ${conArchivio.has(x.giorno) ? "si" : "NO -> pagina vuota"}`);

  console.log("\nDETTAGLIO PER PERSONA RICOSTRUITO DALLE RICHIESTE, ultimi 3 giorni con dati:");
  const d = await db.query<{ giorno: string; nome: string; lead: number; richieste: number }>(
    `SELECT giorno::text, nome, sum(lead)::int AS lead, count(*)::int AS richieste
       FROM assegnazione_richiesta
      WHERE giorno >= CURRENT_DATE - 3 AND esito = 'assegnato' AND nome IS NOT NULL
      GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC`);
  let giornoCorrente = "";
  for (const x of d.rows) {
    if (x.giorno !== giornoCorrente) { console.log(`\n  ${x.giorno}:`); giornoCorrente = x.giorno; }
    console.log(`     ${String(x.lead).padStart(4)} lead  in ${x.richieste} richieste   ${x.nome}`);
  }
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
