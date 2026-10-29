/**
 * Le trascrizioni delle call divise per PRODOTTO, fino a 100 per prodotto.
 *
 * Generalizza trascrizioni-rem.ts: un solo giro su HubSpot per tutti i
 * contatti che hanno una registrazione (proprieta' `link_trascrizione_fireflies`),
 * poi si raggruppa per categoria con la stessa funzione che usa la Dashboard
 * e si scarica il testo da Fireflies.
 *
 * Esito e data non contano: si prendono le piu' recenti e basta.
 *
 * L'identificativo della trascrizione NON e' l'ultimo pezzo del collegamento
 * salvato su HubSpot - vedi il commento dentro idFireflies.
 */
import "./env";
import fs from "node:fs";
import path from "node:path";
import { leggiFrasi } from "../src/lib/fireflies";
import { guessCategoria } from "../src/lib/campaignCategory";

const PER_PRODOTTO = Number(process.argv[2] ?? 100);
const RADICE = "C:/Users/Angelo/Desktop/trascrizioni-prodotti";
// "Altro" e "Nessuna" non sono prodotti: sono campagne senza categoria
// riconoscibile e campi vuoti, e in un regalo al marketing farebbero solo
// confusione.
const NON_PRODOTTI = new Set(["Altro", "Nessuna"]);
// Quali prodotti: si passano come terzo argomento separati da virgola
// (es. "REM,MEP,ICMD"). Senza argomento si prendono tutti quelli riconosciuti,
// che pero' non e' sempre quello che serve: "prodotto" per il marketing e' un
// elenco piu' corto di quello che la Dashboard sa distinguere.
const SCELTI = (process.argv[3] ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

const H = { Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`, "Content-Type": "application/json" };
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Scheda = { id: string; nome: string; campagna: string; link: string };

/** L'identificativo Fireflies dentro il collegamento salvato su HubSpot.
 *
 * I collegamenti sono di tre epoche e NON si puo' prendere l'ultimo segmento,
 * che e' l'errore per cui il primo tentativo rispondeva "Transcript not found"
 * su tutte le schede:
 *   - S3:        .../01K6YV0Y1DD0JSDC4H1XHVEBMH/downloads/transcript/igs-zcdr-kah-d3
 *   - Dashboard: .../api/trascrizione/01M5HX26C4FEBD3N1BRJK0PH03.docx?t=...
 *   - spazzatura: nel campo c'e' una data fra parentesi quadre
 * Nei casi validi l'identificativo e' un ULID: 26 caratteri che cominciano
 * per "01". Si cerca quello, dovunque sia nel collegamento. */
const idFireflies = (link: string) => (link.match(/01[0-9A-HJKMNP-TV-Z]{24}/i) ?? [""])[0];

const pulisci = (s: string) => s.replace(/[\/:*?"<>|]/g, "").trim();

async function tutteLeSchede(): Promise<Scheda[]> {
  const out: Scheda[] = [];
  let dopo: string | undefined;
  for (let p = 0; p < 120; p++) {
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST", headers: H, body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "link_trascrizione_fireflies", operator: "HAS_PROPERTY" }] }],
        properties: ["firstname", "lastname", "id_campagna_refresh", "link_trascrizione_fireflies"],
        sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
        limit: 100, after: dopo
      })
    });
    if (!r.ok) { console.error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 200)}`); break; }
    const d: any = await r.json();
    for (const c of d.results ?? []) {
      const p2 = c.properties ?? {};
      out.push({
        id: String(c.id),
        nome: `${p2.firstname ?? ""} ${p2.lastname ?? ""}`.trim() || "(senza nome)",
        campagna: (p2.id_campagna_refresh ?? "").trim(),
        link: (p2.link_trascrizione_fireflies ?? "").trim()
      });
    }
    dopo = d.paging?.next?.after;
    if (!dopo) break;
  }
  return out;
}

/** Il testo, con una riprova se Fireflies chiede di rallentare. */
async function frasi(chiave: string, id: string) {
  for (let t = 1; t <= 3; t++) {
    try {
      return await leggiFrasi(chiave, id);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/too many|rate|429/i.test(m) && t < 3) { await pausa(4000 * t); continue; }
      throw e;
    }
  }
  return [];
}

(async () => {
  const chiave = process.env.FIREFLIES_API_KEY;
  if (!chiave) { console.error("FIREFLIES_API_KEY non impostata"); process.exit(1); }

  const schede = await tutteLeSchede();
  const perProdotto = new Map<string, Scheda[]>();
  for (const s of schede) {
    const k = guessCategoria(s.campagna);
    if (NON_PRODOTTI.has(k)) continue;
    if (SCELTI.length && !SCELTI.includes(k.toUpperCase())) continue;
    if (!perProdotto.has(k)) perProdotto.set(k, []);
    perProdotto.get(k)!.push(s);
  }
  const prodotti = [...perProdotto.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`${schede.length} contatti con registrazione, ${prodotti.length} prodotti\n`);
  prodotti.forEach(([k, v]) => console.log(`   ${k.padEnd(18)} disponibili ${String(v.length).padStart(4)}`));
  console.log();

  fs.mkdirSync(RADICE, { recursive: true });
  const indice: string[] = ["prodotto;id contatto;nome;campagna;battute;trascrizione"];
  const riassunto: string[] = [];

  for (const [prodotto, lista] of prodotti) {
    const cartella = path.join(RADICE, pulisci(prodotto).replace(/\s+/g, "_"));
    fs.mkdirSync(cartella, { recursive: true });
    let fatti = 0, vuote = 0, errori = 0;
    for (const s of lista) {
      if (fatti >= PER_PRODOTTO) break;
      const ff = idFireflies(s.link);
      if (!ff) { errori++; continue; }
      try {
        const f = await frasi(chiave, ff);
        if (!f.length) { vuote++; continue; }
        const nomeFile = pulisci(`${s.id} - ${s.nome}`);
        const link = `https://app.fireflies.ai/view/${ff}`;
        fs.writeFileSync(path.join(cartella, `${nomeFile}.txt`),
          `${nomeFile}\nProdotto: ${prodotto}\nCampagna: ${s.campagna}\nTrascrizione: ${link}\n${"-".repeat(60)}\n\n` +
          f.map((x) => `${x.voce || "?"}: ${x.testo}`).join("\n") + "\n", "utf8");
        indice.push([prodotto, s.id, s.nome, s.campagna, String(f.length), link].join(";"));
        fatti++;
      } catch (e) {
        errori++;
      }
      await pausa(250);
    }
    const r = `${prodotto.padEnd(18)} scritte ${String(fatti).padStart(4)} / disponibili ${String(lista.length).padStart(4)}   (vuote ${vuote}, errori ${errori})`;
    riassunto.push(r);
    console.log("  " + r);
  }

  fs.writeFileSync(path.join(RADICE, "indice.csv"), "\uFEFF" + indice.join("\n") + "\n", "utf8");
  console.log(`\nRIASSUNTO`);
  riassunto.forEach((r) => console.log("  " + r));
  console.log(`\ntutto in ${RADICE}  (piu' indice.csv con ${indice.length - 1} righe)`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
