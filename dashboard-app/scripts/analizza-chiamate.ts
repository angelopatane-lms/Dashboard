// Misura se le chiamate HubSpot sono attribuibili a una campagna, PRIMA di
// costruire la sincronizzazione vera.
//
// La domanda a cui risponde: una chiamata e' associata a un contatto, e quel
// contatto ha uno storico di campagne con i timestamp. Attribuiamo la chiamata
// alla campagna che il contatto aveva IN QUEL MOMENTO (l'ultima conversione
// precedente alla chiamata). Ma quante chiamate riescono davvero ad essere
// attribuite? Se la copertura fosse bassa, la colonna Connessioni sarebbe piena
// di buchi e non varrebbe l'ora di scansione.
//
// Non scrive nulla: legge da HubSpot e interroga Postgres in sola lettura.
//
// Uso: npm run analizza:chiamate -- --per-mese 200

import { richiedi } from "./env";
import { Client } from "pg";

const CONNESSO = "f240bbac-87c9-4f6e-bf70-924b57d47db7";
const H = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
// Mesi campionati: inizio, meta' e fine del periodo con spesa Ads.
const MESI = ["2026-01", "2026-04", "2026-08"];

type Chiamata = { id: string; ts: string; connessa: boolean };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function chiamateDelMese(token: string, mese: string, quante: number): Promise<Chiamata[]> {
  const da = new Date(`${mese}-01T00:00:00Z`).getTime();
  const [y, m] = mese.split("-").map(Number);
  const a = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).getTime();

  const out: Chiamata[] = [];
  let after: string | undefined;
  while (out.length < quante) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/calls/search", {
      method: "POST",
      headers: H(token),
      body: JSON.stringify({
        limit: 100,
        properties: ["hs_call_disposition", "hs_timestamp"],
        sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
        filterGroups: [
          { filters: [{ propertyName: "hs_timestamp", operator: "BETWEEN", value: String(da), highValue: String(a) }] }
        ],
        ...(after ? { after } : {})
      })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${d.message ?? ""}`);
    for (const r of d.results ?? []) {
      if (out.length >= quante) break;
      out.push({
        id: r.id,
        ts: r.properties.hs_timestamp,
        connessa: r.properties.hs_call_disposition === CONNESSO
      });
    }
    after = d.paging?.next?.after;
    if (!after) break;
    await sleep(200);
  }
  return out;
}

/** Contatto associato a ogni chiamata: la ricerca non lo restituisce, serve una lettura a parte. */
async function contattiDelleChiamate(token: string, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const gruppo = ids.slice(i, i + 100);
    const res = await fetch("https://api.hubapi.com/crm/v4/associations/calls/contacts/batch/read", {
      method: "POST",
      headers: H(token),
      body: JSON.stringify({ inputs: gruppo.map((id) => ({ id })) })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(`associazioni ${res.status}: ${d.message ?? ""}`);
    for (const r of d.results ?? []) {
      const primo = r.to?.[0]?.toObjectId;
      if (primo) out.set(String(r.from?.id ?? r._from?.id), Number(primo));
    }
    await sleep(200);
  }
  return out;
}

function riga(etichetta: string, valore: string | number, tot?: number): string {
  const pct = typeof valore === "number" && tot ? `  (${((valore / tot) * 100).toFixed(1)}%)` : "";
  const v = typeof valore === "number" ? valore.toLocaleString("it-IT") : valore;
  return `  ${etichetta.padEnd(46, ".")} ${String(v).padStart(7)}${pct}`;
}

async function main() {
  const i = process.argv.indexOf("--per-mese");
  const perMese = i === -1 ? 200 : Number(process.argv[i + 1]);
  if (!Number.isInteger(perMese) || perMese <= 0) throw new Error("--per-mese richiede un intero positivo");

  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  const cl = new Client({ connectionString: richiedi("DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await cl.connect();

  console.log(`[analisi] ${perMese} chiamate per ciascun mese: ${MESI.join(", ")}. Nessuna scrittura.\n`);

  const tutte: Chiamata[] = [];
  for (const mese of MESI) {
    const c = await chiamateDelMese(token, mese, perMese);
    console.log(`  ${mese}: ${c.length} chiamate lette (${c.filter((x) => x.connessa).length} connesse)`);
    tutte.push(...c);
  }

  const contatti = await contattiDelleChiamate(token, tutte.map((c) => c.id));
  console.log(`  associazioni al contatto risolte: ${contatti.size}/${tutte.length}\n`);

  // Per ogni chiamata, la campagna che il contatto aveva in quel momento.
  const conContatto = tutte.filter((c) => contatti.has(c.id));
  const cids = conContatto.map((c) => contatti.get(c.id)!);
  const tss = conContatto.map((c) => new Date(c.ts));

  const { rows } = await cl.query(
    `SELECT x.idx::int AS idx, camp.nome AS campagna, ev.ts AS ts_conversione
     FROM unnest($1::bigint[], $2::timestamptz[]) WITH ORDINALITY AS x(cid, t, idx)
     LEFT JOIN LATERAL (
       SELECT e.campagna_id, e.ts
       FROM eventi_conversione e
       WHERE (e.contact_id = x.cid
              OR e.contact_id IN (SELECT vecchio_id FROM alias_contatto WHERE nuovo_id = x.cid))
         AND e.ts <= x.t
       ORDER BY e.ts DESC
       LIMIT 1
     ) ev ON true
     LEFT JOIN campagna camp ON camp.id = ev.campagna_id`,
    [cids, tss]
  );

  const perIdx = new Map<number, { campagna: string | null; ts: string | null }>();
  for (const r of rows) perIdx.set(r.idx, { campagna: r.campagna, ts: r.ts_conversione });

  let attribuite = 0;
  let senzaConversionePrecedente = 0;
  const perCampagna = new Map<string, number>();
  const giorniAttesa: number[] = [];

  conContatto.forEach((c, k) => {
    const info = perIdx.get(k + 1);
    if (info?.campagna) {
      attribuite += 1;
      if (c.connessa) perCampagna.set(info.campagna, (perCampagna.get(info.campagna) ?? 0) + 1);
      if (info.ts) giorniAttesa.push((new Date(c.ts).getTime() - new Date(info.ts).getTime()) / 86400_000);
    } else {
      senzaConversionePrecedente += 1;
    }
  });

  const tot = tutte.length;
  const senzaContatto = tot - conContatto.length;

  console.log("=".repeat(64));
  console.log("  ATTRIBUZIONE DELLE CHIAMATE A UNA CAMPAGNA");
  console.log("=".repeat(64));
  console.log(riga("Chiamate nel campione", tot));
  console.log(riga("Attribuite a una campagna", attribuite, tot));
  console.log(riga("Senza contatto associato", senzaContatto, tot));
  console.log(riga("Contatto senza conversioni prima della chiamata", senzaConversionePrecedente, tot));

  const copertura = (attribuite / Math.max(1, tot)) * 100;
  console.log("");
  if (copertura >= 80) console.log(`  >> COPERTURA ${copertura.toFixed(1)}%: ottima, la colonna Connessioni sarebbe affidabile.`);
  else if (copertura >= 60) console.log(`  >> COPERTURA ${copertura.toFixed(1)}%: utilizzabile, ma una quota va dichiarata come "non attribuita".`);
  else console.log(`  >> COPERTURA ${copertura.toFixed(1)}%: troppo bassa. La colonna sarebbe piu' fuorviante che utile.`);

  if (giorniAttesa.length) {
    const ord = [...giorniAttesa].sort((a, b) => a - b);
    const p = (q: number) => ord[Math.min(ord.length - 1, Math.floor((q / 100) * ord.length))];
    console.log("\n" + "=".repeat(64));
    console.log("  GIORNI FRA LA CONVERSIONE E LA CHIAMATA");
    console.log("=".repeat(64));
    console.log(riga("Mediana", `${p(50).toFixed(1)} giorni`));
    console.log(riga("90esimo percentile", `${p(90).toFixed(1)} giorni`));
    console.log(riga("Massimo", `${p(100).toFixed(1)} giorni`));
    console.log("\n  Un valore alto significa che si richiamano lead vecchi: l'attribuzione");
    console.log("  alla campagna del momento resta corretta, ma le Connessioni di un mese");
    console.log("  possono riferirsi a campagne pagate in mesi precedenti.");
  }

  if (perCampagna.size) {
    console.log("\n" + "=".repeat(64));
    console.log("  CAMPAGNE CON PIU' CHIAMATE CONNESSE (nel campione)");
    console.log("=".repeat(64));
    for (const [nome, n] of [...perCampagna].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`  ${String(n).padStart(5)}x  ${nome}`);
    }
  }

  await cl.end();
}

main().catch((err) => {
  console.error("[analisi] fallita:", err instanceof Error ? err.message : err);
  process.exit(1);
});
