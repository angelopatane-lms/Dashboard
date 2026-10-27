import "./env";
import { getDb } from "../src/lib/db";
const o = (t: string) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
(async () => {
  const db = getDb();
  const p = await db.query<any>(
    `SELECT preso_at::text, pool_a, assegnabili_a, esteso_a, pool_b, assegnabili_b, esteso_b, riserva
       FROM assegnazione_pool WHERE preso_at::date = CURRENT_DATE ORDER BY preso_at`);
  console.log("SERBATOIO OGGI, fotografia per fotografia:\n");
  console.log("  ora     serie A: assegnabili / esteso / totale     serie B: assegnabili / esteso / totale   riserva");
  for (const r of p.rows) {
    console.log(`  ${o(r.preso_at)}   ${String(r.assegnabili_a).padStart(6)} / ${String(r.esteso_a ?? "-").padStart(6)} / ${String(r.pool_a).padStart(6)}` +
      `            ${String(r.assegnabili_b).padStart(6)} / ${String(r.esteso_b ?? "-").padStart(6)} / ${String(r.pool_b).padStart(6)}     ${r.riserva}`);
  }
  const r = await db.query<any>(
    `SELECT chiesto_at::text, nome, esito, lead, pendenti, motivo FROM assegnazione_richiesta
      WHERE giorno = CURRENT_DATE ORDER BY chiesto_at`);
  console.log("\nRICHIESTE DI OGGI:");
  for (const x of r.rows) console.log(`  ${o(x.chiesto_at)}  ${String(x.nome).padEnd(20)} ${String(x.esito).padEnd(10)} lead=${String(x.lead).padStart(3)} pend=${String(x.pendenti).padStart(3)}  ${x.motivo ?? ""}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
