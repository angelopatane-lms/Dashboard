// Verifica i criteri di "Performance Tracker - Trattative Svolte" AL MOMENTO
// del cambio fase, non sullo stato attuale.
//
// PERCHE' AL MOMENTO DEL CAMBIO: il workflow si innesca quando cambia
// fase_precedente e valuta le condizioni in quell'istante. Guardare i valori di
// oggi non dice nulla su cosa fosse vero allora, perche' dealstage, motivo e
// fase_precedente cambiano piu' volte nel tempo. Qui si legge la CRONOLOGIA di
// quelle proprieta' e si ricostruisce lo stato esatto a ogni transizione.
//
// I CRITERI NON SONO SCRITTI QUI: vengono letti dal workflow via API, cosi' lo
// script segue automaticamente ogni modifica fatta su HubSpot e non puo'
// divergere dalla configurazione reale.
//
// Uso: npm run verifica:svolte -- --trattative 300

import { richiedi } from "./env";

const FLOW_ID = "4640743658";
const PIPELINE = "433643709";
// "Fase Precedente (Sergente)". NON confondere con "provamultiriga", che ha
// l'etichetta "Fase precedente" ed e' un campo di testo libero inutilizzato.
const FASE_PRECEDENTE_SERGENTE = "fase_precedente";
const MAX_STORICO = 50;

type Voce = { value: string; timestamp: string };
type Filtro = { property: string; operator: string; values: string[] };

function valoreAl(storico: Voce[], istante: number): string {
  let scelto = "";
  let migliore = -Infinity;
  for (const v of storico) {
    const t = new Date(v.timestamp).getTime();
    if (t <= istante && t > migliore) {
      migliore = t;
      scelto = (v.value ?? "").trim();
    }
  }
  return scelto;
}

async function get(url: string, token: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${d.message ?? ""}`);
  return d;
}

async function post(url: string, token: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${d.message ?? ""}`);
  return d;
}

/** Valuta un gruppo di condizioni (in AND) sullo stato ricostruito. */
function gruppoSoddisfatto(filtri: Filtro[], stato: Record<string, string>): boolean {
  for (const f of filtri) {
    const v = stato[f.property] ?? "";
    if (f.operator === "IS_ANY_OF") {
      if (!f.values.includes(v)) return false;
    } else if (f.operator === "IS_NONE_OF") {
      if (f.values.includes(v)) return false;
    } else if (f.operator === "IS_KNOWN") {
      if (!v) return false;
    } else {
      // Operatore non gestito: si segnala e si considera non soddisfatto, per
      // non dichiarare "svolta" una transizione che non sappiamo valutare.
      throw new Error(`Operatore non gestito nei criteri: ${f.operator} su ${f.property}`);
    }
  }
  return true;
}

async function main() {
  const i = process.argv.indexOf("--trattative");
  const quante = i === -1 ? 300 : Number(process.argv[i + 1]);
  if (!Number.isInteger(quante) || quante <= 0) throw new Error("--trattative richiede un intero positivo");

  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");

  // --- criteri letti dal workflow ---
  const flow = await get(`https://api.hubapi.com/automation/v4/flows/${FLOW_ID}`, token);
  const pipe = await get(`https://api.hubapi.com/crm/v3/pipelines/deals/${PIPELINE}`, token);
  const nomeFase = new Map<string, string>((pipe.stages ?? []).map((s: any) => [s.id, s.label]));

  const rc = flow.enrollmentCriteria?.refinementCriteria;
  if (rc?.filterBranchOperator !== "OR") {
    console.log(`ATTENZIONE: i gruppi sono in ${rc?.filterBranchOperator}, non in OR. La lettura qui sotto assume OR.`);
  }
  const gruppi: Filtro[][] = (rc?.filterBranches ?? []).map((b: any) =>
    (b.filters ?? []).map((f: any) => ({
      property: f.property,
      operator: f.operation.operator,
      values: f.operation.values ?? (f.operation.value !== undefined ? [String(f.operation.value)] : [])
    }))
  );

  console.log(`[verifica] workflow "${flow.name}" revisione ${flow.revisionId}`);
  console.log(`[verifica] ${gruppi.length} gruppi in OR, criteri letti dall'API. Sola lettura.\n`);
  gruppi.forEach((g, k) => {
    const s = g.find((f) => f.property === "dealstage");
    if (s) console.log(`  Gruppo ${k + 1}: dealstage ${s.operator} ${s.values.map((v) => nomeFase.get(v) ?? v).join(", ")}`);
  });
  console.log("");

  // --- trattative e cronologia ---
  const ids: string[] = [];
  let after: string | undefined;
  while (ids.length < quante) {
    const d = await post(`https://api.hubapi.com/crm/v3/objects/deals/search`, token, {
      limit: 100,
      properties: ["hs_object_id"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: PIPELINE }] }],
      ...(after ? { after } : {})
    });
    for (const r of d.results ?? []) if (ids.length < quante) ids.push(r.id);
    after = d.paging?.next?.after;
    if (!after) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Proprieta' su cui i criteri decidono, dedotte dai criteri stessi.
  const proprietaUsate = [...new Set(gruppi.flat().map((f) => f.property))];
  const conStorico = proprietaUsate.filter((p) => p !== "hubspot_team_id");

  type Storia = { storici: Record<string, Voce[]>; correnti: Record<string, string> };
  const storie = new Map<string, Storia>();
  for (let k = 0; k < ids.length; k += MAX_STORICO) {
    const d = await post(`https://api.hubapi.com/crm/v3/objects/deals/batch/read`, token, {
      inputs: ids.slice(k, k + MAX_STORICO).map((id) => ({ id })),
      properties: proprietaUsate,
      propertiesWithHistory: conStorico
    });
    for (const r of d.results ?? []) {
      storie.set(r.id, { storici: r.propertiesWithHistory ?? {}, correnti: r.properties ?? {} });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // --- valutazione a ogni transizione ---
  let transizioni = 0;
  const perGruppo = new Array(gruppi.length).fill(0);
  const soloGruppo = new Array(gruppi.length).fill(0);
  let svolte = 0;
  let nonSvolte = 0;
  const dettaglioRipianificate = new Map<string, number>();

  for (const [, s] of storie) {
    for (const v of s.storici[FASE_PRECEDENTE_SERGENTE] ?? []) {
      const t = new Date(v.timestamp).getTime();
      if (Number.isNaN(t)) continue;
      transizioni += 1;

      const stato: Record<string, string> = {
        // hubspot_team_id non ha cronologia utile: si usa il valore attuale.
        hubspot_team_id: (s.correnti.hubspot_team_id ?? "").trim(),
        [FASE_PRECEDENTE_SERGENTE]: (v.value ?? "").trim()
      };
      for (const p of conStorico) {
        if (p === FASE_PRECEDENTE_SERGENTE) continue;
        stato[p] = valoreAl(s.storici[p] ?? [], t);
      }

      const esiti = gruppi.map((g) => gruppoSoddisfatto(g, stato));
      esiti.forEach((ok, k) => { if (ok) perGruppo[k] += 1; });
      const quanti = esiti.filter(Boolean).length;
      if (quanti === 1) soloGruppo[esiti.findIndex(Boolean)] += 1;
      if (quanti > 0) svolte += 1; else nonSvolte += 1;

      const fase = nomeFase.get(stato.dealstage) ?? stato.dealstage;
      if (fase === "Ripianificata") {
        const chiave = `${stato.motivo || "(senza motivo)"} -> ${quanti > 0 ? "SVOLTA" : "non svolta"}`;
        dettaglioRipianificate.set(chiave, (dettaglioRipianificate.get(chiave) ?? 0) + 1);
      }
    }
  }

  const r = (e: string, n: number) => `  ${e.padEnd(50, ".")} ${String(n).padStart(6)}`;
  console.log("=".repeat(64));
  console.log("  VALUTAZIONE AL MOMENTO DI OGNI CAMBIO FASE");
  console.log("=".repeat(64));
  console.log(r("Trattative esaminate", storie.size));
  console.log(r("Transizioni valutate", transizioni));
  console.log("");
  gruppi.forEach((_, k) => console.log(r(`Soddisfano il Gruppo ${k + 1}`, perGruppo[k])));
  console.log("");
  gruppi.forEach((_, k) => console.log(r(`...di cui SOLO il Gruppo ${k + 1}`, soloGruppo[k])));
  console.log("");
  console.log(r("TOTALE considerate SVOLTE", svolte));
  console.log(r("Non svolte", nonSvolte));

  console.log("\n" + "=".repeat(64));
  console.log("  LE RIPIANIFICATE, PER MOTIVO");
  console.log("=".repeat(64));
  for (const [k, n] of [...dettaglioRipianificate].sort()) console.log(r(k, n));
}

main().catch((err) => {
  console.error("[verifica] fallita:", err instanceof Error ? err.message : err);
  process.exit(1);
});
