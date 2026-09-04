// Popola la tabella `trattativa` con le trattative della pipeline
// "Appuntamenti (High Ticket)" e la data in cui ciascuna e' stata svolta.
//
// La data della consulenza si ricava dalla cronologia delle fasi applicando i
// criteri del workflow "Performance Tracker - Trattative Svolte", letti da
// HubSpot: vedi src/lib/trattative/sync.ts per il perche' non sia leggibile
// dallo stato attuale della trattativa.
//
// E' sicuro rilanciarlo: ogni trattativa viene riscritta per intero (upsert su
// deal_id), quindi due esecuzioni danno lo stesso risultato.
//
// Uso: npm run bootstrap:trattative
//      npm run bootstrap:trattative -- --da 2026-06-01

import { richiedi } from "./env";
import { sincronizzaTrattative } from "../src/lib/trattative/sync";

function hhmmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function leggiDa(argv: string[]): string {
  const i = argv.indexOf("--da");
  if (i === -1) return "2026-01-01";
  const v = argv[i + 1] ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--da richiede una data AAAA-MM-GG (ricevuto: ${v || "niente"})`);
  return v;
}

async function main() {
  const daIso = leggiDa(process.argv.slice(2));
  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  richiedi("DATABASE_URL");

  console.log(`[trattative] sincronizzazione dalle trattative create dal ${daIso}.`);
  console.log("[trattative] criteri di 'svolta' letti dal workflow su HubSpot.\n");

  const iniziato = Date.now();
  let ultimaStampa = 0;

  const esito = await sincronizzaTrattative(token, "bootstrap", {
    daIso,
    onProgresso: (s) => {
      const ora = Date.now();
      if (ora - ultimaStampa < 5000) return;
      ultimaStampa = ora;
      console.log(
        `[trattative] ${s.trattative.toLocaleString("it-IT")} trattative, ` +
          `${s.svolte.toLocaleString("it-IT")} svolte - ${hhmmss(ora - iniziato)}`
      );
    }
  });

  const durata = Date.now() - iniziato;
  console.log(`\n[trattative] completato in ${hhmmss(durata)}`);
  console.log(`  Trattative salvate      : ${esito.trattative.toLocaleString("it-IT")}`);
  console.log(
    `  Di cui svolte           : ${esito.svolte.toLocaleString("it-IT")}` +
      ` (${((esito.svolte / Math.max(1, esito.trattative)) * 100).toFixed(1)}%)`
  );
  console.log(`  Appuntamenti disertati  : ${esito.noShow.toLocaleString("it-IT")} (ingressi in No Show)`);
  console.log(
    `  Senza id_campagna_track : ${esito.senzaCampagna.toLocaleString("it-IT")}` +
      ` (${((esito.senzaCampagna / Math.max(1, esito.trattative)) * 100).toFixed(1)}%)`
  );
  if (esito.senzaCampagna > 0) {
    console.log("\n  Le trattative senza campagna restano salvate ma non compaiono");
    console.log("  nelle righe per campagna: il totale della tabella Campagne sara'");
    console.log("  quindi leggermente inferiore a quello della pagina Advisor.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[trattative] fallito:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
