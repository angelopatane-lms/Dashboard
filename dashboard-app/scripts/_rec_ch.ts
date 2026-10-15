import "./env";
import { richiedi } from "./env";
import { sincronizzaChiamate } from "../src/lib/chiamate/sync";
import { getDb } from "../src/lib/db";

(async () => {
  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  const prima = await getDb().query(`SELECT count(*) AS n, max(ts)::date AS al FROM chiamata`);
  console.log(`prima: ${(prima.rows[0] as any).n} chiamate, fino al ${String((prima.rows[0] as any).al).slice(0, 10)}`);
  for (let giro = 1; giro <= 30; giro++) {
    const e = await sincronizzaChiamate(token, "incrementale");
    const q = await getDb().query(`SELECT max(ts)::date AS al FROM chiamata`);
    console.log(`giro ${String(giro).padStart(2)}: +${e.chiamate} chiamate (${e.connesse} connesse), troncato=${e.troncato}, arrivato al ${String((q.rows[0] as any).al).slice(0, 10)}`);
    if (!e.troncato) { console.log("ALLINEATO: il giro non si e' troncato."); break; }
  }
  const dopo = await getDb().query(`SELECT count(*) AS n, max(ts)::date AS al FROM chiamata`);
  console.log(`dopo: ${(dopo.rows[0] as any).n} chiamate, fino al ${String((dopo.rows[0] as any).al).slice(0, 10)}`);
})().then(() => process.exit(0)).catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
