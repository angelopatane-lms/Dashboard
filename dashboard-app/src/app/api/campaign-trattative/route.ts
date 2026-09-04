import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export type CampaignTrattativeRow = {
  campagna: string;
  /** Consulenze effettivamente svolte nel periodo: trattative la cui PRIMA
   *  transizione di fase che soddisfa i criteri del workflow "Performance
   *  Tracker - Trattative Svolte" cade nell'intervallo. */
  consulenze: number;
};

// La data della consulenza e' precalcolata in `trattativa.svolta_ts` dal sync,
// perche' non e' ricavabile dallo stato attuale della trattativa: le proprieta'
// su cui il workflow decide cambiano a ogni passaggio successivo. Vedi
// src/lib/trattative/sync.ts.
//
// Si contano solo le trattative con una campagna: quelle senza
// id_campagna_track (circa il 2%) restano nel database ma non hanno una riga a
// cui appartenere.
const QUERY = `
  SELECT c.nome AS campagna,
         COUNT(*)::int AS consulenze
  FROM trattativa t
  JOIN campagna c ON c.id = t.campagna_id
  WHERE t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day')
  GROUP BY c.nome
  ORDER BY consulenze DESC
`;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  try {
    const db = getDb();
    const { rows } = await db.query<CampaignTrattativeRow>(QUERY, [from, to]);

    // Quando e' stata aggiornata l'ultima volta questa tabella: serve a capire
    // se i numeri sono freschi o fermi all'ultimo bootstrap manuale.
    const {
      rows: [ultimo]
    } = await db.query<{ finito_at: string | null }>(
      `SELECT finito_at FROM sync_log WHERE tipo = 'trattative' AND esito = 'ok'
       ORDER BY finito_at DESC LIMIT 1`
    );

    return NextResponse.json(
      { righe: rows, aggiornato_al: ultimo?.finito_at ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[campaign-trattative]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
