/** Scarica da Fireflies le trascrizioni dei contatti di un CSV, una per file. */
import "./env";
import fs from "fs";
import path from "path";
import { leggiFrasi } from "../src/lib/fireflies";

const sorgente = process.argv[2];
const cartella = process.argv[3];

function celle(riga: string) {
  const out: string[] = [];
  let cur = "", dentro = false;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (c === '"') { if (dentro && riga[i + 1] === '"') { cur += '"'; i++; } else dentro = !dentro; }
    else if (c === ";" && !dentro) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

(async () => {
  const chiave = process.env.FIREFLIES_API_KEY;
  if (!chiave) { console.error("FIREFLIES_API_KEY non impostata"); process.exit(1); }
  const testo = fs.readFileSync(sorgente, "utf8").replace(/^\uFEFF/, "");
  const righe = testo.split(/\r?\n/).filter(Boolean);
  const cols = celle(righe[0]);
  const iLink = cols.indexOf("Trascrizione Fireflies");
  const iId = cols.indexOf("ID contatto");
  const iNome = cols.indexOf("Nome");
  const iCogn = cols.indexOf("Cognome");
  fs.mkdirSync(cartella, { recursive: true });

  let fatti = 0, vuoti = 0;
  for (const r of righe.slice(1)) {
    const c = celle(r);
    const link = (c[iLink] ?? "").trim();
    if (!link) continue;
    // DAL COLLEGAMENTO SI RICAVA L'IDENTIFICATIVO, e i collegamenti sono di due
    // epoche: quelli nuovi puntano alla pagina (app.fireflies.ai/view/<id>),
    // quelli vecchi al file su S3 (download-ff.s3.../<id>), firmato e scaduto
    // da un pezzo. In tutti e due l'ultimo segmento e' l'identificativo, ed e'
    // l'unica cosa che serve: il testo lo si richiede all'API.
    const pulito = link.split("?")[0].replace(/\/$/, "");
    const id = (pulito.split("/").pop() ?? "").split("::").pop() ?? "";
    if (!id) { console.log("  link non riconosciuto:", link.slice(0, 60)); continue; }
    const nome = `${c[iId]} - ${c[iNome]} ${c[iCogn]}`.trim().replace(/[\/:*?"<>|]/g, "");
    try {
      const frasi = await leggiFrasi(chiave, id);
      if (!frasi.length) { vuoti++; console.log("  vuota:", nome); continue; }
      const corpo = frasi.map((f) => `${f.voce || "?"}: ${f.testo}`).join("\n");
      fs.writeFileSync(path.join(cartella, `${nome}.txt`),
        `${nome}\nTrascrizione Fireflies: ${link}\n${"-".repeat(60)}\n\n${corpo}\n`, "utf8");
      fatti++;
      console.log(`  ${nome}  (${frasi.length} battute)`);
    } catch (e) {
      console.log("  errore su", nome, e instanceof Error ? e.message : e);
    }
  }
  console.log(`\nscritte ${fatti} trascrizioni in ${cartella}` + (vuoti ? `, ${vuoti} vuote su Fireflies` : ""));
  process.exit(0);
})();
