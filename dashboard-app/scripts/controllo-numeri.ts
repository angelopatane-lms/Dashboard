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
import { controllaNumeri, messaggio, ieriRoma } from "../src/lib/controlli/numeri";

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

  const anomalie = await controllaNumeri(process.env.HUBSPOT_PRIVATE_APP_TOKEN);

  console.log(`Controllo del ${ieriRoma()}: ${anomalie.length} anomalie`);
  for (const a of anomalie) console.log(`   [${a.gravita}] ${a.codice}: ${a.testo}`);

  if (!anomalie.length && !prova) {
    console.log("Niente da segnalare: non mando nessun messaggio.");
    return;
  }
  if (muto) {
    console.log("(--muto: non mando niente)");
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN || dalBot("SLACK_BOT_TOKEN");
  const a = process.env.CONTROLLO_AVVISI_A || dalBot("RESPONSABILE_SLACK_ID");
  if (!token || !a) {
    console.error(
      "Manca il token Slack o il destinatario: cercati nelle variabili della Dashboard e nel .env del bot."
    );
    process.exitCode = 1;
    return;
  }
  const testo = anomalie.length
    ? messaggio(anomalie)
    : `:white_check_mark: Controllo numeri del ${ieriRoma()}: nessuna anomalia. (messaggio di prova)`;
  const ok = await mandaSlack(testo, token, a);
  console.log(ok ? `Avviso mandato a ${a}.` : "Avviso NON mandato.");
})().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error("ERRORE:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
