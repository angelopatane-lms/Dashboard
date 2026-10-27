/**
 * Unisce le coppie dell'esportazione duplicati di HubSpot, ma solo le sicure.
 *
 * COME SI LANCIA
 *   npx tsx scripts/unisci-export-hubspot.ts            conta e basta
 *   npx tsx scripts/unisci-export-hubspot.ts --unisci   unisce davvero
 *
 * DA DOVE VIENE IL FILE. Gestione duplicati > Azioni > Esporta duplicati. Sono
 * 30.000 coppie proposte dal modello di HubSpot, che abbina su nome ed email.
 * Il file ha 2.595 colonne: qui servono solo le prime undici.
 *
 * PERCHE' NON TUTTE. Il modello sbaglia, e non di poco: fra le coppie date al
 * 98% c'e' "Anamaria Bianca Hatcau" accoppiata a "Maria Rosa Oliva". Unirle
 * significherebbe cancellare una persona e attribuire all'altra la sua storia,
 * senza possibilita' di tornare indietro. Qui si tengono solo le coppie dove
 * nome, cognome E numero coincidono tutti e tre: 11.806 su 30.000. Le altre
 * restano in HubSpot, da guardare con occhi umani.
 *
 * QUALE SCHEDA SOPRAVVIVE. Quella con l'email valida; se lo sono entrambe o
 * nessuna, quella con l'id piu' basso, che e' la piu' vecchia e ha la storia
 * piu' lunga. HubSpot tiene i valori della scheda principale e riempie i campi
 * vuoti con quelli dell'altra, quindi non si perde niente.
 *
 * SI PUO' INTERROMPERE. Ogni unione viene scritta nel registro mentre avviene:
 * rilanciando, le coppie gia' fatte si saltano. Serve, perche' 11.806 chiamate
 * sono piu' di un'ora e un portatile che si addormenta non deve costare il
 * lavoro fatto.
 */
import "./env";
import { createReadStream, existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const EXPORT = "C:/Users/Angelo/AppData/Local/Temp/claude/C--Users-Angelo-Desktop-Windserf-Dashboard/42c51378-9261-463c-82e3-93b283449fc3/scratchpad/hs-duplicati/hubspot-duplicate-contact-2026-10-23-1792772060495.csv";
const REGISTRO = "C:/Users/Angelo/Desktop/Windserf/Dashboard/unioni-massive.csv";
const UNISCI = process.argv.includes("--unisci");

/**
 * QUANTE FARNE IN QUESTO GIRO. `--quante 100` ne fa cento e si ferma: serve a
 * guardare il risultato vero prima di lanciarne dodicimila. Senza l'opzione le
 * fa tutte, saltando quelle gia' registrate.
 */
const quante = (() => {
  const i = process.argv.indexOf("--quante");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

/**
 * Domini che non esistono o sono refusi: un'email cosi' non e' valida.
 *
 * SOLO REFUSI VERI. `live.com`, `live.it`, `alice.it` e simili sono domini
 * legittimi e non vanno qui dentro: ci erano finiti per errore e avrebbero
 * fatto perdere la precedenza a contatti con l'email giusta.
 */
const DOMINI_ROTTI = new Set(["gmail.it", "gmsil.com", "gamil.com", "gmial.com", "gmai.com", "gma.com",
  "gmail.con", "gmail.co.com", "hotnail.com", "hotmai.com", "hotmail.con", "libero.ir", "libero.ti",
  "virgilo.it", "virgilio.ti", "yaho.it", "icloud.con"]);

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (v?: string) => (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();
const cifre = (v?: string) => { const c = (v || "").replace(/\D/g, ""); return c.length >= 9 ? c.slice(-9) : ""; };
const vir = (v?: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const emailValida = (e?: string) => {
  const v = (e || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v)) return false;
  return !DOMINI_ROTTI.has(v.split("@")[1]);
};

type Coppia = { tenere: string; unire: string; nome: string; emailT: string; emailU: string; tel: string };

/** Legge il file a pezzi e tiene solo le prime undici colonne di ogni riga. */
function leggiCoppie(): Promise<Coppia[]> {
  return new Promise((risolvi, rifiuta) => {
    const fuori: Coppia[] = [];
    let campo = "", dentroApici = false, rec: string[] = [], prima = true;
    const chiudiRiga = () => {
      if (prima) { prima = false; rec = []; return; }
      const [id1, id2, , f1, f2, l1, l2, e1, e2, p1, p2] = rec;
      rec = [];
      if (!id1 || !id2) return;
      if (norm(f1) !== norm(f2) || norm(l1) !== norm(l2) || !norm(l1)) return;
      const t1 = cifre(p1), t2 = cifre(p2);
      if (!t1 || !t2 || t1 !== t2) return;
      const v1 = emailValida(e1), v2 = emailValida(e2);
      let tenere: string, unire: string, emailT: string, emailU: string;
      if (v1 && !v2) { tenere = id1; unire = id2; emailT = e1; emailU = e2; }
      else if (v2 && !v1) { tenere = id2; unire = id1; emailT = e2; emailU = e1; }
      else if (Number(id1) <= Number(id2)) { tenere = id1; unire = id2; emailT = e1; emailU = e2; }
      else { tenere = id2; unire = id1; emailT = e2; emailU = e1; }
      fuori.push({ tenere, unire, nome: `${f1} ${l1}`.trim(), emailT, emailU, tel: p1 || p2 });
    };
    createReadStream(EXPORT, { encoding: "utf8", highWaterMark: 1 << 20 })
      .on("data", (ch: string) => {
        for (let i = 0; i < ch.length; i++) {
          const c = ch[i];
          if (dentroApici) {
            if (c === '"') { if (ch[i + 1] === '"') { campo += c; i++; } else dentroApici = false; }
            else campo += c;
          } else if (c === '"') dentroApici = true;
          else if (c === ",") { if (rec.length < 11) rec.push(campo); campo = ""; }
          else if (c === "\n") { if (rec.length < 11) rec.push(campo); campo = ""; chiudiRiga(); }
          else if (c !== "\r") campo += c;
        }
      })
      .on("end", () => { if (rec.length) chiudiRiga(); risolvi(fuori); })
      .on("error", rifiuta);
  });
}

(async () => {
  const coppie = await leggiCoppie();
  console.log(`\ncoppie sicure (nome, cognome e telefono uguali): ${coppie.length}`);

  // SI SALTANO SOLO LE RIUSCITE. Le fallite si riprovano: il 23 ottobre 1.666
  // sono cadute sull'alias (vedi sotto) e con la nuova logica passano.
  const fatte = new Set<string>();
  if (existsSync(REGISTRO))
    for (const r of readFileSync(REGISTRO, "utf8").split(/\r?\n/).slice(1)) {
      if (!r.trim()) continue;
      if (/"unita"\s*$/.test(r)) fatte.add(r.split(",")[1]);
    }
  if (fatte.size) console.log(`gia' unite in un giro precedente: ${fatte.size}`);

  const restano = coppie.filter((c) => !fatte.has(c.unire)).slice(0, quante);
  console.log(`da fare adesso: ${restano.length}`);

  if (!UNISCI) { console.log("\n(prova: non ho unito niente. Per unire davvero: --unisci)"); process.exit(0); }
  if (!existsSync(REGISTRO))
    writeFileSync(REGISTRO, "\uFEFFid_tenuto,id_unito,nome,email_tenuta,email_unita,telefono,esito\r\n", "utf8");

  /**
   * L'ALIAS. Una persona compare in piu' coppie: quando la prima unione
   * assorbe una scheda, le coppie successive che la nominano trovano solo un
   * alias, e HubSpot risponde "has a forward reference to N. Only canonical
   * objects can be merged". Il bello e' che nel messaggio c'e' l'id buono:
   * basta rileggerlo e riprovare. Il 23 ottobre 1.666 coppie su 6.500 sono
   * cadute cosi', e venti di fila hanno fermato l'esecuzione.
   */
  async function unisci(tenere: string, unire: string, giri = 0): Promise<string> {
    if (tenere === unire) return "gia' la stessa scheda";
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/merge", {
      method: "POST", headers: H,
      body: JSON.stringify({ primaryObjectId: tenere, objectIdToMerge: unire })
    });
    if (r.status === 429) { await pausa(5000); return giri < 3 ? unisci(tenere, unire, giri + 1) : "429 ripetuti"; }
    if (r.ok) return "unita";
    const testo = await r.text();
    // Il messaggio dice QUALE scheda e' l'alias (objectId=...) e CHI l'ha
    // assorbita (forward reference to ...): si sostituisce quella e si riprova.
    const sparita = /objectId=(\d+)\}/.exec(testo)?.[1];
    const vero = /forward reference to (\d+)/.exec(testo)?.[1];
    if (sparita && vero && giri < 4) {
      await pausa(250);
      const esito = sparita === unire ? await unisci(tenere, vero, giri + 1)
        : sparita === tenere ? await unisci(vero, unire, giri + 1)
        : `ERRORE: alias ${sparita} non e' nessuna delle due schede`;
      return esito.startsWith("unita") ? "unita (dopo alias)" : esito;
    }
    return `ERRORE ${r.status}: ${testo.replace(/[",\r\n]/g, " ").slice(0, 120)}`;
  }

  let ok = 0, ko = 0, diFila = 0;
  const inizio = Date.now();
  for (const [i, c] of restano.entries()) {
    await pausa(300);
    let esito = "";
    try { esito = await unisci(c.tenere, c.unire); }
    catch (e) { esito = `ERRORE rete: ${e instanceof Error ? e.message.slice(0, 80) : e}`; }

    if (esito.startsWith("unita")) { ok++; diFila = 0; }
    else if (esito === "gia' la stessa scheda") { diFila = 0; }
    else { ko++; diFila++; }
    appendFileSync(REGISTRO, [c.tenere, c.unire, vir(c.nome), vir(c.emailT), vir(c.emailU), vir(c.tel), vir(esito)].join(",") + "\r\n", "utf8");

    // SI FERMA DA SOLO se qualcosa si e' rotto: venti errori di fila non sono
    // casi particolari, sono un problema sistematico, e andare avanti per
    // altre diecimila coppie lo moltiplicherebbe.
    if (diFila >= 20) { console.log(`\nFERMATO: 20 errori di fila. Ultimo: ${esito}`); break; }

    if ((i + 1) % 250 === 0) {
      const min = (Date.now() - inizio) / 60000;
      const mancano = ((restano.length - i - 1) * (min / (i + 1))).toFixed(0);
      console.log(`  ${i + 1} / ${restano.length}   unite ${ok}, errori ${ko}   restano ~${mancano} minuti`);
    }
  }
  console.log(`\nUNITE   ${ok}`);
  console.log(`ERRORI  ${ko}`);
  console.log(`registro: ${REGISTRO}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
