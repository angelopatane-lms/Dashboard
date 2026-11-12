import { parseCsv } from "@/lib/csv";

/**
 * LE ASSEGNAZIONI, PRESE DALLA SCHEDA "TRACKING EVENTI".
 *
 * PERCHE' DAL FOGLIO E NON DA HUBSPOT. Su un contatto HubSpot tiene solo
 * l'ULTIMA assegnazione (`hubspot_owner_assigneddate`): la storia - chi ha
 * avuto quel lead prima, e quando - non esiste da nessuna parte nel CRM. Il
 * webhook degli eventi la scrive invece riga per riga in questa scheda, con
 * trigger "Proprietario contatto". E' l'unica fonte che ce l'ha.
 *
 * PERCHE' NON SI LEGGE A OGNI CALCOLO. La scheda e' il registro grezzo di
 * tutti gli eventi, non solo delle assegnazioni: al 12 novembre 2026 sono
 * 43.986 righe per 8,7 MB, e cresce di circa 3.000 righe al giorno. Scaricarla
 * a ogni apertura della pagina sarebbe decine di MB al giorno per leggere
 * sempre le stesse righe. E soprattutto PARTE DAL 29 OTTOBRE 2026: piu'
 * indietro non c'e' niente, e il giorno che qualcuno la ripulisse la storia
 * sparirebbe. Per questo il cron la travasa in `assegnazione_evento`, che e'
 * nostra e si accumula.
 *
 * IL FILTRO LO FA GOOGLE, non noi: la query gviz chiede solo le quattro
 * colonne che servono, solo il trigger giusto e solo i giorni nuovi. Un giro
 * notturno scarica cosi' 80 KB invece di 8,7 MB.
 *
 * IL TIMESTAMP E' ORA DI ROMA senza fuso, perche' lo scrive un Apps Script
 * sul fuso del foglio. Chi lo salva deve dichiararlo (`AT TIME ZONE
 * 'Europe/Rome'`), altrimenti Postgres lo prende per UTC e tutto slitta di
 * un'ora o due.
 */

const FOGLIO = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const SCHEDA = "Tracking Eventi";

export type AssegnazioneFoglio = {
  /** "2026-11-11 00:10:54", ora di Roma. */
  ts: string;
  contattoId: string;
  proprietarioId: string | null;
  nome: string;
  /**
   * Lo Stato Lead AL MOMENTO dell'assegnazione, ed e' la colonna che dice la
   * natura del gesto: i marketing manager assegnano i lead da chiamare
   * mettendo lo stato su "New" - anche quando il contatto era gia' di un
   * advisor. Un'assegnazione con un altro stato e' un'altra cosa: un
   * passaggio di mano, o un advisor che si riprende un cliente per
   * registrargli una rata o aggiornare le note.
   */
  statoLead: string;
  statoPrecedente: string;
};

/**
 * Le assegnazioni scritte dal giorno `dal` (compreso) in avanti.
 *
 * Il confronto sulle date e' fra TESTI, non fra date: nel foglio la colonna
 * Timestamp e' testo, e gviz non la saprebbe confrontare con una `datetime`.
 * Funziona perche' il formato e' ISO, che si ordina alfabeticamente come si
 * ordina nel tempo.
 */
export async function assegnazioniDalFoglio(dal: string): Promise<AssegnazioneFoglio[]> {
  const tq = `select A,E,G,H,K,L where B = 'Proprietario contatto' and A >= '${dal}'`;
  const url =
    `https://docs.google.com/spreadsheets/d/${FOGLIO}/gviz/tq` +
    `?tqx=out:csv&sheet=${encodeURIComponent(SCHEDA)}&tq=${encodeURIComponent(tq)}`;

  const r = await fetch(url, { cache: "no-store", headers: { accept: "text/csv" } });
  if (!r.ok) throw new Error(`la scheda Tracking Eventi non si legge: ${r.status}`);
  const righe = parseCsv(await r.text());

  const fuori: AssegnazioneFoglio[] = [];
  for (const c of righe) {
    const ts = (c["Timestamp"] ?? "").trim();
    const contattoId = (c["ID Contatto"] ?? "").trim();
    // Senza contatto o senza ora la riga non si puo' misurare: sono poche
    // (eventi scritti a mano, prove) e si scartano qui una volta per tutte.
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) || !/^\d+$/.test(contattoId)) continue;
    const prop = (c["ID Proprietario"] ?? "").trim();
    fuori.push({
      ts,
      contattoId,
      proprietarioId: /^\d+$/.test(prop) ? prop : null,
      nome: (c["Nome Proprietario"] ?? "").trim(),
      statoLead: (c["Stato Lead"] ?? "").trim(),
      statoPrecedente: (c["Stato Lead Precedente"] ?? "").trim()
    });
  }
  return fuori;
}
