// Bootstrap una tantum: popola eventi_conversione con TUTTO lo storico
// pregresso (tutti i contatti con id_campagna_refresh popolata, nessun
// filtro aggiuntivo, per non perdere nessuna conversione storica).
//
// Va lanciato come script locale (non tramite Vercel): il volume di
// contatti da processare supera abbondantemente i limiti di timeout delle
// funzioni serverless. Una volta eseguito con successo, non va piu'
// ripetuto - il mantenimento successivo e' a carico dei cron (incrementale
// orario + full settimanale, che usano filtri molto piu' leggeri).
//
// RIPRENDIBILE: l'avanzamento e' salvato su sync_checkpoint a ogni blocco di
// 100 contatti, nella stessa transazione che scrive i dati. Se l'esecuzione
// si interrompe (rete, riavvio, chiusura del portatile), basta rilanciare lo
// stesso comando: riparte dall'ultimo blocco salvato, non da capo.
//
// USO
//   Prova:  npm run bootstrap:campaign-conversions -- --limite 500
//   Reale:  npm run bootstrap:campaign-conversions
//
// La prova gira su pochi contatti e stampa, misurandoli, quanto durera' la
// scansione completa e quanto spazio occupera'. Usa un tipo distinto
// ("prova"), quindi non tocca il checkpoint del bootstrap vero e non lo fa
// sembrare completato. I dati che scrive sono reali e verranno semplicemente
// riscritti dal bootstrap.
//
// (richiede DATABASE_URL e HUBSPOT_PRIVATE_APP_TOKEN in dashboard-app/.env.local)

import { richiedi } from "./env";
import { eseguiSync } from "../src/lib/campaignConversions/sync";

// Stima della popolazione da scansionare: contatti con id_campagna_refresh
// valorizzata. Serve solo a proiettare i numeri della prova sulla scansione
// completa; cambiala se il portale cresce sensibilmente.
const CONTATTI_STIMATI = 345_179;

// Costo per riga di eventi_conversione: heap + indici, come da commento in
// sql/campaign-conversions-schema.sql.
const BYTE_PER_RIGA = 135;

function hhmmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}

function leggiLimite(argv: string[]): number | undefined {
  const i = argv.indexOf("--limite");
  if (i === -1) return undefined;

  const grezzo = argv[i + 1];
  const n = Number(grezzo);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--limite richiede un intero positivo (ricevuto: ${grezzo ?? "niente"})`);
  }
  return n;
}

// Distingue un errore di avvio (argomenti, variabili d'ambiente) da un errore
// avvenuto a scansione gia' iniziata: solo nel secondo caso ha senso suggerire
// di riprendere, e solo se e' il bootstrap vero ad avere un checkpoint.
let statoEsecuzione: { etichetta: string; riprendibile: boolean } | null = null;

async function main() {
  const limite = leggiLimite(process.argv.slice(2));

  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  richiedi("DATABASE_URL");

  if (limite) {
    console.log(`[prova] scansione limitata a ${limite.toLocaleString("it-IT")} contatti.`);
    console.log("[prova] non intacca lo stato del bootstrap vero; serve a misurare durata e spazio.");
  } else {
    console.log("[bootstrap] avvio della scansione COMPLETA.");
    console.log("[bootstrap] interrompibile in sicurezza: rilanciando riprende dall'ultimo blocco.");
  }

  const etichetta = limite ? "prova" : "bootstrap";
  statoEsecuzione = { etichetta, riprendibile: !limite };
  const iniziato = Date.now();
  let ultimaStampa = 0;

  const risultato = await eseguiSync(limite ? "prova" : "bootstrap", token, {
    limite,
    onProgresso: ({ contatti, eventi, ultimoId }) => {
      // Una riga ogni 10 secondi: abbastanza per vedere che sta lavorando,
      // non tanto da riempire il terminale in una scansione di ore.
      const ora = Date.now();
      if (ora - ultimaStampa < 10_000) return;
      ultimaStampa = ora;
      console.log(
        `[${etichetta}] ${contatti.toLocaleString("it-IT")} contatti, ` +
          `${eventi.toLocaleString("it-IT")} eventi, ultimo id ${ultimoId} - ` +
          `${hhmmss(ora - iniziato)} trascorsi`
      );
    }
  });

  const durata = Date.now() - iniziato;
  console.log(
    `[${etichetta}] completato in ${hhmmss(durata)}: ` +
      `${risultato.contatti.toLocaleString("it-IT")} contatti, ` +
      `${risultato.eventi.toLocaleString("it-IT")} eventi` +
      (risultato.ripreso ? " (ripreso da un'esecuzione precedente)" : "")
  );

  if (!limite || risultato.contatti === 0) return;

  // Proiezione sulla scansione completa, misurata sul campione appena girato.
  const eventiPerContatto = risultato.eventi / risultato.contatti;
  const msPerContatto = durata / risultato.contatti;
  const righeStimate = CONTATTI_STIMATI * eventiPerContatto;
  const mbStimati = (righeStimate * BYTE_PER_RIGA) / 1_000_000;

  console.log("");
  console.log(`--- Proiezione su ${CONTATTI_STIMATI.toLocaleString("it-IT")} contatti ---`);
  console.log(`  Conversioni per contatto : ${eventiPerContatto.toFixed(2)} in media`);
  console.log(`  Righe totali attese      : ~${Math.round(righeStimate).toLocaleString("it-IT")}`);
  console.log(`  Spazio su Postgres       : ~${Math.round(mbStimati)} MB su 500 disponibili`);
  console.log(`  Durata del bootstrap     : ~${hhmmss(msPerContatto * CONTATTI_STIMATI)}`);
  // La prova parte sempre dagli id piu' bassi, cioe' dai contatti piu' VECCHI
  // del portale: avendo avuto anni per convertire hanno molti piu' eventi della
  // media, quindi questa proiezione e' sistematicamente per eccesso. La stima
  // corretta e' quella di `npm run stima:dimensione`, che campiona in modo
  // stratificato su tutta la popolazione.
  console.log("  NOTA: proiezione per ECCESSO (il campione parte dai contatti piu' vecchi).");
  console.log("  La stima attendibile e' quella di:  npm run stima:dimensione");
  console.log("");

  if (mbStimati > 400) {
    console.log("  ATTENZIONE: stima vicina o oltre il limite del piano gratuito (500 MB).");
    console.log("  Meglio rivedere lo schema o il piano PRIMA di lanciare la scansione completa.");
  } else {
    console.log("  Spazio sufficiente: si puo' procedere con la scansione completa.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const etichetta = statoEsecuzione?.etichetta ?? "avvio";
    console.error(`[${etichetta}] fallito:`, err instanceof Error ? err.message : err);
    if (statoEsecuzione?.riprendibile) {
      console.error(`[${etichetta}] rilancia lo stesso comando per riprendere dall'ultimo blocco salvato.`);
    }
    process.exit(1);
  });
