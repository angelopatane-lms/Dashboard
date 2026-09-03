// Analisi diagnostica di un campione di contatti HubSpot, SENZA scrivere nulla
// e SENZA bisogno del database.
//
// Serve a rispondere, con numeri misurati e non stimati, alle domande che
// determinano schema, piano Postgres e fattibilita' del bootstrap:
//   - quante conversioni ha in media un contatto (-> righe totali, spazio)
//   - il tetto HubSpot di 45 revisioni per proprieta' di contatto morde
//     davvero? (-> stiamo gia' perdendo storico?)
//   - quanto indietro va realmente la cronologia (-> "non solo 6 mesi")
//   - quante campagne distinte esistono e quanto sono lunghi i nomi
//     (-> conferma che la tabella di lookup conviene)
//   - a che velocita' risponde il portale e quanti 429 incassiamo
//     (-> durata del bootstrap e impatto su HubSpot)
//   - ci sono dati che la chiave primaria scarterebbe in silenzio?
//
// Uso: npm run analizza:campagne -- --limite 500
// (richiede solo HUBSPOT_PRIVATE_APP_TOKEN in dashboard-app/.env.local)

import { richiedi } from "./env";
import {
  cercaContattiRilevanti,
  leggiCronologiaContatti,
  statistiche
} from "../src/lib/campaignConversions/hubspotSync";

// Tetto documentato da HubSpot per le proprieta' di contatto: oltre questo
// numero di revisioni le piu' vecchie vengono eliminate e non sono piu'
// recuperabili da nessuna API.
// https://knowledge.hubspot.com/properties/export-property-history
const TETTO_REVISIONI_HUBSPOT = 45;

const CONTATTI_STIMATI = 345_179;
const BYTE_PER_RIGA = 135;

function percentile(ordinati: number[], p: number): number {
  if (!ordinati.length) return 0;
  const i = Math.min(ordinati.length - 1, Math.floor((p / 100) * ordinati.length));
  return ordinati[i];
}

function hhmmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}

function riga(etichetta: string, valore: string | number): string {
  return `  ${etichetta.padEnd(38, ".")} ${valore}`;
}

function leggiNumero(argv: string[], nome: string, predefinito: number): number {
  const i = argv.indexOf(nome);
  if (i === -1) return predefinito;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${nome} richiede un intero non negativo (ricevuto: ${argv[i + 1] ?? "niente"})`);
  }
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const limite = leggiNumero(argv, "--limite", 500);
  // La ricerca pagina per hs_object_id crescente: partire da 0 significa
  // campionare i contatti PIU' VECCHI del portale, che avendo avuto piu' tempo
  // per convertire possono avere piu' eventi della media. Con --da-id si
  // campiona un'altra zona dello spazio degli id e si confrontano i risultati.
  const daId = leggiNumero(argv, "--da-id", 0);

  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");

  console.log(`[analisi] campione di ${limite.toLocaleString("it-IT")} contatti a partire dall'id ${daId.toLocaleString("it-IT")}.`);
  console.log("[analisi] nessuna scrittura, ne' su HubSpot ne' su database.\n");
  statistiche.reset();

  const iniziato = Date.now();

  let contatti = 0;
  let contattiSenzaEventiUtili = 0;
  let contattiConMerge = 0;
  let eventiScartati = 0;
  let duplicatiScartatiDallaChiave = 0;

  const eventiPerContatto: number[] = [];
  const campagne = new Map<string, number>();
  const eventiPerAnno = new Map<number, number>();
  let piuVecchio = Number.POSITIVE_INFINITY;
  let piuRecente = 0;

  let msRicerca = 0;
  let msLettura = 0;
  let blocchi = 0;

  let tRicercaInizio = Date.now();

  for await (const batch of cercaContattiRilevanti(token, [], daId)) {
    msRicerca += Date.now() - tRicercaInizio;

    const ids = batch.map((c) => c.id).slice(0, Math.max(0, limite - contatti));
    if (!ids.length) break;

    const tLettura = Date.now();
    const dettagli = await leggiCronologiaContatti(token, ids);
    msLettura += Date.now() - tLettura;
    blocchi += 1;

    for (const id of ids) {
      const info = dettagli.get(id);
      if (!info) continue;
      contatti += 1;
      if (info.mergedIds.length) contattiConMerge += 1;

      const validi = info.history.filter((v) => {
        const nome = (v.value ?? "").trim();
        const ts = new Date(v.timestamp);
        if (!nome || Number.isNaN(ts.getTime())) {
          eventiScartati += 1;
          return false;
        }
        return true;
      });

      // La chiave primaria e' (contact_id, campagna, ts): due voci con stessa
      // campagna e stesso istante collasserebbero in una riga sola.
      const chiavi = new Set(validi.map((v) => `${v.value.trim()}|${new Date(v.timestamp).getTime()}`));
      duplicatiScartatiDallaChiave += validi.length - chiavi.size;

      eventiPerContatto.push(validi.length);
      if (!validi.length) contattiSenzaEventiUtili += 1;

      for (const v of validi) {
        const nome = v.value.trim();
        campagne.set(nome, (campagne.get(nome) ?? 0) + 1);
        const t = new Date(v.timestamp).getTime();
        if (t < piuVecchio) piuVecchio = t;
        if (t > piuRecente) piuRecente = t;
        const anno = new Date(t).getUTCFullYear();
        eventiPerAnno.set(anno, (eventiPerAnno.get(anno) ?? 0) + 1);
      }
    }

    if (contatti >= limite) break;
    tRicercaInizio = Date.now();
  }

  const durata = Date.now() - iniziato;
  const totaleEventi = eventiPerContatto.reduce((a, b) => a + b, 0);
  const ordinati = [...eventiPerContatto].sort((a, b) => a - b);
  const media = contatti ? totaleEventi / contatti : 0;

  const alTetto = eventiPerContatto.filter((n) => n >= TETTO_REVISIONI_HUBSPOT).length;
  const vicinoAlTetto = eventiPerContatto.filter((n) => n >= TETTO_REVISIONI_HUBSPOT - 5).length;

  const nomiLunghezze = Array.from(campagne.keys()).map((n) => n.length);
  const lunghezzaMedia = nomiLunghezze.length
    ? nomiLunghezze.reduce((a, b) => a + b, 0) / nomiLunghezze.length
    : 0;

  console.log("=".repeat(64));
  console.log("  CAMPIONE");
  console.log("=".repeat(64));
  console.log(riga("Contatti analizzati", contatti.toLocaleString("it-IT")));
  console.log(riga("Eventi di conversione trovati", totaleEventi.toLocaleString("it-IT")));
  console.log(riga("Contatti senza eventi utili", `${contattiSenzaEventiUtili} (${((contattiSenzaEventiUtili / Math.max(1, contatti)) * 100).toFixed(1)}%)`));
  console.log(riga("Contatti con fusioni (merge)", `${contattiConMerge} (${((contattiConMerge / Math.max(1, contatti)) * 100).toFixed(1)}%)`));

  console.log("\n" + "=".repeat(64));
  console.log("  CONVERSIONI PER CONTATTO");
  console.log("=".repeat(64));
  console.log(riga("Media", media.toFixed(2)));
  console.log(riga("Mediana", percentile(ordinati, 50)));
  console.log(riga("90esimo percentile", percentile(ordinati, 90)));
  console.log(riga("99esimo percentile", percentile(ordinati, 99)));
  console.log(riga("Massimo osservato", ordinati[ordinati.length - 1] ?? 0));

  console.log("\n" + "=".repeat(64));
  console.log(`  TETTO HUBSPOT (${TETTO_REVISIONI_HUBSPOT} REVISIONI PER PROPRIETA')`);
  console.log("=".repeat(64));
  console.log(riga(`Contatti a >= ${TETTO_REVISIONI_HUBSPOT} eventi`, `${alTetto} (${((alTetto / Math.max(1, contatti)) * 100).toFixed(2)}%)`));
  console.log(riga(`Contatti a >= ${TETTO_REVISIONI_HUBSPOT - 5} eventi`, `${vicinoAlTetto} (${((vicinoAlTetto / Math.max(1, contatti)) * 100).toFixed(2)}%)`));
  if (alTetto > 0) {
    console.log("\n  >> Alcuni contatti sono AL TETTO: per loro HubSpot ha gia' cancellato");
    console.log("     le conversioni piu' vecchie, che nessuna scansione potra' recuperare.");
    console.log("     Ogni nuova conversione ne espelle definitivamente una vecchia:");
    console.log("     e' un argomento per NON rimandare il bootstrap di mesi.");
  } else {
    console.log("\n  >> Nessun contatto del campione e' al tetto: lo storico che leggiamo");
    console.log("     e' completo, non troncato da HubSpot.");
  }

  console.log("\n" + "=".repeat(64));
  console.log("  PROFONDITA' DELLO STORICO");
  console.log("=".repeat(64));
  if (piuRecente) {
    const dal = new Date(piuVecchio).toISOString().slice(0, 10);
    const al = new Date(piuRecente).toISOString().slice(0, 10);
    const mesi = (piuRecente - piuVecchio) / (1000 * 60 * 60 * 24 * 30.44);
    console.log(riga("Evento piu' vecchio", dal));
    console.log(riga("Evento piu' recente", al));
    console.log(riga("Arco temporale coperto", `${mesi.toFixed(1)} mesi`));
    console.log("\n  Eventi per anno:");
    for (const anno of Array.from(eventiPerAnno.keys()).sort()) {
      const n = eventiPerAnno.get(anno) ?? 0;
      const barra = "#".repeat(Math.max(1, Math.round((n / totaleEventi) * 40)));
      console.log(`    ${anno}  ${String(n).padStart(6)}  ${barra}`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log("  CAMPAGNE");
  console.log("=".repeat(64));
  console.log(riga("Campagne distinte nel campione", campagne.size.toLocaleString("it-IT")));
  console.log(riga("Lunghezza media del nome", `${lunghezzaMedia.toFixed(1)} caratteri`));
  console.log(riga("Lunghezza massima", `${Math.max(0, ...nomiLunghezze)} caratteri`));
  console.log("\n  Le 5 piu' frequenti:");
  for (const [nome, n] of Array.from(campagne.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`    ${String(n).padStart(5)}x  ${nome}`);
  }

  console.log("\n" + "=".repeat(64));
  console.log("  QUALITA' DEI DATI");
  console.log("=".repeat(64));
  console.log(riga("Voci scartate (vuote o data invalida)", eventiScartati));
  console.log(riga("Duplicati che la chiave unira'", duplicatiScartatiDallaChiave));
  if (duplicatiScartatiDallaChiave > 0) {
    console.log("\n  >> Esistono voci con stessa campagna e stesso istante: la chiave");
    console.log("     primaria ne terra' una sola. Atteso e innocuo per i conteggi,");
    console.log("     ma spiega perche' le righe salvate saranno leggermente meno");
    console.log("     degli eventi letti da HubSpot.");
  }

  console.log("\n" + "=".repeat(64));
  console.log("  IMPATTO SU HUBSPOT");
  console.log("=".repeat(64));
  const reqAlSecondo = statistiche.richieste / Math.max(1, durata / 1000);
  console.log(riga("Richieste effettuate", statistiche.richieste));
  console.log(riga("Richieste al secondo", `${reqAlSecondo.toFixed(2)} (limite burst: 19/s)`));
  console.log(riga("Risposte 429 (rate limit)", statistiche.risposte429));
  console.log(riga("Tempo perso in attesa", `${(statistiche.msTotaliAttesa / 1000).toFixed(1)}s`));
  console.log(riga("Latenza media ricerca", `${blocchi ? Math.round(msRicerca / blocchi) : 0} ms`));
  console.log(riga("Latenza media lettura storico", `${blocchi ? Math.round(msLettura / blocchi) : 0} ms`));
  if (statistiche.risposte429 === 0) {
    console.log("\n  >> Nessun rate limit incontrato: il portale regge questo ritmo senza sforzo.");
  }

  console.log("\n" + "=".repeat(64));
  console.log(`  PROIEZIONE SU ${CONTATTI_STIMATI.toLocaleString("it-IT")} CONTATTI`);
  console.log("=".repeat(64));
  const righeStimate = CONTATTI_STIMATI * media;
  const mbStimati = (righeStimate * BYTE_PER_RIGA) / 1_000_000;
  const durataStimata = (durata / Math.max(1, contatti)) * CONTATTI_STIMATI;
  console.log(riga("Righe attese in eventi_conversione", `~${Math.round(righeStimate).toLocaleString("it-IT")}`));
  console.log(riga("Spazio su Postgres", `~${Math.round(mbStimati)} MB (piano gratuito: 500 MB)`));
  console.log(riga("Durata del bootstrap", `~${hhmmss(durataStimata)}`));
  console.log(riga("Chiamate HubSpot totali", `~${Math.round((statistiche.richieste / Math.max(1, contatti)) * CONTATTI_STIMATI).toLocaleString("it-IT")} (limite: 625.000/giorno)`));

  console.log("");
  if (daId === 0) {
    console.log("  NOTA: campione preso dagli id piu' bassi, cioe' dai contatti piu'");
    console.log("  VECCHI del portale, che hanno avuto piu' tempo per convertire. La media");
    console.log("  potrebbe essere piu' alta del vero (stima prudente sullo spazio).");
    console.log("  Per un secondo campione da una zona diversa: --da-id <un id piu' alto>");
    console.log("");
  }
  if (mbStimati > 400) {
    console.log("  ATTENZIONE: stima oltre il margine di sicurezza del piano gratuito.");
    console.log("  Rivedere schema o piano PRIMA di creare l'account e lanciare il bootstrap.");
  } else {
    console.log("  Il piano gratuito Neon (500 MB) e' sufficiente: si puo' procedere");
    console.log("  con la creazione dell'account e poi con il bootstrap.");
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[analisi] fallita:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
