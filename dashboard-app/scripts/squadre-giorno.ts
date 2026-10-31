/**
 * I numeri delle squadre, scritti su file nella cartella Squadre.
 *
 * COME SI LANCIA
 *   npx tsx scripts/squadre-giorno.ts                 gli ultimi 30 giorni
 *   npx tsx scripts/squadre-giorno.ts --giorni 90     una finestra piu' larga
 *   npx tsx scripts/squadre-giorno.ts --da 2026-09-01 --a 2026-09-30
 *   npx tsx scripts/squadre-giorno.ts --muto          calcola e stampa, non scrive
 *
 * A COSA SERVE ANCORA, ora che il cron di Vercel fa lo stesso giro da solo:
 * a guardare i numeri senza toccare il sito, a riempire una finestra vecchia
 * (`--da`/`--a`) che il cron non ricalcola piu', e a rimettere in piedi lo
 * storico se il magazzino di Vercel si svuota.
 *
 * IL CALCOLO NON STA QUI. Sta in `src/lib/squadre/finestra.ts`, lo stesso che
 * usa la rotta `/api/squadre/giorni`: due copie vorrebbero dire due
 * definizioni di "chiusura" che prima o poi divergono. Qui restano solo gli
 * argomenti della riga di comando e i file.
 *
 * COSA PRODUCE. Un file per giorno in `Squadre/dati/giorni/` e un unico
 * `Squadre/dati/storico.json`. I file dei singoli giorni non servono a
 * nessuno che legga le pagine: servono a poter guardare, fra sei mesi, cosa
 * diceva un certo giorno senza aprire il file grosso.
 */
import "./env";
import fs from "fs";
import path from "path";
import { ieriRoma } from "../src/lib/report/giornaliero";
import { calcolaFinestra, fondi, piuGiorni, type Storico } from "../src/lib/squadre/finestra";

const CARTELLA = path.join("C:", "Users", "Angelo", "Desktop", "Windserf", "Squadre");
const DATI = path.join(CARTELLA, "dati");

(async () => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.error("HUBSPOT_PRIVATE_APP_TOKEN non impostata");
    process.exit(1);
  }
  const muto = process.argv.includes("--muto");
  const arg = (nome: string) => {
    const i = process.argv.indexOf(nome);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const a = arg("--a") ?? ieriRoma();
  const quanti = Number(arg("--giorni") ?? 30);
  const da = arg("--da") ?? piuGiorni(a, -(quanti - 1));

  const uscita = await calcolaFinestra(token, da, a, (riga) => console.log(riga));
  const giorni = Object.keys(uscita.giorni).sort();

  if (muto) {
    for (const g of giorni) {
      const righe = Object.entries(uscita.giorni[g] ?? {});
      if (!righe.length) continue;
      console.log(`\n${g}`);
      for (const [id, v] of righe) {
        console.log(
          `   ${(uscita.nomi[id] ?? id).padEnd(24)} fiss ${String(v.fissati).padStart(3)}  prog ${String(v.inProgramma).padStart(3)}  svolti ${String(v.svolti).padStart(3)}  noshow ${String(v.noShow).padStart(3)}  chius ${String(v.chiusure).padStart(2)}  vend ${v.venduto.toFixed(0).padStart(7)}${v.storni ? `  STORNI ${v.storni}` : ""}`
        );
      }
    }
    process.exit(0);
  }

  fs.mkdirSync(path.join(DATI, "giorni"), { recursive: true });
  for (const g of giorni) {
    fs.writeFileSync(
      path.join(DATI, "giorni", `${g}.json`),
      JSON.stringify({ giorno: g, persone: uscita.giorni[g] ?? {} }, null, 1),
      "utf8"
    );
  }

  const dove = path.join(DATI, "storico.json");
  let vecchio: Partial<Storico> = {};
  try {
    vecchio = JSON.parse(fs.readFileSync(dove, "utf8"));
  } catch {
    /* primo giro */
  }
  const fuso = fondi(vecchio, uscita);
  fs.writeFileSync(dove, JSON.stringify(fuso), "utf8");

  const quante = Object.keys(fuso.giorni).length;
  const peso = (fs.statSync(dove).size / 1024).toFixed(0);
  console.log(`\nscritto: ${dove}`);
  console.log(`storico: ${quante} giorni, ${peso} KB, da ${fuso.primoGiorno} a ${fuso.ultimoGiorno}`);
  process.exit(0);
})().catch((e) => {
  console.error("ERRORE:", e instanceof Error ? e.message : e);
  process.exit(1);
});
