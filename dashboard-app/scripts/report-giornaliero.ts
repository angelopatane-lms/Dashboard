/**
 * Il report del giorno prima, su Slack, ogni mattina alle 8.
 *
 * COME SI LANCIA
 *   npx tsx scripts/report-giornaliero.ts              calcola e manda
 *   npx tsx scripts/report-giornaliero.ts --muto       calcola e stampa, non manda
 *   npx tsx scripts/report-giornaliero.ts --giorno 2026-10-02    un giorno a scelta
 *
 * GIRA IN LOCALE accanto al controllo delle 7:30, e ne condivide il prezzo: se
 * il computer e' spento il report non parte. A differenza del controllo, pero',
 * qui il silenzio si nota - il report non arriva e lo si vede subito - mentre
 * un controllo che non parte sembra una giornata senza anomalie.
 *
 * IL TOKEN SI PRENDE DAL BOT AZIMUTH, come il controllo: una chiave in due
 * posti e' una chiave che prima o poi diverge.
 */
import "./env";
import fs from "fs";
import path from "path";
import { messaggio, reportDelGiorno, ieriRoma } from "../src/lib/report/giornaliero";
import { operatoriDelTeam } from "../src/lib/operatoriTeam";

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
  if (!d.ok) {
    console.error(`Slack ha rifiutato: ${d.error}`);
    // NOT_IN_CHANNEL SI SPIEGA, perche' e' l'errore che capita davvero: un
    // canale privato non si apre da solo al bot, e il messaggio sparisce senza
    // che nessuno se ne accorga.
    if (d.error === "not_in_channel") {
      console.error("   il bot non e' nel canale: da Slack, /invite @Azimuth");
    }
  }
  return Boolean(d.ok);
}

(async () => {
  const muto = process.argv.includes("--muto");
  const i = process.argv.indexOf("--giorno");
  const data = i >= 0 ? process.argv[i + 1] : ieriRoma();

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.error("HUBSPOT_PRIVATE_APP_TOKEN non impostata");
    process.exit(1);
  }

  // I SOTTO-TEAM SERVONO A DIVIDERE SETTER E CHATTER. Se il foglio non
  // risponde, il report esce lo stesso con tutti i fissati sotto "setter": un
  // numero un po' grosso e' meglio di nessun report.
  const team = await operatoriDelTeam("Setter").catch(() => null);
  if (!team) console.error("[report] elenco Setter non letto: chatter e setter non saranno divisi");

  const r = await reportDelGiorno({
    token,
    data,
    sottoTeam: team?.sottoTeam,
    bigliettiBase: Number(process.env.REPORT_BIGLIETTI_BASE) || undefined,
    bigliettiBaseAl: process.env.REPORT_BIGLIETTI_BASE_AL || undefined
  });

  const testo = messaggio(r);
  console.log(testo);

  if (muto) {
    console.log("\n[--muto] non mandato.");
    return;
  }

  const slack = process.env.SLACK_BOT_TOKEN || dalBot("SLACK_BOT_TOKEN");
  const a = process.env.REPORT_SLACK_A || dalBot("RESPONSABILE_SLACK_ID");
  if (!slack || !a) {
    console.error("\nToken Slack o destinatario mancanti: non mandato.");
    process.exit(1);
  }
  const ok = await mandaSlack(testo, slack, a);
  console.log(ok ? "\nMandato." : "\nNON mandato.");
  if (!ok) process.exit(1);
})().catch((e) => {
  console.error("ERRORE:", e instanceof Error ? e.message : e);
  process.exit(1);
});
