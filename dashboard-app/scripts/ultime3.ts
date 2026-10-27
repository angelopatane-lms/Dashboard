import "./env";
import { getDb } from "../src/lib/db";
const o = (t: string) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
(async () => {
  const { rows } = await getDb().query<any>(
    `SELECT chiesto_at::text, nome, esito, lead, serie, pendenti, motivo, contatti
       FROM assegnazione_richiesta ORDER BY chiesto_at DESC LIMIT 3`);
  for (const r of rows) {
    console.log(`\n${o(r.chiesto_at)}  ${r.nome}  —  ${r.esito}, ${r.lead ?? 0} lead`);
    console.log(`   motivo: ${r.motivo ?? "-"}`);
    console.log(`   serie: ${JSON.stringify(r.serie)}`);
    const c = r.contatti;
    if (c) console.log(`   contatti: ${typeof c === "string" ? c.slice(0, 300) : JSON.stringify(c).slice(0, 300)}`);
  }
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
