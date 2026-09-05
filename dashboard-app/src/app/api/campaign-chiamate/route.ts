import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { leggiVariante, sqlFiltroCampagna, sqlNomeCampagna, type Variante } from "@/lib/campagne";

export const dynamic = "force-dynamic";

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
// QUALI CAMPAGNE E COME SI RAGGRUPPANO: vedi src/lib/campagne.ts.
function costruisciQuery(variante: Variante): string {
  return `
  SELECT ${sqlNomeCampagna(variante)} AS campagna,
         COUNT(*)::int                              AS chiamate,
         COUNT(*) FILTER (WHERE ch.connessa)::int   AS connessioni
  FROM chiamata ch
  JOIN campagna c ON c.id = ch.campagna_id
  WHERE ch.ts >= $1::date AND ch.ts < ($2::date + INTERVAL '1 day')
    AND ${sqlFiltroCampagna(variante)}
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
