/**
 * Il controllo quotidiano dei numeri, con avviso su Slack solo se c'e' qualcosa.
 *
 * COME SI LANCIA
 *   npx tsx scripts/controllo-numeri.ts            controlla e avvisa se serve
 *   npx tsx scripts/controllo-numeri.ts --muto     controlla e stampa, non manda
 *   npx tsx scripts/controllo-numeri.ts --prova    manda comunque, anche se tutto ok
 *
 * GIRA IN LOCALE, non su Vercel, ed e' una scelta con un prezzo: se il computer
 * e' spento alle 7:30 il controllo non parte, e un controllo che non parte e'
 * esattamente il genere di silenzio che questo script esiste per scoprire. Se un
 * giorno diventa importante, si sposta su un cron di Vercel: serve solo mettere
 * SLACK_BOT_TOKEN fra le variabili del progetto.
 *
 * IL TOKEN SI PRENDE DAL BOT AZIMUTH. La Dashboard non ha nessuna configurazione
 * Slack, il bot si'. Si legge il suo .env invece di copiare il valore altrove:
 * una chiave in due posti e' una chiave che prima o poi diverge, e la copia
 * vecchia continua a funzionare finche' non viene revocata.
 */
import "./env";
import fs from "fs";
import path from "path";
import { controlloDelGiorno, ieriRoma } from "../src/lib/controlli/numeri";

const BOT = path.join("C:", "Users", "Angelo", "Desktop", "Windserf", "Bot Slack", ".env");

/** Legge una variabile dal .env del bot, senza stamparla mai. */
function dalBot(nome: string): string {
  try {
    const riga = fs
      .readFileSync(BOT, "utf8")
      .split(/\r?\n/)
      .find((r) => r.startsWith(`${nome}=`));
    return riga ? riga.slice(nome.length + 1).trim().replace(/^['"]|['"]$/g, "") : "";
  } catch {
    return "";
  }
}

async function mandaSlack(testo: string, token: string, a: string): Promise<boolean> {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: a, text: testo })
  });
  const d = (await r.json()) as { ok?: boolean; error?: string };
  if (!d.ok) console.error(`Slack ha rifiutato: ${d.error}`);
  return Boolean(d.ok);
}

(async () => {
  const muto = process.argv.includes("--muto");
  const prova = process.argv.includes("--prova");

  const token = process.env.SLACK_BOT_TOKEN || dalBot("SLACK_BOT_TOKEN");
  const a = process.env.CONTROLLO_AVVISI_A || dalBot("RESPONSABILE_SLACK_ID");

  const esito = await controlloDelGiorno({
    tokenHubspot: process.env.HUBSPOT_PRIVATE_APP_TOKEN,
    da: "computer",
    // Con --prova o --muto non si scrive la riga del giorno: le prove non
    // devono impedire al controllo vero di girare qualche minuto dopo.
    comunque: prova || muto,
    manda: async (testo) => {
      if (muto) {
        console.log("(--muto: non mando niente)");
        return false;
      }
      if (!token || !a) {
        console.error("Manca il token Slack o il destinatario (Dashboard o .env del bot).");
        process.exitCode = 1;
        return false;
      }
      return await mandaSlack(testo, token, a);
    }
  });

  if (esito.saltato) {
    console.log("Il controllo di oggi e' gia' stato fatto da un altro: non rifaccio niente.");
    return;
  }
  console.log(`Controllo del ${ieriRoma()}: ${esito.anomalie.length} anomalie`);
  for (const x of esito.anomalie) console.log(`   [${x.gravita}] ${x.codice}: ${x.testo}`);
  if (!esito.anomalie.length) {
    console.log("Niente da segnalare: nessun messaggio mandato.");
  } else {
    console.log(esito.mandato ? `Avviso mandato a ${a}.` : "Avviso NON mandato.");
  }

  if (prova && !esito.anomalie.length && token && a) {
    await mandaSlack(
      `:white_check_mark: Controllo numeri del ${ieriRoma()}: nessuna anomalia. (prova)`,
      token,
      a
    );
    console.log("(prova: mandato il messaggio di conferma)");
  }
})().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error("ERRORE:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
