import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  leggiVariante,
  SQL_JOIN_BASE,
  sqlFiltroCampagna,
  sqlNomeCampagna,
  varianteUnificaNomi,
  type Variante
} from "@/lib/campagne";

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

export type CampaignChiamateRow = {
  campagna: string;
  /** Telefonate fatte nel periodo a contatti di questa campagna. */
  chiamate: number;
  /** Di quelle, quelle con esito "Connesso": la persona ha risposto. */
  connessioni: number;
};

// La campagna e' gia' risolta in `chiamata.campagna_id` dal sync: e' quella che
// il contatto aveva AL MOMENTO della telefonata, non l'ultima in assoluto.
// Vedi src/lib/chiamate/sync.ts.
//
// Restano fuori le chiamate senza campagna (contatti chiamati da lista e
// convertiti dopo): circa lo 0,3%.
//
// NOME E VARIANTE: vedi src/lib/campagne.ts. Il valore memorizzato porta con se'
// il marcatore di assegnazione che il contatto aveva al momento della
// telefonata, quindi la vista unificata lo toglie e le altre due lo conservano.
function costruisciQuery(variante: Variante): string {
  const nome = sqlNomeCampagna(variante);
  const filtro = sqlFiltroCampagna(variante);
  const joinBase = varianteUnificaNomi(variante) ? SQL_JOIN_BASE : "";
  return `
  SELECT ${nome} AS campagna,
         COUNT(*)::int                              AS chiamate,
         COUNT(*) FILTER (WHERE ch.connessa)::int   AS connessioni
  FROM chiamata ch
  JOIN campagna c ON c.id = ch.campagna_id
  ${joinBase}
  WHERE ch.ts >= $1::date AND ch.ts < ($2::date + INTERVAL '1 day')
    AND ${filtro}
  GROUP BY 1
  ORDER BY connessioni DESC
`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const variante = leggiVariante(searchParams.get("variante"));
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  try {
    const db = getDb();
    const { rows } = await db.query<CampaignChiamateRow>(costruisciQuery(variante), [from, to]);

    const {
      rows: [ultimo]
    } = await db.query<{ finito_at: string | null }>(
      `SELECT finito_at FROM sync_log WHERE tipo = 'chiamate' AND esito = 'ok'
       ORDER BY finito_at DESC LIMIT 1`
    );

    return NextResponse.json(
      { righe: rows, aggiornato_al: ultimo?.finito_at ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[campaign-chiamate]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
