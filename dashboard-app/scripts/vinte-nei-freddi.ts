// Nelle trascrizioni dei "freddi" c'e' qualche vinta?
//
// I nomi dei file sono "<id contatto HubSpot> - Nome Cognome.txt". Si prende
// l'id, si chiede a HubSpot quali trattative ha quel contatto, e si guarda
// `hs_is_closed_won`: e' la proprieta' standard che dice vinta/non vinta, cosi'
// non serve indovinare i nomi delle fasi.
import "./env";
import fs from "node:fs";
import path from "node:path";

// La cartella si passa come argomento: lo stesso controllo serve per ogni
// mazzetto di trascrizioni, non solo per i "freddi".
const CARTELLA = process.argv[2] ?? "C:/Users/Angelo/Desktop/trascrizioni-freddi";
const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hs(url: string, corpo: unknown): Promise<any> {
  for (let t = 1; t <= 4; t++) {
    const r = await fetch(`https://api.hubapi.com${url}`, { method: "POST", headers: H, body: JSON.stringify(corpo) });
    if (r.status === 429 && t < 4) { await pausa(1200 * t); continue; }
    if (!r.ok) { console.error(`${url}: HubSpot ${r.status} ${(await r.text()).slice(0, 200)}`); return null; }
    return r.json();
  }
  return null;
}

const aPezzi = <T,>(v: T[], n: number) => Array.from({ length: Math.ceil(v.length / n) }, (_, i) => v.slice(i * n, i * n + n));

(async () => {
  const schede = fs.readdirSync(CARTELLA).filter((f) => f.endsWith(".txt")).map((f) => {
    const base = path.basename(f, ".txt");
    const taglio = base.indexOf(" - ");
    return { id: base.slice(0, taglio).trim(), nome: base.slice(taglio + 3).trim(), file: f };
  });
  console.log(`${schede.length} trascrizioni\n`);

  // 1. le trattative associate a ogni contatto
  const trattativeDi = new Map<string, string[]>();
  for (const pezzo of aPezzi(schede.map((s) => s.id), 100)) {
    const d = await hs("/crm/v4/associations/contacts/deals/batch/read", { inputs: pezzo.map((id) => ({ id })) });
    for (const r of d?.results ?? [])
      trattativeDi.set(String(r.from?.id), (r.to ?? []).map((t: any) => String(t.toObjectId)));
  }
  const idTrattative = [...new Set([...trattativeDi.values()].flat())];
  console.log(`contatti con almeno una trattativa: ${[...trattativeDi.values()].filter((v) => v.length).length}`);
  console.log(`trattative totali da leggere: ${idTrattative.length}\n`);

  // 2. le trattative, con la bandierina standard "vinta"
  const tratt = new Map<string, any>();
  for (const pezzo of aPezzi(idTrattative, 100)) {
    const d = await hs("/crm/v3/objects/deals/batch/read", {
      inputs: pezzo.map((id) => ({ id })),
      properties: ["dealname", "dealstage", "amount", "closedate", "createdate", "pipeline", "hs_is_closed_won", "hs_is_closed"]
    });
    for (const r of d?.results ?? []) tratt.set(String(r.id), r.properties ?? {});
  }

  const vinte: string[] = [], aperte: string[] = [], perse: string[] = [], senza: string[] = [];
  let incasso = 0;
  for (const s of schede) {
    const mie = (trattativeDi.get(s.id) ?? []).map((i) => tratt.get(i)).filter(Boolean);
    if (!mie.length) { senza.push(`   ${s.nome}`); continue; }
    const v = mie.filter((t) => t.hs_is_closed_won === "true");
    const a = mie.filter((t) => t.hs_is_closed !== "true");
    if (v.length) {
      const soldi = v.reduce((x, t) => x + (Number(t.amount) || 0), 0);
      incasso += soldi;
      vinte.push(`   ${s.nome.padEnd(28)} ${soldi ? soldi.toLocaleString("it-IT") + " EUR" : "importo vuoto"}   ${v.map((t) => t.dealname).join(" | ")}   chiusa ${v[0].closedate?.slice(0, 10) ?? "?"}`);
    } else if (a.length) {
      aperte.push(`   ${s.nome.padEnd(28)} ${a.map((t) => t.dealstage).join(" | ")}`);
    } else {
      perse.push(`   ${s.nome.padEnd(28)} ${mie.map((t) => t.dealstage).join(" | ")}`);
    }
  }

  const riga = (titolo: string, v: string[]) => { console.log(`${titolo}: ${v.length}`); v.slice(0, 40).forEach((x) => console.log(x)); if (v.length > 40) console.log(`   ... e altri ${v.length - 40}`); console.log(); };
  riga("VINTE", vinte);
  if (incasso) console.log(`   incasso dichiarato nelle trattative vinte: ${incasso.toLocaleString("it-IT")} EUR\n`);
  riga("TRATTATIVE ANCORA APERTE", aperte);
  riga("TRATTATIVE CHIUSE NON VINTE", perse);
  console.log(`NESSUNA TRATTATIVA: ${senza.length}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
