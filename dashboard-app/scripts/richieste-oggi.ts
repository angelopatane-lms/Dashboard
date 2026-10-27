import "./env";
import { getDb } from "../src/lib/db";
const ora = (t: string | null) =>
  t ? new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" }).format(new Date(t)) : "--:--";
(async () => {
  const { rows } = await getDb().query<any>(
    `SELECT chiesto_at::text, ricevuto_at::text, nome, ruolo, esito, motivo, lead, serie,
            richiesta_n, pendenti, appuntamenti
       FROM assegnazione_richiesta WHERE giorno = CURRENT_DATE ORDER BY chiesto_at`);
  console.log(`RICHIESTE DI OGGI: ${rows.length}\n`);
  console.log("  chiesto  servito  attesa  persona                  n  esito     lead  pend  app  motivo");
  for (const r of rows) {
    const att = r.chiesto_at && r.ricevuto_at
      ? Math.round((new Date(r.ricevuto_at).getTime() - new Date(r.chiesto_at).getTime()) / 1000) : null;
    console.log("  %s".replace("%s",
      `${ora(r.chiesto_at)}    ${ora(r.ricevuto_at)}    ${att === null ? "   -" : String(att).padStart(4) + "s"}  ` +
      `${String(r.nome ?? "-").padEnd(24)} ${String(r.richiesta_n ?? "-").padStart(2)}  ${String(r.esito ?? "-").padEnd(9)} ` +
      `${String(r.lead ?? "-").padStart(4)}  ${String(r.pendenti ?? "-").padStart(4)}  ${String(r.appuntamenti ?? "-").padStart(3)}  ${String(r.motivo ?? "").slice(0, 46)}`));
  }
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
