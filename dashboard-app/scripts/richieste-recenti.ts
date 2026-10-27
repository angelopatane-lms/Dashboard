import "./env";
import { getDb } from "../src/lib/db";
const o = (t: string | null) =>
  t ? new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t)) : "-";
(async () => {
  const { rows } = await getDb().query<any>(
    `SELECT chiesto_at::text, nome, ruolo, esito, lead, serie, richiesta_n, pendenti, motivo
       FROM assegnazione_richiesta WHERE giorno >= CURRENT_DATE - 2 ORDER BY chiesto_at DESC LIMIT 40`);
  console.log("ULTIME RICHIESTE (le piu' recenti in alto)\n");
  console.log("  quando        persona                   n  esito       lead  pend  motivo");
  let precedente: any = null;
  for (const r of rows) {
    const doppio = precedente && precedente.nome === r.nome && (precedente.lead ?? 0) > 0 && (r.lead ?? 0) > 0;
    console.log(`  ${o(r.chiesto_at)}  ${String(r.nome ?? "-").padEnd(24)} ${String(r.richiesta_n ?? "-").padStart(2)}  ` +
      `${String(r.esito ?? "-").padEnd(10)} ${String(r.lead ?? "-").padStart(4)}  ${String(r.pendenti ?? "-").padStart(4)}  ` +
      `${String(r.motivo ?? "").slice(0, 44)}${doppio ? "   <-- DUE DI FILA" : ""}`);
    precedente = r;
  }
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
