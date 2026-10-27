/**
 * Le prime cento unioni, fotografate prima e dopo.
 *
 * COME SI LANCIA
 *   npx tsx scripts/prova-unione-100.ts
 *
 * PERCHE' ESISTE. Prima di unire dodicimila coppie si guarda cosa succede
 * davvero a cento. La documentazione di HubSpot dice che la scheda principale
 * vince dove ha un valore e prende quello dell'altra dove e' vuota, ma non
 * chiarisce se valga per TUTTE le proprieta'. Qui si verifica sul campo che
 * conta: il codice fiscale.
 *
 * COSA FA, nell'ordine:
 *   1. legge le due schede di ogni coppia e si segna i valori;
 *   2. unisce;
 *   3. rilegge la scheda sopravvissuta e confronta.
 * Alla fine dice quante volte il codice fiscale e' stato conservato, quante
 * volte e' arrivato dalla scheda assorbita, e se in qualche caso e' sparito.
 */
import "./env";
import { createReadStream, writeFileSync } from "fs";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const EXPORT = "C:/Users/Angelo/AppData/Local/Temp/claude/C--Users-Angelo-Desktop-Windserf-Dashboard/42c51378-9261-463c-82e3-93b283449fc3/scratchpad/hs-duplicati/hubspot-duplicate-contact-2026-10-23-1792772060495.csv";
const REGISTRO = "C:/Users/Angelo/Desktop/Windserf/Dashboard/unioni-massive.csv";
const QUANTE = 100;
const PROPS = ["email", "firstname", "lastname", "phone", "codice_fiscale", "hubspot_owner_id",
  "createdate", "lastmodifieddate", "hs_lead_status", "lifecyclestage", "id_campagna_refresh"];

const DOMINI_ROTTI = new Set(["gmail.it", "gmsil.com", "gamil.com", "gmial.com", "gmai.com", "gma.com",
  "gmail.con", "gmail.co.com", "hotnail.com", "hotmai.com", "hotmail.con", "libero.ir", "libero.ti",
  "virgilo.it", "virgilio.ti", "yaho.it", "icloud.con"]);

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (v?: string) => (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const cifre = (v?: string) => { const c = (v || "").replace(/\D/g, ""); return c.length >= 9 ? c.slice(-9) : ""; };
const vir = (v?: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const emailValida = (e?: string) => {
  const v = (e || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v) && !DOMINI_ROTTI.has(v.split("@")[1]);
};

type Coppia = { tenere: string; unire: string; nome: string };

function leggiCoppie(limite: number): Promise<Coppia[]> {
  return new Promise((risolvi, rifiuta) => {
    const fuori: Coppia[] = [];
    let campo = "", apici = false, rec: string[] = [], prima = true, finito = false;
    const flusso = createReadStream(EXPORT, { encoding: "utf8", highWaterMark: 1 << 20 });
    const chiudi = () => {
      if (prima) { prima = false; rec = []; return; }
      const [id1, id2, , f1, f2, l1, l2, e1, e2, p1, p2] = rec;
      rec = [];
      if (!id1 || !id2 || norm(f1) !== norm(f2) || norm(l1) !== norm(l2) || !norm(l1)) return;
      const t1 = cifre(p1), t2 = cifre(p2);
      if (!t1 || !t2 || t1 !== t2) return;
      const v1 = emailValida(e1), v2 = emailValida(e2);
      const tenere = v1 && !v2 ? id1 : v2 && !v1 ? id2 : Number(id1) <= Number(id2) ? id1 : id2;
      fuori.push({ tenere, unire: tenere === id1 ? id2 : id1, nome: `${f1} ${l1}`.trim() });
      if (fuori.length >= limite && !finito) { finito = true; flusso.destroy(); risolvi(fuori); }
    };
    flusso.on("data", (ch: string) => {
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i];
        if (apici) { if (c === '"') { if (ch[i + 1] === '"') { campo += c; i++; } else apici = false; } else campo += c; }
        else if (c === '"') apici = true;
        else if (c === ",") { if (rec.length < 11) rec.push(campo); campo = ""; }
        else if (c === "\n") { if (rec.length < 11) rec.push(campo); campo = ""; chiudi(); }
        else if (c !== "\r") campo += c;
      }
    }).on("end", () => { if (!finito) risolvi(fuori); }).on("error", (e) => { if (!finito) rifiuta(e); });
  });
}

async function leggi(ids: string[]) {
  const m = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 100) {
    await pausa(400);
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST", headers: H,
      body: JSON.stringify({ properties: PROPS, inputs: ids.slice(i, i + 100).map((id) => ({ id })) })
    });
    for (const c of (await r.json()).results || []) m.set(c.id, c.properties);
  }
  return m;
}

(async () => {
  const coppie = await leggiCoppie(QUANTE);
  console.log(`coppie di prova: ${coppie.length}`);

  const prima = await leggi(coppie.flatMap((c) => [c.tenere, c.unire]));
  console.log(`schede lette prima: ${prima.size}`);

  let ok = 0, ko = 0;
  const esiti: string[] = [];
  for (const c of coppie) {
    await pausa(300);
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/merge", {
      method: "POST", headers: H, body: JSON.stringify({ primaryObjectId: c.tenere, objectIdToMerge: c.unire })
    });
    if (r.ok) { ok++; esiti.push("unita"); }
    else { ko++; esiti.push(`ERRORE ${r.status}: ${(await r.text()).replace(/[",\r\n]/g, " ").slice(0, 110)}`); }
  }
  console.log(`\nunite ${ok}, errori ${ko}`);

  await pausa(3000);
  const dopo = await leggi(coppie.map((c) => c.tenere));

  // IL CONFRONTO che risponde alla domanda vera: il codice fiscale sopravvive?
  const S = { soloPrincipale: 0, soloAssorbita: 0, portato: 0, perso: 0, entrambi: 0, diversi: 0, vinceP: 0, nessuno: 0 };
  const righe = ["id_tenuto,id_unito,nome,cf_principale_prima,cf_assorbita_prima,cf_dopo,caso,esito_unione"];
  coppie.forEach((c, i) => {
    const p = prima.get(c.tenere) || {}, a = prima.get(c.unire) || {}, d = dopo.get(c.tenere) || {};
    const cfP = (p.codice_fiscale || "").trim(), cfA = (a.codice_fiscale || "").trim(), cfD = (d.codice_fiscale || "").trim();
    let caso = "";
    if (!cfP && !cfA) { S.nessuno++; caso = "nessuno dei due aveva il CF"; }
    else if (cfP && !cfA) { S.soloPrincipale++; caso = cfD === cfP ? "CF solo sulla principale: conservato" : "CF solo sulla principale: PERSO"; if (cfD !== cfP) S.perso++; }
    else if (!cfP && cfA) { S.soloAssorbita++; if (cfD === cfA) { S.portato++; caso = "CF solo sull'assorbita: PORTATO sulla principale"; } else { S.perso++; caso = "CF solo sull'assorbita: PERSO"; } }
    else { S.entrambi++; if (cfP !== cfA) S.diversi++; if (cfD === cfP) S.vinceP++; caso = cfP === cfA ? "uguali su entrambe" : `diversi: dopo c'e' ${cfD === cfP ? "quello della principale" : cfD === cfA ? "quello dell'assorbita" : "altro"}`; }
    righe.push([c.tenere, c.unire, vir(c.nome), vir(cfP), vir(cfA), vir(cfD), vir(caso), vir(esiti[i])].join(","));
  });
  writeFileSync(REGISTRO.replace("unioni-massive", "prova-100-unioni"), "\uFEFF" + righe.join("\r\n"), "utf8");

  console.log("\nCODICE FISCALE, cosa e' successo");
  console.log(`  nessuno dei due ce l'aveva        ${S.nessuno}`);
  console.log(`  solo la principale                ${S.soloPrincipale}`);
  console.log(`  solo l'assorbita                  ${S.soloAssorbita}`);
  console.log(`     di cui PORTATO sulla tenuta    ${S.portato}`);
  console.log(`  valorizzato su entrambe           ${S.entrambi}  (di cui diversi: ${S.diversi})`);
  console.log(`  PERSI                             ${S.perso}`);
  console.log(`\nregistro: ${REGISTRO.replace("unioni-massive", "prova-100-unioni")}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
