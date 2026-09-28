// Confronta Chiamate e Connessioni: foglio Operatori contro HubSpot.
//
// SERVE A DECIDERE SE CAMBIARE FONTE. Oggi la tabella Advisor legge quelle due
// colonne dal foglio, che un'automazione esterna riempie e che a volte non
// viene riempito: il 28 settembre un advisor risultava con 136 lead assegnati e
// 3 chiamate, e la percentuale di appuntamento gli usciva al 400% perche' il
// numeratore arriva da HubSpot e il denominatore dal foglio.
//
// Prima di spostare la colonna su HubSpot bisogna sapere di quanto cambiano i
// numeri e su chi: dove il foglio e' vuoto si guadagna, ma se qualcuno telefona
// con uno strumento che non registra la chiamata nel CRM si perde. Questo
// script mette le due fonti una accanto all'altra.
//
// Uso: npx tsx scripts/confronta-chiamate.ts 2026-09-01 2026-09-30

import { richiedi } from "./env";
import { getDb } from "../src/lib/db";
import { parseCsv } from "../src/lib/csv";
import { getString, toDateIso, toNumber } from "../src/lib/metrics";

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID_OPERATORI = "245526930";
const GID_OPERATORI_OGGI = "2032731939";

const chiave = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");

async function foglio(gid: string): Promise<string> {
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`,
    { headers: { accept: "text/csv" } }
  );
  if (!res.ok) throw new Error(`foglio ${gid}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const dal = process.argv[2] ?? "2026-09-01";
  const al = process.argv[3] ?? "2026-09-30";
  richiedi("DATABASE_URL");

  const righe = [...parseCsv(await foglio(GID_OPERATORI)), ...parseCsv(await foglio(GID_OPERATORI_OGGI))];
  const daFoglio: Record<string, { chiamate: number; connessioni: number }> = {};
  for (const r of righe) {
    const data = toDateIso(getString(r, "Data"));
    if (!data || data < dal || data > al) continue;
    const op = chiave(getString(r, "Operatore"));
    if (!op) continue;
    const v = (daFoglio[op] = daFoglio[op] ?? { chiamate: 0, connessioni: 0 });
    v.chiamate += toNumber(r["Chiamati"] ?? r["Chiamate"]);
    v.connessioni += toNumber(r["Connessi"] ?? r["Connessioni"]);
  }

  const { rows } = await getDb().query<{ operatore: string; chiamate: string; connessioni: string }>(
    `SELECT p.nome AS operatore,
            COUNT(*)::text AS chiamate,
            COUNT(*) FILTER (WHERE ch.connessa)::text AS connessioni
       FROM chiamata ch
       JOIN proprietario p ON p.id = ch.proprietario_id
      WHERE ch.ts >= $1::date AND ch.ts < ($2::date + INTERVAL '1 day')
      GROUP BY 1`,
    [dal, al]
  );
  const daHubspot: Record<string, { chiamate: number; connessioni: number }> = {};
  for (const r of rows) {
    daHubspot[chiave(r.operatore)] = { chiamate: Number(r.chiamate), connessioni: Number(r.connessioni) };
  }

  const nomi = [...new Set([...Object.keys(daFoglio), ...Object.keys(daHubspot)])].sort();
  const nome = (k: string) => k.replace(/\b\w/g, (c) => c.toUpperCase());

  console.log(`\nCHIAMATE E CONNESSIONI, ${dal} - ${al}\n`);
  console.log("OPERATORE               FOGLIO              HUBSPOT             DIFFERENZA");
  let tf = 0;
  let th = 0;
  for (const k of nomi) {
    const f = daFoglio[k] ?? { chiamate: 0, connessioni: 0 };
    const h = daHubspot[k] ?? { chiamate: 0, connessioni: 0 };
    if (!f.chiamate && !h.chiamate) continue;
    tf += f.chiamate;
    th += h.chiamate;
    const scarto = h.chiamate - f.chiamate;
    const segno = scarto > 0 ? `+${scarto}` : String(scarto);
    console.log(
      `${nome(k).slice(0, 22).padEnd(23)} ${String(f.chiamate).padStart(6)}/${String(f.connessioni).padEnd(6)} ` +
        `${String(h.chiamate).padStart(7)}/${String(h.connessioni).padEnd(6)} ${segno.padStart(10)}`
    );
  }
  console.log(`${"TOTALE".padEnd(23)} ${String(tf).padStart(6)}        ${String(th).padStart(7)}        ${String(th - tf).padStart(10)}`);
  console.log("\n(a sinistra del / le chiamate, a destra le connessioni)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
