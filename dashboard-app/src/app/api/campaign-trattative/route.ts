import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export type CampaignTrattativeRow = {
  campagna: string;
  /** Consulenze effettivamente svolte nel periodo: trattative la cui PRIMA
   *  transizione di fase che soddisfa i criteri del workflow "Performance
   *  Tracker - Trattative Svolte" cade nell'intervallo. */
  consulenze: number;
  /** Appuntamenti disertati nel periodo. Una trattativa puo' contribuirne piu'
   *  di uno: viene ripianificata e il cliente diserta di nuovo. */
  no_show: number;
};

// La data della consulenza e' precalcolata in `trattativa.svolta_ts` dal sync,
// perche' non e' ricavabile dallo stato attuale della trattativa: le proprieta'
// su cui il workflow decide cambiano a ogni passaggio successivo. Vedi
// src/lib/trattative/sync.ts.
//
// Si contano solo le trattative con una campagna: quelle senza
// id_campagna_track (circa il 2%) restano nel database ma non hanno una riga a
// cui appartenere.
// Consulenze e no-show sono due insiemi di EVENTI con date proprie, contati
// separatamente e poi uniti: una trattativa puo' comparire in entrambi (ha
// disertato a luglio, e' stata ripianificata e si e' svolta ad agosto).
const QUERY = `
  WITH svolte AS (
    SELECT campagna_id, COUNT(*)::int AS n
    FROM trattativa
    WHERE svolta_ts >= $1::date AND svolta_ts < ($2::date + INTERVAL '1 day')
    GROUP BY campagna_id
  ),
  disertati AS (
    SELECT campagna_id, COUNT(*)::int AS n
    FROM no_show
    WHERE ts >= $1::date AND ts < ($2::date + INTERVAL '1 day')
    GROUP BY campagna_id
  )
  SELECT c.nome AS campagna,
         COALESCE(s.n, 0) AS consulenze,
         COALESCE(d.n, 0) AS no_show
  FROM campagna c
  LEFT JOIN svolte s ON s.campagna_id = c.id
  LEFT JOIN disertati d ON d.campagna_id = c.id
  WHERE COALESCE(s.n, 0) > 0 OR COALESCE(d.n, 0) > 0
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
