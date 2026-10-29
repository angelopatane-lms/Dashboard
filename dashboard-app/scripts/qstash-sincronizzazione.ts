/**
 * La pianificazione oraria della sincronizzazione, su QStash.
 *
 * COME SI LANCIA
 *   npx tsx scripts/qstash-sincronizzazione.ts            elenca e basta
 *   npx tsx scripts/qstash-sincronizzazione.ts --crea     crea o aggiorna la pianificazione
 *   npx tsx scripts/qstash-sincronizzazione.ts --prova    chiama subito l'endpoint, senza QStash
 *
 * PERCHE' QSTASH E NON GITHUB ACTIONS. La sincronizzazione delle conversioni
 * deve girare ogni ora. Su Vercel non si puo': il piano Hobby accetta solo cron
 * giornalieri. Si era quindi messa su GitHub Actions, che pero' i cron
 * schedulati li fa partire quando puo': misurato il 21 ottobre 2026 sui sette
 * giorni precedenti, 46 giri su 168 attesi (27%), intervallo medio 216 minuti
 * invece di 60, buco piu' lungo sette ore, e quaranta buchi sopra le due ore.
 * Alle 9 e alle 17 non e' partita mai in una settimana.
 *
 * Non si perdeva nessun dato - la finestra riparte dall'ultima esecuzione
 * RIUSCITA, e su Vercel resta un cron giornaliero di recupero - ma si perdeva
 * freschezza: fino a sette ore di ritardo sui lead e sulle conversioni che la
 * Dashboard mostra.
 *
 * QStash chiama un indirizzo su pianificazione, riprova da solo se la chiamata
 * fallisce, ed e' gia' nello stack: il bot Slack lo usa per il report delle
 * valutazioni. Ventiquattro chiamate al giorno stanno larghe nel piano
 * gratuito.
 *
 * LA CHIAVE NON CAMBIA. QStash inoltra alla destinazione le intestazioni che
 * gli si passano con il prefisso `Upstash-Forward-`: si manda l'Authorization
 * che la rotta gia' si aspetta, quindi non c'e' niente da cambiare nel codice
 * del cron. Un indirizzo che chiunque puo' chiamare resta protetto dalla stessa
 * chiave di prima.
 *
 * LE ALTRE DUE RETI RESTANO, e non e' ridondanza inutile: il cron giornaliero
 * su Vercel e la action oraria su GitHub costano zero e coprono il caso in cui
 * QStash abbia un disservizio. Chi arriva per primo sincronizza, gli altri
 * trovano poco o niente da fare perche' la finestra parte dall'ultimo giro
 * riuscito.
 */
import "./env";

/**
 * L'INDIRIZZO DIPENDE DALLA REGIONE, e non e' un dettaglio: l'account e' in EU
 * Region e risponde su qstash-eu-central-1. Chiamando l'indirizzo globale
 * (qstash.upstash.io) il token viene rifiutato con "invalid token", che fa
 * credere a una chiave sbagliata e manda a cercare nel posto sbagliato - e'
 * successo il 21 ottobre 2026, due token diversi e lo stesso 401. La console
 * lo scrive nel riquadro Quickstart, alla voce QSTASH_URL.
 */
const QSTASH =
  (process.env.QSTASH_URL || "https://qstash-eu-central-1.upstash.io").replace(/\/$/, "") + "/v2";
const NOME = "dashboard-sync-conversioni";
const ROTTA = "/api/cron/campaign-conversions-incremental";
const CRON = "0 * * * *";

const base = (process.env.DASHBOARD_URL || "https://dashboard-smoky-eight-94.vercel.app").replace(/\/$/, "");
const destinazione = base + ROTTA;

async function qstash(metodo: string, percorso: string, intestazioni: Record<string, string> = {}) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN non impostata: mettila in .env.local e rilancia");
  const r = await fetch(QSTASH + percorso, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...intestazioni }
  });
  const testo = await r.text();
  if (!r.ok) throw new Error(`QStash ${r.status}: ${testo.slice(0, 160)}`);
  try {
    return JSON.parse(testo);
  } catch {
    return testo;
  }
}

const quando = (ms?: number) =>
  ms
    ? new Intl.DateTimeFormat("it-IT", {
        timeZone: "Europe/Rome",
        dateStyle: "short",
        timeStyle: "short"
      }).format(new Date(ms))
    : "-";

async function elenca() {
  const lista = (await qstash("GET", "/schedules")) as Array<{
    scheduleId: string;
    cron: string;
    destination: string;
    isPaused?: boolean;
    lastScheduleTime?: number;
    nextScheduleTime?: number;
  }>;
  if (!lista.length) {
    console.log("  nessuna pianificazione su questo account QStash");
    return lista;
  }
  for (const s of lista) {
    console.log(`  ${s.scheduleId}`);
    console.log(`      cron ${s.cron}   ${s.isPaused ? "IN PAUSA" : "attiva"}`);
    console.log(`      destinazione  ${s.destination}`);
    console.log(`      ultima ${quando(s.lastScheduleTime)}   prossima ${quando(s.nextScheduleTime)}`);
  }
  return lista;
}

(async () => {
  const argomenti = process.argv.slice(2);

  if (argomenti.includes("--prova")) {
    // SENZA QSTASH: serve a sapere se la rotta risponde, prima di programmarla.
    const segreto = process.env.CRON_SECRET;
    if (!segreto) throw new Error("CRON_SECRET non impostata");
    const r = await fetch(destinazione, { headers: { Authorization: `Bearer ${segreto}` } });
    console.log(`prova diretta: HTTP ${r.status}`);
    console.log((await r.text()).slice(0, 300));
    return;
  }

  console.log(`\nPIANIFICAZIONI SU QSTASH\n`);
  const prima = await elenca();

  if (!argomenti.includes("--crea")) {
    console.log("\n(sola lettura. Per creare o aggiornare: --crea)");
    return;
  }

  const segreto = process.env.CRON_SECRET;
  if (!segreto) throw new Error("CRON_SECRET non impostata: serve a far passare la rotta");

  // SI CANCELLA LA VECCHIA PRIMA DI RIFARLA: QStash non aggiorna una
  // pianificazione esistente, ne creerebbe una seconda sullo stesso indirizzo e
  // la sincronizzazione partirebbe due volte all'ora.
  for (const s of prima) {
    if (s.destination === destinazione || s.scheduleId === NOME) {
      await qstash("DELETE", `/schedules/${encodeURIComponent(s.scheduleId)}`);
      console.log(`\n  rimossa la pianificazione precedente ${s.scheduleId}`);
    }
  }

  // L'INDIRIZZO VA IN CHIARO NEL PERCORSO, non codificato: con
  // encodeURIComponent "https://" diventa "https%3A%2F%2F" e QStash risponde
  // "endpoint has invalid scheme, add http:// or https://".
  const esito = (await qstash("POST", `/schedules/${destinazione}`, {
    "Upstash-Cron": CRON,
    "Upstash-Schedule-Id": NOME,
    // IL METODO VA DETTO, perche' QStash chiama in POST se non lo si dice e la
    // rotta espone solo GET. Dal 21 ottobre al 29 ottobre 2026 ogni giro ha
    // risposto 405: QStash riprovava tre volte, poi marcava FAILED, e da
    // questa parte non si vedeva niente - nessun errore nei nostri log,
    // perche' la rotta non veniva nemmeno eseguita. La freschezza oraria in
    // quei nove giorni l'hanno retta solo GitHub Actions (che parte un giro su
    // quattro) e il cron giornaliero di Vercel. Si scopre dagli eventi di
    // QStash, non da qui: vale la pena guardarli dopo ogni modifica.
    "Upstash-Method": "GET",
    // L'intestazione che la rotta si aspetta, inoltrata da QStash alla
    // destinazione. Il valore non compare da nessuna parte nei registri.
    "Upstash-Forward-Authorization": `Bearer ${segreto}`,
    "Upstash-Retries": "3"
  })) as { scheduleId?: string };

  console.log(`\n  creata: ${esito.scheduleId ?? NOME}   cron ${CRON}`);
  console.log("\nCOM'E' ADESSO:\n");
  await elenca();
})().catch((e) => {
  console.error("ERRORE:", e instanceof Error ? e.message : e);
  process.exit(1);
});
