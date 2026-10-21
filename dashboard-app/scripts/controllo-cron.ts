import "./env";
import { getDb } from "../src/lib/db";
const ore = (t: string | null) => {
  if (!t) return "mai";
  const h = (Date.now() - new Date(t).getTime()) / 3600000;
  return h < 48 ? `${h.toFixed(1)} ore fa` : `${(h / 24).toFixed(1)} giorni fa`;
};
(async () => {
  const db = getDb();
  const q = async (sql: string) => (await db.query(sql).catch(() => ({ rows: [] as any[] }))).rows;

  console.log("=== SYNC_LOG: ultimo esito per tipo ===");
  for (const r of await q(`SELECT tipo, esito, MAX(finito_at)::text AS ultimo, COUNT(*)::text AS giri
       FROM sync_log WHERE finito_at > now() - interval '7 days'
      GROUP BY 1,2 ORDER BY 1,2`)) {
    console.log(`  ${String(r.tipo).padEnd(16)} ${String(r.esito).padEnd(8)} ultimo ${ore(r.ultimo).padEnd(14)} ${r.giri} giri in 7gg`);
  }

  console.log("\n=== CRON DELLA DASHBOARD, prova dai dati ===");
  const prove: Array<[string, string]> = [
    ["report-giornaliero", `SELECT MAX(inviato_at)::text AS t FROM report_inviato`],
    ["marketing-snapshot", `SELECT MAX(preso_at)::text AS t FROM marketing_snapshot`],
    ["stati-lead (webhook)", `SELECT MAX(quando)::text AS t FROM stato_lead_storia`],
    ["conversioni (eventi)", `SELECT MAX(ts)::text AS t FROM eventi_conversione`],
    ["chiamate", `SELECT MAX(ts)::text AS t FROM chiamata`],
    ["trattative", `SELECT MAX(creata_ts)::text AS t FROM trattativa`],
    ["assegnati oggi (cache)", `SELECT MAX(preso_at)::text AS t FROM assegnati_oggi_cache`]
  ];
  for (const [nome, sql] of prove) {
    const r = await q(sql);
    console.log(`  ${nome.padEnd(24)} ultimo dato ${ore(r[0]?.t ?? null)}`);
  }

  console.log("\n=== PESO DEL DATABASE ===");
  for (const r of await q(`SELECT relname AS tabella, pg_size_pretty(pg_total_relation_size(c.oid)) AS dim,
            pg_total_relation_size(c.oid) AS b
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY b DESC LIMIT 8`)) {
    console.log(`  ${String(r.tabella).padEnd(26)} ${r.dim}`);
  }
  const tot = await q(`SELECT pg_size_pretty(pg_database_size(current_database())) AS d`);
  console.log(`  ${"TOTALE".padEnd(26)} ${tot[0]?.d}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
