/**
 * I numeri di un giorno come li conta la Dashboard e come li conta Squadre,
 * persona per persona, uno accanto all'altro.
 *
 *   npx tsx scripts/confronto-squadre-dashboard.ts                        ieri
 *   npx tsx scripts/confronto-squadre-dashboard.ts 2026-11-04            un giorno
 *   npx tsx scripts/confronto-squadre-dashboard.ts 2026-10-06 2026-11-04 una finestra
 *
 * Non scrive niente: legge e stampa.
 *
 * LATO SQUADRE si chiama `calcolaFinestra`, cioe' esattamente la funzione che
 * il cron di Vercel esegue ogni mattina. LATO DASHBOARD si rifanno le stesse
 * letture che fanno le rotte della tabella (`/api/hubspot-deals`,
 * `/api/hubspot-data`, `/api/setter-trattative`) e si applicano le stesse
 * regole di attribuzione di OperatorStatsTable: Setter e Advisor NON sono la
 * stessa colonna.
 */
import "./env";
import fs from "fs";
import path from "path";
import { getDb } from "../src/lib/db";
import { fetchCsv } from "../src/lib/csv";
import { ieriRoma } from "../src/lib/report/giornaliero";
import { calcolaFinestra } from "../src/lib/squadre/finestra";
import { calcolaBoom } from "../src/lib/squadre/boom";
import { proprietari } from "../src/lib/squadre/proprietari";
import { CHIUSURE_TIPOLOGIE, BOOM_TIPOLOGIE, PIPELINE_APPUNTAMENTI } from "../src/lib/hubspotRegole";
import { ricercaHubSpot } from "../src/lib/hubspotRicerca";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";
const FOGLIO = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID = "245526930";

const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function ownerMap(token: string): Promise<Record<string, string>> {
  const m: Record<string, string> = {};
  for (const archiviati of [false, true]) {
    let after: string | undefined;
    do {
      const r = await fetch(
        `${HUBSPOT}/crm/v3/owners?limit=100&archived=${archiviati}${after ? `&after=${after}` : ""}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) break;
      const d = (await r.json()) as any;
      for (const o of d.results ?? []) {
        const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || (o.email ?? "");
        if (nome && !m[String(o.id)]) m[String(o.id)] = nome;
      }
      after = d.paging?.next?.after;
    } while (after);
  }
  return m;
}

/** Tutte le pagine di una ricerca, come fanno le rotte della Dashboard. */
async function tutte(token: string, oggetto: string, body: any) {
  const out: any[] = [];
  let after: string | undefined;
  do {
    const d = await ricercaHubSpot<any>(
      token,
      `${HUBSPOT}/crm/v3/objects/${oggetto}/search`,
      { ...body, limit: 100, ...(after ? { after } : {}) },
      "confronto"
    );
    out.push(...(d.results ?? []));
    after = d.paging?.next?.after;
  } while (after);
  return out;
}

(async () => {
  const arg = (i: number) =>
    process.argv[i] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[i]) ? process.argv[i] : "";
  const giorno = arg(2) || ieriRoma();
  const fine = arg(3) || giorno;
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  console.log(giorno === fine ? `GIORNO: ${giorno}\n` : `FINESTRA: ${giorno} -> ${fine}\n`);

  const nomi = await ownerMap(token);

  // ---------- LATO DASHBOARD ----------
  // La finestra della Dashboard e' in UTC: `new Date(from)` e `to+T23:59:59.999Z`.
  const fromMs = new Date(giorno).getTime();
  const toMs = new Date(fine + "T23:59:59.999Z").getTime();

  // Appuntamenti: /api/hubspot-deals -> setter oppure, se manca, proprietario.
  const deals = await tutte(token, "deals", {
    filterGroups: [
      {
        filters: [
          { propertyName: "createdate", operator: "GTE", value: String(fromMs) },
          { propertyName: "createdate", operator: "LTE", value: String(toMs) },
          { propertyName: "pipeline", operator: "EQ", value: PIPELINE_APPUNTAMENTI }
        ]
      }
    ],
    properties: ["setter", "hubspot_owner_id", "createdate"]
  });
  const appDash: Record<string, number> = {};
  let senzaSetter = 0;
  for (const d of deals) {
    const p = d.properties;
    if (!(p.setter ?? "").trim()) senzaSetter++;
    const id = (p.setter ?? "").trim() || (p.hubspot_owner_id ?? "").trim();
    const nome = nomi[id] ?? id;
    if (!nome) continue;
    appDash[normKey(nome)] = (appDash[normKey(nome)] ?? 0) + 1;
  }

  // Boom: /api/hubspot-data, con il setter completato dalla trattativa.
  const boom = await tutte(token, BOOM, {
    filterGroups: [
      {
        filters: [
          { propertyName: "data_di_pagamento", operator: "GTE", value: String(fromMs) },
          { propertyName: "data_di_pagamento", operator: "LTE", value: String(toMs) }
        ]
      }
    ],
    properties: [
      "data_di_pagamento",
      "tipologia_di_incasso",
      "importo",
      "hubspot_owner_id",
      "setter",
      "id_trattativa"
    ]
  });
  const record = boom
    .map((b: any) => ({
      operatore: nomi[(b.properties.hubspot_owner_id ?? "").trim()] ?? "",
      setter: nomi[(b.properties.setter ?? "").trim()] ?? "",
      id_trattativa: (b.properties.id_trattativa ?? "").trim(),
      tipologia: b.properties.tipologia_di_incasso ?? "",
      importo: parseFloat(b.properties.importo ?? "0") || 0
    }))
    .filter((r) => r.operatore);

  console.log(`trattative nate nella finestra: ${deals.length}, di cui senza setter scritto: ${senzaSetter}`);
  console.log(`incassi nella finestra: ${boom.length}
`);

  const db = getDb();
  const senza = record.filter((r) => !r.setter && r.id_trattativa);
  if (senza.length) {
    const ids = [...new Set(senza.map((r) => Number(r.id_trattativa)).filter(Number.isFinite))];
    const { rows } = await db.query<{ deal_id: string; setter_id: string }>(
      `SELECT deal_id::text AS deal_id, setter_id::text AS setter_id FROM trattativa
        WHERE deal_id = ANY($1::bigint[]) AND setter_id IS NOT NULL`,
      [ids]
    );
    const perDeal = new Map(rows.map((r) => [r.deal_id, r.setter_id]));
    for (const r of senza) r.setter = nomi[perDeal.get(r.id_trattativa) ?? ""] ?? "";
  }

  const boomPer = (chi: "operatore" | "setter") => {
    const agg: Record<string, { chiusure: number; boom: number; incassoChiusure: number }> = {};
    for (const r of record) {
      const a = r[chi];
      if (!a) continue;
      const k = normKey(a);
      agg[k] ??= { chiusure: 0, boom: 0, incassoChiusure: 0 };
      if (CHIUSURE_TIPOLOGIE.has(r.tipologia)) {
        agg[k].chiusure += 1;
        agg[k].incassoChiusure += r.importo;
      }
      if (BOOM_TIPOLOGIE.has(r.tipologia)) agg[k].boom += r.importo;
    }
    return agg;
  };
  const boomAdvisor = boomPer("operatore");
  const boomSetter = boomPer("setter");

  // No show e consulenze per SETTER: le query di /api/setter-trattative.
  const [noShowQ, svolteQ, fuoriQ] = await Promise.all([
    db.query<{ setter: string; n: string }>(
      `SELECT p.nome AS setter, COUNT(*)::text AS n FROM no_show n JOIN proprietario p ON p.id = n.setter_id
        WHERE n.ts >= $1::date AND n.ts < ($2::date + INTERVAL '1 day') GROUP BY 1`,
      [giorno, fine]
    ),
    db.query<{ setter: string; n: string }>(
      `SELECT p.nome AS setter, COUNT(*)::text AS n FROM trattativa t JOIN proprietario p ON p.id = t.setter_id
        WHERE t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day') GROUP BY 1`,
      [giorno, fine]
    ),
    db.query<{ advisor: string; n: string }>(
      `SELECT p.nome AS advisor, COUNT(*)::text AS n FROM consulenza_fuori_crm f JOIN proprietario p ON p.id = f.advisor_id
        WHERE f.inizio_ts >= $1::date AND f.inizio_ts < ($2::date + INTERVAL '1 day') GROUP BY 1`,
      [giorno, fine]
    )
  ]);
  const noShowDash: Record<string, number> = {};
  for (const r of noShowQ.rows) noShowDash[normKey(r.setter)] = Number(r.n);
  const svolteDash: Record<string, number> = {};
  for (const r of svolteQ.rows) svolteDash[normKey(r.setter)] = Number(r.n);
  const fuoriCrm: Record<string, number> = {};
  for (const r of fuoriQ.rows) fuoriCrm[normKey(r.advisor)] = Number(r.n);

  // Consulenze degli Advisor: colonna del foglio Operatori + fuori CRM.
  const righe = await fetchCsv(
    `https://docs.google.com/spreadsheets/d/${FOGLIO}/export?format=csv&gid=${GID}`,
    { next: { revalidate: 0 } }
  );
  const dataNormale = (v: string) => {
    const s = (v ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
  };
  const num = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const foglio: Record<string, { consulenze: number; appuntamenti: number; chiusure: number }> = {};
  for (const r of righe) {
    const g = dataNormale(r["Data"] ?? "");
    if (g < giorno || g > fine) continue;
    const k = normKey((r["Operatore"] ?? "").toString());
    if (!k) continue;
    foglio[k] ??= { consulenze: 0, appuntamenti: 0, chiusure: 0 };
    foglio[k].consulenze += num(r["Consulenze"]);
    foglio[k].appuntamenti += num(r["Appuntamenti"]);
    foglio[k].chiusure += num(r["Chiusure"]);
  }

  // ---------- LATO SQUADRE ----------
  const sq = await calcolaFinestra(token, giorno, fine);
  const sqBoom = await calcolaBoom(token, giorno, fine, (await proprietari(token)).perId);
  const vociDi = (ids: string[]) => {
    const t: any = {};
    for (const persone of Object.values(sq.giorni)) {
      for (const id of ids) {
        const v = (persone as any)[id];
        if (!v) continue;
        for (const [k, n] of Object.entries(v)) t[k] = (t[k] ?? 0) + (n as number);
      }
    }
    return t;
  };
  const soldiDi = (ids: string[], quale: "advisor" | "setter") => {
    const t: any = { chiusure: 0, venduto: 0, boom: 0, storni: 0, vendutoStornato: 0, rate: 0 };
    for (const persone of Object.values(sqBoom.giorni)) {
      for (const id of ids) {
        const v = (persone as any)[id]?.[quale];
        if (!v) continue;
        for (const k of Object.keys(t)) t[k] += v[k] ?? 0;
      }
    }
    return t;
  };

  // ---------- IL CONFRONTO ----------
  const squadre = JSON.parse(
    fs.readFileSync(
      path.join("C:", "Users", "Angelo", "Desktop", "Windserf", "Squadre", "squadre.json"),
      "utf8"
    )
  );
  const persone: Array<{ nome: string; ruolo: string; squadra: string; ids: string[] }> = [];
  for (const s of squadre.squadre) {
    const per = new Map<string, { nome: string; ruolo: string; ids: string[] }>();
    const agg = (elenco: any[], ruolo: string) => {
      for (const p of elenco ?? []) {
        if (!p.id) continue;
        const g = per.get(String(p.id));
        if (g) {
          if (!g.ruolo.includes(ruolo)) g.ruolo += " + " + ruolo;
          continue;
        }
        per.set(String(p.id), {
          nome: p.nome,
          ruolo,
          ids: [String(p.id), ...(p.ancheId ?? []).map(String)]
        });
      }
    };
    agg(s.teamLeader, "Team Leader");
    agg(s.closer, "Closer");
    agg(s.setter, "Setter");
    for (const v of per.values()) persone.push({ ...v, squadra: s.nome });
  }

  const col = (n: number) => String(Math.round(n)).padStart(6);
  const segna = (a: number, b: number) => (Math.round(a) === Math.round(b) ? "  " : " <");

  console.log("DASH = come lo conta la tabella della Dashboard (Setter o Advisor secondo il");
  console.log("ruolo). SQUA = come lo conta oggi la pagina delle squadre.\n");
  const diff: string[] = [];
  for (const p of persone) {
    const k = normKey(p.nome);
    const v = vociDi(p.ids);
    const setterView = p.ruolo === "Setter";
    const dash = {
      appuntamenti: appDash[k] ?? 0,
      consulenze: setterView ? svolteDash[k] ?? 0 : (foglio[k]?.consulenze ?? 0) + (fuoriCrm[k] ?? 0),
      noShow: setterView ? noShowDash[k] ?? 0 : null,
      chiusure: (setterView ? boomSetter[k]?.chiusure : boomAdvisor[k]?.chiusure) ?? 0,
      venduto: (setterView ? boomSetter[k]?.incassoChiusure : boomAdvisor[k]?.incassoChiusure) ?? 0,
      boom: (setterView ? boomSetter[k]?.boom : boomAdvisor[k]?.boom) ?? 0
    };
    const soldi = soldiDi(p.ids, setterView ? "setter" : "advisor");
    const squa = {
      appuntamenti: v.appuntamenti ?? 0,
      consulenze: setterView
        ? v.svolteComeSetter ?? 0
        : (v.consulenzeFoglio ?? 0) + (v.fuoriCrm ?? 0),
      noShow: setterView ? v.noShowComeSetter ?? 0 : v.noShowComeProprietario ?? 0,
      chiusure: soldi.chiusure,
      venduto: soldi.venduto,
      boom: soldi.boom,
      chiusureComeSetter: soldiDi(p.ids, "setter").chiusure,
      vendutoComeSetter: soldiDi(p.ids, "setter").venduto
    };
    const righeDiverse =
      dash.appuntamenti !== squa.appuntamenti ||
      Math.round(dash.consulenze) !== squa.consulenze ||
      dash.chiusure !== squa.chiusure ||
      Math.round(dash.venduto) !== Math.round(squa.venduto) ||
      Math.round(dash.boom) !== Math.round(squa.boom) ||
      (dash.noShow !== null && dash.noShow !== squa.noShow);
    console.log(
      [
        `${p.nome} — ${p.ruolo} (${p.squadra})${righeDiverse ? "   *** DIVERSI ***" : ""}`,
        `        appuntamenti  DASH${col(dash.appuntamenti)}${segna(dash.appuntamenti, squa.appuntamenti)}  SQUA${col(squa.appuntamenti)}`,
        `        consulenze    DASH${col(dash.consulenze)}${segna(dash.consulenze, squa.consulenze)}  SQUA${col(squa.consulenze)}`,
        `        no show       DASH${dash.noShow === null ? "     —" : col(dash.noShow)}${dash.noShow === null ? "  " : segna(dash.noShow, squa.noShow)}  SQUA${col(squa.noShow)}`,
        `        chiusure      DASH${col(dash.chiusure)}${segna(dash.chiusure, squa.chiusure)}  SQUA${col(squa.chiusure)}   (come setter: ${squa.chiusureComeSetter})`,
        `        venduto       DASH${col(dash.venduto)}${segna(dash.venduto, squa.venduto)}  SQUA${col(squa.venduto)}   (come setter: ${Math.round(squa.vendutoComeSetter)})`,
        `        boom+rate     DASH${col(dash.boom)}${segna(dash.boom, squa.boom)}  SQUA${col(squa.boom)}`
      ].join("\n") + "\n"
    );
    if (righeDiverse) diff.push(p.nome + " (" + p.ruolo + ")");
  }
  console.log("=".repeat(70));
  console.log(`persone con almeno un numero diverso: ${diff.length} su ${persone.length}`);
  for (const d of diff) console.log("   " + d);
  process.exit(0);
})();
