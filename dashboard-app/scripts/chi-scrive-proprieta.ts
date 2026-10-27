/**
 * Quali workflow scrivono una certa proprieta', e con che valore.
 *
 * COME SI LANCIA
 *   npx tsx scripts/chi-scrive-proprieta.ts hs_lead_status
 *   npx tsx scripts/chi-scrive-proprieta.ts hs_lead_status --solo-vuoti
 *
 * PERCHE' ESISTE. Il 27 ottobre 2026: l'app di assegnazione scarta i lead in
 * BIN guardando `hs_lead_status`, ma 10.624 contatti pescabili su 12.636 hanno
 * quello stato SVUOTATO - e un contatto in BIN da mesi rientra nel serbatoio
 * indistinguibile da un lead nuovo. Il filtro ferma l'1,14% del serbatoio
 * perche' l'84% gli passa sotto. Per chiudere il buco serve sapere chi svuota.
 *
 * PERCHE' UNA CHIAMATA PER FLUSSO. `/automation/v4/flows` elenca i flussi ma
 * NON le loro azioni, e `/automation/v2/workflows/{id}` per i flussi migrati
 * non le ha piu': dice solo `platformOwnsActions: true` e il `flowId` da
 * chiedere alla v4. Quindi: elenco dalla v4, poi un dettaglio ciascuno. Sono
 * circa 1.300 chiamate, con una pausa per non prendere 429.
 *
 * SI LEGGE SOLO. Nessun flusso viene modificato.
 */
import "./env";
import { writeFileSync } from "fs";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}` };
const BERSAGLIO = process.argv[2] || "hs_lead_status";
const SOLO_VUOTI = process.argv.includes("--solo-vuoti");
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Flusso = { id: string; name: string; isEnabled: boolean; objectTypeId: string };

async function conPazienza(url: string): Promise<Response> {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: H });
    if (r.status !== 429) return r;
    await pausa(3000);
  }
  throw new Error("429 ripetuti su " + url);
}

(async () => {
  const flussi: Flusso[] = [];
  let dopo: string | undefined;
  do {
    const u = `https://api.hubapi.com/automation/v4/flows?limit=100${dopo ? `&after=${dopo}` : ""}`;
    const j = await (await conPazienza(u)).json();
    for (const f of j.results ?? []) flussi.push(f);
    dopo = j.paging?.next?.after;
    await pausa(120);
  } while (dopo);

  // Solo i flussi sui CONTATTI: la proprieta' cercata e' loro, e dimezza le
  // chiamate.
  const daGuardare = flussi.filter((f) => f.objectTypeId === "0-1");
  console.log(`flussi in tutto: ${flussi.length}   sui contatti: ${daGuardare.length}`);

  const trovati: string[] = [];
  let fatti = 0;
  for (const f of daGuardare) {
    await pausa(90);
    let azioni: Array<{ actionId?: string; actionTypeId?: string; fields?: Record<string, unknown> }> = [];
    try {
      const r = await conPazienza(`https://api.hubapi.com/automation/v4/flows/${f.id}`);
      if (r.status !== 200) { fatti++; continue; }
      azioni = (await r.json()).actions ?? [];
    } catch { fatti++; continue; }

    for (const a of azioni) {
      const campi = a.fields ?? {};
      const prop = String(campi.property_name ?? campi.propertyName ?? "");
      if (prop !== BERSAGLIO) continue;
      const v = campi.value as { staticValue?: string } | string | undefined;
      const valore = typeof v === "object" && v !== null ? (v.staticValue ?? "") : String(v ?? "");
      const vuoto = valore === "";
      if (SOLO_VUOTI && !vuoto) continue;
      const riga = `${f.isEnabled ? "ON " : "off"}  ${f.id}  ${vuoto ? "SVUOTA" : "scrive " + JSON.stringify(valore).slice(0, 40)}  ${f.name}`;
      trovati.push(riga);
      console.log("  " + riga);
    }
    if (++fatti % 100 === 0) console.log(`  ...${fatti}/${daGuardare.length}, trovati ${trovati.length}`);
  }

  const dove = "C:/Users/Angelo/Desktop/Windserf/Dashboard/chi-scrive-" + BERSAGLIO + ".txt";
  writeFileSync(dove, trovati.join("\n") + "\n", "utf8");
  console.log(`\nFINITO: ${trovati.length} azioni che scrivono ${BERSAGLIO}`);
  console.log("registro: " + dove);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
