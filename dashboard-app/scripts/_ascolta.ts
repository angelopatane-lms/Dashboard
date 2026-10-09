
import "./env";
import { getDb } from "@/lib/db";
const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const db = getDb();
  const da = new Date().toISOString();
  for (let i = 0; i < 24; i++) {
    const r = await db.query(
      `SELECT iniziato_at, esito, left(coalesce(messaggio,''), 300) m FROM sync_log
        WHERE tipo = 'webhook-hubspot' AND iniziato_at > $1::timestamptz
        ORDER BY iniziato_at DESC LIMIT 10`,
      [da]
    );
    const vere = r.rows.filter((x: any) => !String(x.m).includes("provasbagliata") && !String(x.m).includes("arrivati 14"));
    if (vere.length) {
      for (const x of vere) console.log("  ", x.iniziato_at.toISOString(), x.esito, "|", x.m);
      process.exit(0);
    }
    await attesa(20000);
  }
  console.log("niente in otto minuti");
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
