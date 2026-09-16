import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { leggiVariante } from "@/lib/campagne";
import { costruisciQuery } from "@/lib/queryConversioni";

/**
 * NESSUNA RISPOSTA MEMORIZZATA.
 *
 * Next.js conserva le risposte delle chiamate in uscita in .next/cache e le
 * riusa. Su dati di un CRM che cambia in continuazione questo significa
 * mostrare il passato senza dirlo: misurato il 16 settembre, il proprietario di
 * una trattativa cambiato alle 06:24 continuava a risultare quello vecchio
 * venticinque minuti dopo, in locale e in produzione, e la card dell'agenda
 * restava nella colonna della persona sbagliata. La stessa richiesta fatta da
 * uno script fuori da Next dava subito il valore nuovo, e svuotando la cache la
 * rotta si allineava all-istante.
 *
 * Non scade in modo prevedibile e non lascia traccia: l-unico segnale era
 * hs_lastmodifieddate fermo al giorno prima dentro la risposta. Meglio pagare
 * ogni volta la chiamata che servire un dato vecchio senza accorgersene.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export type CampaignConversionRow = {
  campagna: string;
  /** Persone distinte che hanno convertito su questa campagna nel periodo.
   *  Due iscrizioni alla stessa campagna valgono 1; tre campagne diverse
   *  valgono 1 ciascuna. */
  lead_generati: number;
  /** Lead NUOVI: persone la cui prima conversione in assoluto cade nel periodo.
   *  Il valore e' stabile nel tempo e somma esattamente fra campagne. */
  lead_unici: number;
  /** Lead Generati dell'INTERA campagna, gruppi instant e non instant messi
   *  insieme. Nelle viste per segmento coincide col totale di cui lead_generati
   *  e' una parte, e serve al client per ripartire la spesa in proporzione: il
   *  foglio Ads conosce la campagna, non i suoi gruppi. Nelle altre viste e'
   *  uguale a lead_generati. */
  lead_generati_campagna: number | null;
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const variante = leggiVariante(searchParams.get("variante"));
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  try {
    const db = getDb();
    const { rows } = await db.query<CampaignConversionRow>(costruisciQuery(variante), [from, to]);

    const {
      rows: [ultimo]
    } = await db.query<{ finito_at: string | null }>(
      `SELECT finito_at FROM sync_log WHERE esito = 'ok' ORDER BY finito_at DESC LIMIT 1`
    );

    return NextResponse.json(
      { righe: rows, aggiornato_al: ultimo?.finito_at ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[campaign-conversions]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}