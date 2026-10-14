/**
 * Manda a Sales Copilot le trattative dei chatter gia' passate.
 *
 * Si lancia a mano, una volta: `npx tsx scripts/storico-copilot.ts 2026-06-01`
 * Senza --vai fa solo il conto, senza mandare niente.
 */
import "./env";
import { richiedi } from "./env";
import { storicoACopilot } from "../src/lib/copilot/trattative";
import { getDb } from "../src/lib/db";

(async () => {
  const da = process.argv[2] ?? "2026-06-01";
  const vai = process.argv.includes("--vai");
  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");

  const q = await getDb().query(
    `SELECT count(*) AS n, min(creata_ts)::date AS dal, max(creata_ts)::date AS al
       FROM trattativa WHERE creata_ts >= $1::date AND setter_id IS NOT NULL`, [da]);
  const x = q.rows[0] as any;
  console.log(`trattative con un setter dal ${da}: ${x.n} (dal ${String(x.dal).slice(0,10)} al ${String(x.al).slice(0,10)})`);
  console.log(`di queste, quelle dei chatter le conta lo storico stesso.`);

  if (!vai) {
    console.log("(prova a vuoto: aggiungi --vai per mandarle davvero)");
    return;
  }
  const arg = process.argv.find((a) => a.startsWith("--lotto="));
  const lotto = arg ? Number(arg.split("=")[1]) : 100;
  const e = await storicoACopilot(da, token, { lotto });
  console.log(`MANDATE: ${e.trattative} trattative in ${e.lotti} lotti, agganciate ${e.agganciate}, errori ${e.errori}`);
})().then(() => process.exit(0)).catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
