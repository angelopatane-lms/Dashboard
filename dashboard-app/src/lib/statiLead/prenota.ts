/**
 * La prenotazione del giro di scarico degli Stati Lead.
 *
 * IL PROBLEMA CHE RISOLVE. Il database si paga a ORE DI ACCENSIONE, e si
 * riaddormenta dopo cinque minuti di silenzio: una sola scrittura costa quindi
 * cinque minuti di sveglia, e il webhook degli Stati Lead ne faceva una a ogni
 * cambio di stato - centinaia di volte al giorno, sparse su tutta la giornata
 * lavorativa. Misurato: 7,5 ore di accensione al giorno per il solo webhook,
 * circa 57 CU-ore al mese su 100 incluse. Il 29 ottobre 2026 la quota e'
 * finita e Neon ha sospeso il progetto.
 *
 * COME. Il webhook non scrive piu' niente: PRENOTA un giro di scarico alla
 * fine del quarto d'ora in corso. Le prenotazioni dello stesso quarto d'ora
 * sono UNA SOLA grazie all'identificativo di deduplicazione di QStash, quindi
 * trecento cambi di stato in un pomeriggio diventano quattro risvegli l'ora
 * invece di trecento. Un quarto d'ora di ritardo, non un'ora come il cron.
 *
 * SULLA DEDUPLICAZIONE, che dura DIECI minuti mentre la finestra e' di
 * QUINDICI: gli eventi che arrivano negli ultimi cinque minuti del quarto
 * d'ora possono generare un secondo messaggio. Non costa niente - e' prenotato
 * per lo STESSO istante del primo, quindi cade nella stessa finestra di
 * accensione - e non fa danni, perche' la scrittura e' in aggiornamento
 * (ON CONFLICT DO UPDATE) e due giri sovrapposti scrivono lo stesso risultato.
 *
 * SE QSTASH NON RISPONDE non si perde niente: chi chiama ricade sul lavoro
 * diretto di prima. Meglio pagare qualche minuto di accensione che perdere un
 * appuntamento dalla tabella degli advisor telefonici.
 */

/** Ogni quanto si scarica. Quindici minuti: sotto, si risparmia poco (la
 *  sveglia minima e' cinque); sopra, la tabella degli advisor invecchia. */
export const MINUTI_FINESTRA = 15;

const QSTASH =
  (process.env.QSTASH_URL || "https://qstash-eu-central-1.upstash.io").replace(/\/$/, "") + "/v2";

/** L'indirizzo pubblico di questa Dashboard.
 *
 *  NON si usa VERCEL_URL: quello e' l'indirizzo del singolo rilascio e cambia
 *  a ogni pubblicazione, quindi una prenotazione fatta adesso potrebbe essere
 *  consegnata fra un quarto d'ora a un rilascio gia' sostituito. */
function base(): string {
  const scelto =
    process.env.DASHBOARD_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return scelto.replace(/\/$/, "");
}

/** La fine del quarto d'ora in corso, che e' l'istante della consegna. */
export function fineFinestra(adesso = new Date()): Date {
  const passo = MINUTI_FINESTRA * 60_000;
  return new Date(Math.ceil((adesso.getTime() + 1) / passo) * passo);
}

/**
 * Prenota il giro. Torna una descrizione di cosa e' successo, da mettere nel
 * log: chi chiama decide se ricadere sul lavoro diretto guardando `prenotato`.
 */
export async function prenotaScarico(
  adesso = new Date()
): Promise<{ prenotato: boolean; quando: string; dettaglio: string }> {
  const fine = fineFinestra(adesso);
  const quando = fine.toISOString();
  const token = process.env.QSTASH_TOKEN;
  const radice = base();

  if (!token) return { prenotato: false, quando, dettaglio: "QSTASH_TOKEN non impostata" };
  if (!radice) return { prenotato: false, quando, dettaglio: "DASHBOARD_URL non impostata" };
  if (!process.env.CRON_SECRET) return { prenotato: false, quando, dettaglio: "CRON_SECRET non impostata" };

  const destinazione = `${radice}/api/cron/stati-lead-flush`;
  const ritardo = Math.max(1, Math.round((fine.getTime() - adesso.getTime()) / 1000));

  try {
    const r = await fetch(`${QSTASH}/publish/${destinazione}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Upstash-Method": "GET",
        "Upstash-Delay": `${ritardo}s`,
        // Un identificativo per finestra: tutte le prenotazioni dello stesso
        // quarto d'ora sono lo stesso messaggio.
        // NIENTE DUE PUNTI nell'identificativo: QStash risponde
        // "DeduplicationId cannot contain ':'" e un orario ISO ne ha tre.
        // Si usa il numero di minuti dall'epoca, che e' la stessa finestra
        // detta in cifre. Provato il 29 ottobre 2026: con i due punti
        // rispondeva 400, e la prenotazione sarebbe ricaduta ogni volta sulla
        // scrittura diretta - cioe' nessun risparmio, in silenzio.
        "Upstash-Deduplication-Id": `stati-lead-${Math.floor(fine.getTime() / 60_000)}`,
        // QStash inoltra alla destinazione le intestazioni con questo prefisso:
        // la rotta resta protetta dalla chiave che gia' si aspetta.
        "Upstash-Forward-Authorization": `Bearer ${process.env.CRON_SECRET}`,
        "Upstash-Retries": "2"
      }
    });
    const testo = await r.text();
    if (!r.ok) return { prenotato: false, quando, dettaglio: `QStash ${r.status}: ${testo.slice(0, 160)}` };
    return { prenotato: true, quando, dettaglio: `fra ${ritardo}s (${testo.slice(0, 120)})` };
  } catch (e) {
    return { prenotato: false, quando, dettaglio: e instanceof Error ? e.message : String(e) };
  }
}
