// Verifica i criteri di "Performance Tracker - Trattative Svolte" AL MOMENTO
// del cambio fase, non sullo stato attuale.
//
// PERCHE': il workflow si innesca quando cambia "fase_precedente" e valuta le
// condizioni in quell'istante. Guardare i valori di oggi non dice nulla su cosa
// fosse vero allora, perche' dealstage, motivo e fase_precedente cambiano piu'
// volte nel tempo. Qui si legge la CRONOLOGIA di quelle tre proprieta' e si
// ricostruisce lo stato esatto a ogni transizione.
//
// Uso: npm run verifica:svolte -- --trattative 200

import { richiedi } from "./env";

const PIPELINE = "433643709";
const DA_SVOLGERE = "665590998";
const RIPIANIFICATA = "665590999";
const NO_SHOW = "666989041";
const VINTA = "665591003";
const FASI_PREC_VALIDE = ["Ripianificata (No Show)", "No Show", "Da Svolgere"];
const MAX_STORICO = 50;

type Voce = { value: string; timestamp: string };

function valoreAl(storico: Voce[], istante: number): string {
  // La cronologia HubSpot e' dal piu' recente al piu' vecchio: si cerca la
  // prima voce con timestamp <= istante.
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

async function main() {
  const i = process.argv.indexOf("--trattative");
  const quante = i === -1 ? 200 : Number(process.argv[i + 1]);
  if (!Number.isInteger(quante) || quante <= 0) throw new Error("--trattative richiede un intero positivo");

  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  console.log(`[verifica] ${quante} trattative della pipeline Appuntamenti. Sola lettura.\n`);

  // 1. id delle trattative
  const ids: string[] = [];
  let after: string | undefined;
  while (ids.length < quante) {
    const d = await post("https://api.hubapi.com/crm/v3/objects/deals/search", token, {
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

  // 2. cronologia delle tre proprieta' che il workflow valuta
  const storie = new Map<string, { fase: Voce[]; stage: Voce[]; motivo: Voce[] }>();
  for (let k = 0; k < ids.length; k += MAX_STORICO) {
    const d = await post("https://api.hubapi.com/crm/v3/objects/deals/batch/read", token, {
      inputs: ids.slice(k, k + MAX_STORICO).map((id) => ({ id })),
      properties: ["dealstage"],
      propertiesWithHistory: ["fase_precedente", "dealstage", "motivo"]
    });
    for (const r of d.results ?? []) {
      const h = r.propertiesWithHistory ?? {};
      storie.set(r.id, { fase: h.fase_precedente ?? [], stage: h.dealstage ?? [], motivo: h.motivo ?? [] });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // 3. per ogni transizione, ricostruzione dello stato e valutazione dei gruppi
  let transizioni = 0;
  let soloG1 = 0;
  let soloG2 = 0;
  let entrambi = 0;
  let nessuno = 0;
  let contesa = 0; // Ripianificata + Mancata Presenza che entra dal G1
  let ripBuona = 0; // Ripianificata + Trattativa

  for (const [, s] of storie) {
    for (const v of s.fase) {
      const fasePrec = (v.value ?? "").trim();
      if (!FASI_PREC_VALIDE.includes(fasePrec)) continue;

      const t = new Date(v.timestamp).getTime();
      if (Number.isNaN(t)) continue;
      transizioni += 1;

      const stage = valoreAl(s.stage, t);
      const motivo = valoreAl(s.motivo, t);

      const g1 = stage !== DA_SVOLGERE && stage !== NO_SHOW;
      const g2 = stage === RIPIANIFICATA && motivo !== "Mancata Presenza";
      const g3 = stage === VINTA && fasePrec !== "Semivinta";

      if (g1 && g2) entrambi += 1;
      else if (g1) soloG1 += 1;
      else if (g2) soloG2 += 1;
      else if (!g3) nessuno += 1;

      if (stage === RIPIANIFICATA && motivo === "Mancata Presenza" && g1) contesa += 1;
      if (stage === RIPIANIFICATA && motivo !== "Mancata Presenza") ripBuona += 1;
    }
  }

  const r = (e: string, n: number) => `  ${e.padEnd(52, ".")} ${String(n).padStart(6)}`;
  console.log("=".repeat(66));
  console.log("  VALUTAZIONE AL MOMENTO DI OGNI CAMBIO FASE");
  console.log("=".repeat(66));
  console.log(r("Trattative esaminate", storie.size));
  console.log(r("Transizioni valutabili (fase prec. fra le tre)", transizioni));
  console.log("");
  console.log(r("Soddisfano SOLO il Gruppo 1", soloG1));
  console.log(r("Soddisfano SOLO il Gruppo 2", soloG2));
  console.log(r("Soddisfano ENTRAMBI", entrambi));
  console.log(r("Non soddisfano ne' G1 ne' G2", nessuno));

  console.log("\n" + "=".repeat(66));
  console.log("  IL CASO IN DISCUSSIONE");
  console.log("=".repeat(66));
  console.log(r("Ripianificata con Motivo = Trattativa (buone)", ripBuona));
  console.log(r("Ripianificata con Motivo = Mancata Presenza", contesa));
  console.log("");
  if (soloG2 === 0 && transizioni > 0) {
    console.log("  Nessuna transizione entra SOLO dal Gruppo 2: tutto cio' che il G2");
    console.log("  accetta e' gia' accettato dal G1, quindi il G2 non aggiunge nulla.");
  }
  if (contesa > 0) {
    console.log(`  ${contesa} transizioni erano Ripianificata per Mancata Presenza al momento`);
    console.log("  del cambio fase, e il Gruppo 1 le ha comunque accettate come svolte.");
  } else if (transizioni > 0) {
    console.log("  Nessuna transizione con Ripianificata + Mancata Presenza nel campione:");
    console.log("  il caso esiste in teoria ma qui non si e' verificato.");
  }
}

main().catch((err) => {
  console.error("[verifica] fallita:", err instanceof Error ? err.message : err);
  process.exit(1);
});
