/**
 * Le trascrizioni delle CALL REM: le ultime 50 che si trovano, senza badare
 * all'esito ne' alla data.
 *
 * Differenza dalla cartella "trascrizioni-freddi", che era un'altra domanda:
 * quella era scelta per ESITO (trattativa persa, no show) e dentro ci finiva
 * ogni categoria - 24 div coach, 18 REM, 14 MBE. Qui il filtro e' la CATEGORIA
 * e l'esito non conta.
 *
 * Non serve nessun export manuale: i contatti con una registrazione si
 * riconoscono dalla proprieta' `link_trascrizione_fireflies`, e il testo si
 * chiede all'API di Fireflies partendo dall'identificativo dentro quel
 * collegamento (il collegamento stesso e' firmato e scade in sei ore, vedi
 * linkTrascrizione in src/lib/fireflies.ts).
 */
import "./env";
import fs from "node:fs";
import path from "node:path";
import { leggiFrasi } from "../src/lib/fireflies";
import { guessCategoria } from "../src/lib/campaignCategory";

const QUANTE = Number(process.argv[2] ?? 50);
const CARTELLA = "C:/Users/Angelo/Desktop/trascrizioni-rem";
const H = { Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`, "Content-Type": "application/json" };
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Scheda = { id: string; nome: string; campagna: string; link: string };

async function candidati(): Promise<Scheda[]> {
  const out: Scheda[] = [];
  let dopo: string | undefined;
  // Si prendono piu' schede di quante servano: qualche registrazione risulta
  // vuota (riunione cancellata, audio mai elaborato) e va sostituita.
  for (let p = 0; p < 4 && out.length < QUANTE * 2; p++) {
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST", headers: H, body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: "link_trascrizione_fireflies", operator: "HAS_PROPERTY" },
          { propertyName: "id_campagna_refresh", operator: "CONTAINS_TOKEN", value: "rem" }
        ]}],
        properties: ["firstname", "lastname", "id_campagna_refresh", "link_trascrizione_fireflies"],
        sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
        limit: 100, after: dopo
      })
    });
    if (!r.ok) { console.error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 200)}`); break; }
    const d: any = await r.json();
    for (const c of d.results ?? []) {
      const p2 = c.properties ?? {};
      const campagna = (p2.id_campagna_refresh ?? "").trim();
      if (guessCategoria(campagna) !== "REM") continue; // scarta i tre fuori categoria
      out.push({
        id: String(c.id),
        nome: `${p2.firstname ?? ""} ${p2.lastname ?? ""}`.trim() || "(senza nome)",
        campagna,
        link: (p2.link_trascrizione_fireflies ?? "").trim()
      });
    }
    dopo = d.paging?.next?.after;
    if (!dopo) break;
  }
  return out;
}

/**
 * L'identificativo Fireflies dentro il collegamento salvato su HubSpot.
 *
 * I collegamenti sono di tre epoche e NON si puo' prendere l'ultimo segmento,
 * che e' l'errore che ha fatto rispondere "Transcript not found" a tutte e 100
 * le schede al primo giro:
 *   - S3:  .../01K6YV0Y1DD0JSDC4H1XHVEBMH/downloads/transcript/igs-zcdr-kah-d3
 *          qui l'ultimo segmento e' il nome del file, l'identificativo sta in mezzo
 *   - Dashboard: .../api/trascrizione/01M5HX26C4FEBD3N1BRJK0PH03.docx?t=...
 *   - spazzatura: il campo contiene una data fra parentesi quadre
 * In tutti i casi validi l'identificativo e' un ULID: 26 caratteri che
 * cominciano per "01". Si cerca quello, dovunque sia nel collegamento.
 */
const idFireflies = (link: string) => (link.match(/01[0-9A-HJKMNP-TV-Z]{24}/i) ?? [""])[0];

(async () => {
  const chiave = process.env.FIREFLIES_API_KEY;
  if (!chiave) { console.error("FIREFLIES_API_KEY non impostata"); process.exit(1); }

  const schede = await candidati();
  console.log(`candidati REM con registrazione: ${schede.length}  (ne servono ${QUANTE})\n`);
  fs.mkdirSync(CARTELLA, { recursive: true });

  let fatti = 0, vuote = 0, errori = 0;
  for (const s of schede) {
    if (fatti >= QUANTE) break;
    const ff = idFireflies(s.link);
    if (!ff) { errori++; continue; }
    try {
      const frasi = await leggiFrasi(chiave, ff);
      if (!frasi.length) { vuote++; continue; }
      const nomeFile = `${s.id} - ${s.nome}`.replace(/[\/:*?"<>|]/g, "");
      const corpo = frasi.map((f) => `${f.voce || "?"}: ${f.testo}`).join("\n");
      fs.writeFileSync(path.join(CARTELLA, `${nomeFile}.txt`),
        `${nomeFile}\nCampagna: ${s.campagna}\nTrascrizione: https://app.fireflies.ai/view/${ff}\n${"-".repeat(60)}\n\n${corpo}\n`, "utf8");
      fatti++;
      console.log(`  ${String(fatti).padStart(2)}. ${s.nome.padEnd(28)} ${String(frasi.length).padStart(4)} battute   ${s.campagna}`);
    } catch (e) {
      errori++;
      console.log(`  errore su ${s.nome}: ${e instanceof Error ? e.message : e}`);
    }
    await pausa(300);
  }
  console.log(`\nscritte ${fatti} trascrizioni in ${CARTELLA}`);
  console.log(`registrazioni vuote saltate: ${vuote}   errori: ${errori}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
