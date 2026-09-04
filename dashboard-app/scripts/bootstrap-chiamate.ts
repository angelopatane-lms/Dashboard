// Popola la tabella `chiamata` con le telefonate da gennaio 2026, ognuna
// attribuita alla campagna che il contatto aveva al momento della chiamata.
//
// Da gennaio 2026 e non da inizio storico perche' la spesa Ads parte da li':
// prima di allora CPL e costi derivati sarebbero comunque vuoti.
//
// RIPRENDIBILE: l'avanzamento e' salvato a ogni blocco. Se si interrompe basta
// rilanciare lo stesso comando.
//
// Uso: npm run bootstrap:chiamate
//      npm run bootstrap:chiamate -- --da 2026-06-01

import { richiedi } from "./env";
import { sincronizzaChiamate } from "../src/lib/chiamate/sync";

const ATTESE = 216_000; // stima, per la percentuale di avanzamento

function hhmmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
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

  console.log(`[chiamate] sincronizzazione delle chiamate dal ${daIso}.`);
  console.log("[chiamate] interrompibile in sicurezza: rilanciando riprende dall'ultimo blocco.\n");

  const iniziato = Date.now();
  let ultimaStampa = 0;

  const esito = await sincronizzaChiamate(token, "bootstrap", {
    daIso,
    onProgresso: (s) => {
      const ora = Date.now();
      if (ora - ultimaStampa < 15_000) return;
      ultimaStampa = ora;
      const pct = Math.min(100, (s.chiamate / ATTESE) * 100);
      const restanti = s.chiamate > 0 ? ((ora - iniziato) / s.chiamate) * (ATTESE - s.chiamate) : 0;
      console.log(
        `[chiamate] ${s.chiamate.toLocaleString("it-IT")} (${pct.toFixed(0)}%), ` +
          `${s.connesse.toLocaleString("it-IT")} connesse - ` +
          `${hhmmss(ora - iniziato)} trascorsi, ~${hhmmss(restanti)} rimasti`
      );
    }
  });

  const durata = Date.now() - iniziato;
  const pc = (n: number) => `${((n / Math.max(1, esito.chiamate)) * 100).toFixed(1)}%`;

  console.log(`\n[chiamate] completato in ${hhmmss(durata)}`);
  console.log(`  Chiamate salvate    : ${esito.chiamate.toLocaleString("it-IT")}`);
  console.log(`  Di cui connesse     : ${esito.connesse.toLocaleString("it-IT")} (${pc(esito.connesse)})`);
  console.log(`  Senza contatto      : ${esito.senzaContatto.toLocaleString("it-IT")} (${pc(esito.senzaContatto)})`);
  console.log(`  Senza campagna      : ${esito.senzaCampagna.toLocaleString("it-IT")} (${pc(esito.senzaCampagna)})`);
  console.log("\n  Le chiamate senza contatto o senza campagna restano fuori dalle righe");
  console.log("  per campagna: erano lo 0,5% nel campione di prova.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[chiamate] fallito:", err instanceof Error ? err.message : err);
    console.error("[chiamate] rilancia lo stesso comando per riprendere dall'ultimo blocco.");
    process.exit(1);
  });
