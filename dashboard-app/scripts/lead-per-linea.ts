import "./env";
import { getDb } from "../src/lib/db";
import { leggiVariante } from "../src/lib/campagne";
import { costruisciQuery } from "../src/lib/queryConversioni";
const famiglia = (c: string) => {
  const s = c.toLowerCase();
  if (s.includes("icmd")) return "ICMD";
  if (s.includes("div_coach") || s.includes("coach")) return "DIV COACH";
  if (s.includes("mbe")) return "MBE";
  if (s.includes("rem")) return "REM";
  if (s.includes("mep")) return "MEP";
  if (s.includes("sales")) return "SALES";
  return "altro";
};
(async () => {
  const [da, a] = [process.argv[2], process.argv[3]];
  const { rows } = await getDb().query<{ campagna: string; lead_generati: number; lead_unici: number }>(
    costruisciQuery(leggiVariante(null)), [da, a]);
  const g: Record<string, { gen: number; uni: number; camp: number }> = {};
  for (const r of rows) {
    const f = famiglia(r.campagna);
    g[f] ??= { gen: 0, uni: 0, camp: 0 };
    g[f].gen += Number(r.lead_generati);
    g[f].uni += Number(r.lead_unici);
    g[f].camp += 1;
  }
  const tot = Object.values(g).reduce((s, x) => s + x.gen, 0);
  console.log(`\nLEAD GENERATI DAL MARKETING, ${da} → ${a}\n`);
  console.log("  linea        lead generati   lead nuovi   campagne   quota");
  for (const [k, v] of Object.entries(g).sort((x, y) => y[1].gen - x[1].gen)) {
    console.log(`  ${k.padEnd(11)} ${String(v.gen).padStart(11)} ${String(v.uni).padStart(12)} ${String(v.camp).padStart(10)}   ${(100 * v.gen / tot).toFixed(0)}%`);
  }
  console.log(`  ${"TOTALE".padEnd(11)} ${String(tot).padStart(11)}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
