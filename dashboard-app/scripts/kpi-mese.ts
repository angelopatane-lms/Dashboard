/**
 * La riga del foglio "Kpi Mese" (stesso file di KPI SETTIMANALI), pronta da incollare in B.
 *
 * COME SI LANCIA
 *   npx tsx scripts/kpi-mese.ts                       il mese scorso
 *   npx tsx scripts/kpi-mese.ts 2026-10               un mese preciso
 *   npx tsx scripts/kpi-mese.ts 2026-10 --chiamate 24933 --appuntamenti 1155 --connessioni 7184 --consulenze 673
 *
 * Le quattro opzioni sono i "Totale complessivo" della Dashboard (periodo "Mese
 * Scorso"): chiamate, appuntamenti e connessioni sono advisor + setter, le
 * consulenze solo advisor. Senza, G, I, J, K e N restano vuote.
 *
 * PERCHE' LA DASHBOARD SI LEGGE E NON SI RICALCOLA. Le sue tabelle mettono
 * insieme il foglio Operatori e tre correzioni da HubSpot nel browser:
 * rifarle qui darebbe numeri vicini ma diversi da quelli che Angelo vede.
 *
 * LE TRE FONTI, decise con Angelo il 3 novembre 2026 sulla riga di ottobre:
 *
 *   B-F, H, L, M, O, Q   somma delle righe di KPI SETTIMANALI del mese (le
 *                        settimane il cui giovedi' cade nel mese, come la
 *                        colonna "Mese" del foglio): si rilancia
 *                        kpi-settimanale.ts su ognuna. NON e' il mese di
 *                        calendario: per ottobre 2026 e' 28/09-01/11.
 *   G, I, J, K, N        Dashboard, vedi sopra.
 *   R-AD                 Boom del mese di calendario con proprietario nel team
 *                        Advisor: e' il totale BOOM della tabella Advisor
 *                        (ottobre 2026: 286.477,92, uguale al centesimo).
 *                        DAL 10/11/2026 SENZA I BOOM D.A. (Dipendenti
 *                        Artificiali), su richiesta del CEO: da allora AC sta
 *                        sotto il totale BOOM della Dashboard di quanto
 *                        incassato sui D.A., che lo script stampa a parte.
 *
 * I BOOM SI DIVIDONO IN TRE, e la somma torna con AC e AD:
 *   evento principale    prodotto con "ICMD"                         Z, AA
 *   eventi               prodotto con "Academy" o "Life", tranne
 *                        "Formazione One to One - Life"              X, Y
 *   vendite telefoniche  tutto il resto                              V, W
 *
 * INCASSATO e' l'importo di ogni Boom pagato nel mese, rate di vendite vecchie
 * comprese. FATTURATO e' fatturato_atteso delle sole chiusure (Acconto, Quota
 * unica): il valore pieno di cio' che si e' venduto nel mese. Per questo sul
 * ICMD, pagato quasi tutto in quota unica, il fatturato puo' stare sotto
 * l'incassato: a ottobre 33.430 contro 34.003, per 1.503 di rate vecchie.
 * Angelo l'ha visto e ha deciso di lasciarlo cosi'.
 */
import "./env";
import { execSync } from "node:child_process";
import { getDb } from "../src/lib/db";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";
const CHIUSURE = ["Acconto", "Quota unica"];
const INCASSI = ["Acconto", "Rata", "Quota unica", "Upgrade"];

const piuGiorni = (d: string, n: number) =>
  new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

function meseScorso(): string {
  const oggi = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  const [a, m] = oggi.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

function opzione(nome: string): number | null {
  const i = process.argv.indexOf(`--${nome}`);
  if (i < 0) return null;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n)) throw new Error(`--${nome} vuole un numero`);
  return n;
}

const numero = (s: string | undefined) => Number((s ?? "").replace("%", "").replace(",", ".")) || 0;

/** Le righe della tabella stampata da kpi-settimanale.ts: colonna -> valore. */
function settimana(lunedi: string): Map<string, string> {
  const out = execSync(`npx tsx scripts/kpi-settimanale.ts ${lunedi}`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const celle = new Map<string, string>();
  for (const riga of out.split("--- INIZIO RIGA")[0].split("\n")) {
    if (!/^ {2}[A-Z]{1,2} /.test(riga)) continue;
    celle.set(riga.slice(2, 5).trim(), riga.slice(49).trim());
  }
  if (!celle.has("AA")) throw new Error(`kpi-settimanale.ts ${lunedi} non ha stampato la tabella`);
  return celle;
}

async function boomDelMese(token: string, da: string, a: string) {
  // I CONFINI SONO QUELLI DELLA DASHBOARD (mezzanotte UTC, non di Roma): cosi'
  // AC coincide col totale BOOM della tabella Advisor.
  const righe: Array<Record<string, string>> = [];
  let after: string | undefined;
  do {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/${BOOM}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "data_di_pagamento", operator: "GTE", value: String(new Date(da).getTime()) },
              { propertyName: "data_di_pagamento", operator: "LTE", value: String(new Date(`${a}T23:59:59.999Z`).getTime()) }
            ]
          }
        ],
        properties: ["tipologia_di_incasso", "importo", "fatturato_atteso", "hubspot_owner_id", "prodotto"],
        limit: 100,
        ...(after ? { after } : {})
      })
    });
    if (!r.ok) throw new Error(`HubSpot ${r.status} sui Boom`);
    const d = (await r.json()) as { results?: Array<{ properties: Record<string, string> }>; paging?: { next?: { after?: string } } };
    righe.push(...(d.results ?? []).map((x) => x.properties));
    after = d.paging?.next?.after;
  } while (after);
  return righe;
}

/** I nomi dei proprietari, disattivati compresi. */
async function proprietari(token: string): Promise<Map<string, string>> {
  const nomi = new Map<string, string>();
  for (const archived of [false, true]) {
    let after: string | undefined;
    do {
      const r = await fetch(
        `${HUBSPOT}/crm/v3/owners/?limit=500&archived=${archived}${after ? `&after=${after}` : ""}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error(`HubSpot ${r.status} sui proprietari`);
      const d = (await r.json()) as {
        results?: Array<{ id: string; firstName?: string; lastName?: string }>;
        paging?: { next?: { after?: string } };
      };
      for (const o of d.results ?? []) nomi.set(String(o.id), [o.firstName, o.lastName].filter(Boolean).join(" "));
      after = d.paging?.next?.after;
    } while (after);
  }
  return nomi;
}

(async () => {
  const mese = process.argv[2] && /^\d{4}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : meseScorso();
  const da = `${mese}-01`;
  const a = piuGiorni(`${piuGiorni(da, 31).slice(0, 7)}-01`, -1);
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN non impostata");

  // LE SETTIMANE DEL MESE: quelle col giovedi' dentro il mese.
  const lunedi: string[] = [];
  let l = piuGiorni(da, -((new Date(`${da}T12:00:00Z`).getUTCDay() + 6) % 7));
  if (piuGiorni(l, 3) < da) l = piuGiorni(l, 7);
  for (; piuGiorni(l, 3) <= a; l = piuGiorni(l, 7)) lunedi.push(l);

  const sett: Array<Map<string, string>> = [];
  for (const x of lunedi) {
    console.error(`settimana del ${x}...`);
    sett.push(settimana(x));
  }
  const somma = (col: string) => sett.reduce((s, c) => s + numero(c.get(col)), 0);
  const mktg = somma("AA");
  const leads = somma("AB");
  const unici = somma("AE");
  const risposte = somma("AL");
  const appProcessati = somma("AO");
  const venditeSett = somma("AT");

  // BOOM DEL MESE.
  const db = getDb();
  const team = await db.query<{ nome: string }>(
    `SELECT lower(nome) AS nome FROM utente_team_adesso WHERE team_nome = 'Advisor'`
  );
  const advisor = new Set(team.rows.map((r) => r.nome));
  const [righe, nomi] = await Promise.all([boomDelMese(token, da, a), proprietari(token)]);
  const parti = {
    tel: { inc: 0, fat: 0, n: 0 },
    eventi: { inc: 0, fat: 0, n: 0 },
    icmd: { inc: 0, fat: 0, n: 0 }
  };
  let da_esclusi = 0;
  for (const b of righe) {
    if (!advisor.has((nomi.get(b.hubspot_owner_id ?? "") ?? "").toLowerCase())) continue;
    const prodotto = b.prodotto ?? "";
    // DIPENDENTI ARTIFICIALI FUORI, dal 10/11/2026 su richiesta del CEO: come
    // in kpi-settimanale.ts ("D.A.", "D.A. Singolo", "D.A. PMI"...). Per
    // questo AC non coincide piu' col totale BOOM della tabella Advisor: sta
    // sotto di quanto incassato sui Boom D.A. nel mese.
    if (/^\s*d\.?\s*a\.?(\s|$)/i.test(prodotto)) {
      if (INCASSI.includes((b.tipologia_di_incasso ?? "").trim())) da_esclusi += Number(b.importo) || 0;
      continue;
    }
    const parte = /icmd/i.test(prodotto)
      ? parti.icmd
      : /academy|life/i.test(prodotto) && !/one to one/i.test(prodotto)
        ? parti.eventi
        : parti.tel;
    const tipo = (b.tipologia_di_incasso ?? "").trim();
    if (INCASSI.includes(tipo)) parte.inc += Number(b.importo) || 0;
    if (CHIUSURE.includes(tipo)) {
      parte.fat += Number(b.fatturato_atteso) || 0;
      parte.n++;
    }
  }

  const chiamate = opzione("chiamate");
  const appFissati = opzione("appuntamenti");
  const connessioni = opzione("connessioni");
  const consulenze = opzione("consulenze");

  const n = (x: number, dec = 2) => (Number.isInteger(x) ? String(x) : x.toFixed(dec).replace(".", ","));
  const pct = (parte: number | null, su: number | null) =>
    parte !== null && su ? ((parte / su) * 100).toFixed(2).replace(".", ",") + "%" : "";
  const intero = (x: number | null) => (x === null ? "" : String(x));

  const venditeMese = parti.tel.n + parti.eventi.n;
  const caricato = parti.tel.inc + parti.eventi.inc;
  const fatturato = parti.tel.fat + parti.eventi.fat;

  const celle: Array<[string, string, string]> = [
    ["B", "Spesa MKTG", n(mktg)],
    ["C", "CPL", leads ? n(mktg / leads) : ""],
    ["D", "LEAD GENERATI CON DOPPIONI", n(leads)],
    ["E", "cpl lead unici", unici ? n(mktg / unici) : ""],
    ["F", "LEAD UNICI (NUOVI)", n(unici)],
    ["G", "CHIAMATE", intero(chiamate)],
    ["H", "Risposte", n(risposte)],
    ["I", "App fissati", intero(appFissati)],
    ["J", "Tasso di presa app sulle calls", pct(appFissati, chiamate)],
    ["K", "Tasso di presa app sulle RISP", pct(appFissati, connessioni)],
    ["L", "Appuntamenti processati", n(appProcessati)],
    ["M", "Tasso fra app svolti e risp", pct(appProcessati, risposte)],
    ["N", "Show up", pct(consulenze, appFissati)],
    ["O", "Tasso di chiusura", pct(venditeSett, appProcessati)],
    ["P", "(colonna nascosta)", ""],
    ["Q", "CR Sui Lead Unici", pct(venditeSett, unici)],
    ["R", "CARICATO TOTALE LORDO", n(caricato)],
    ["S", "FATTURATO ATTESO LORDO", n(fatturato)],
    ["T", "TICKET", String(venditeMese)],
    ["U", "VENDITA MEDIA SU FATTURATO", venditeMese ? n(fatturato / venditeMese) : ""],
    ["V", "INCASSATO da VENDITA TELEFONICA", n(parti.tel.inc)],
    ["W", "FATTURATO da VENDITA TELEFONICA", n(parti.tel.fat)],
    ["X", "INCASSATO da EVENTI", n(parti.eventi.inc)],
    ["Y", "FATTURATO da EVENTI", n(parti.eventi.fat)],
    ["Z", "Evento Principale CARICATO", n(parti.icmd.inc)],
    ["AA", "Evento Principale FATTURATO", n(parti.icmd.fat)],
    ["AB", "(vuota)", ""],
    ["AC", "incasso totale", n(caricato + parti.icmd.inc)],
    ["AD", "fatturato totale", n(fatturato + parti.icmd.fat)]
  ];

  const ita = (d: string) => d.split("-").reverse().join("/");
  console.log(`\n=== KPI MESE - ${mese} ===`);
  console.log(`  Boom: ${ita(da)} - ${ita(a)}`);
  console.log(`  Settimane sommate: ${lunedi.map((x) => `${ita(x)}-${ita(piuGiorni(x, 6))}`).join(", ")}\n`);
  for (const [col, nome, valore] of celle) console.log(`  ${col.padEnd(3)} ${nome.padEnd(36)} ${valore}`);
  console.log(`\n  Esclusi i Boom D.A. degli Advisor: ${n(da_esclusi)} di incassato (AC + questo = totale BOOM della Dashboard)`);
  if (chiamate === null) console.log("\n  G, I, J, K, N vuote: mancano i totali della Dashboard (--chiamate ecc.)");
  console.log("\n--- RIGA INTERA, da incollare in B (colonne separate da tabulazione) ---");
  console.log(celle.map(([, , v]) => v).join("\t"));
  console.log("");
  process.exit(0);
})().catch((e) => {
  console.error("ERRORE:", e instanceof Error ? e.message : e);
  process.exit(1);
});
