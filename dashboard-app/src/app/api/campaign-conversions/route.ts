import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export type CampaignConversionRow = {
  campagna: string;
  /** Tutte le conversioni del periodo, ripetizioni della stessa persona incluse. */
  lead_generati: number;
  /** Persone distinte, ognuna attribuita alla PRIMA campagna che ha toccato nel
   *  periodo: sommando fra campagne si ottengono le persone reali, senza doppi. */
  lead_unici: number;
  /** Di quelle persone, chi era alla prima conversione in assoluto. */
  convertiti: number;
  /** Di quelle persone, chi era gia' noto ed e' tornato a convertire. */
  riconvertiti: number;
};

// Per ogni campagna, nell'intervallo [from, to]:
// - Convertiti: persone alla loro prima conversione ASSOLUTA (posizione = 1),
//   avvenuta su questa campagna.
// - Riconvertiti: persone gia' esistenti (posizione > 1 nella loro storia)
//   che tornano a convertire su questa campagna.
// - Lead Generati = Convertiti + Riconvertiti = persone distinte per cui
//   QUESTA e' la prima campagna toccata nel periodo selezionato (attribuzione
//   "prima campagna del periodo vince", cosi' la somma tra campagne e'
//   sempre corretta senza doppio conteggio).
const QUERY = `
  WITH risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts, e.posizione
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    WHERE e.ts >= $1::date AND e.ts < ($2::date + INTERVAL '1 day')
  ),
  filtrati AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY ts) AS rank_nel_periodo
    FROM risolti
  )
  SELECT c.nome AS campagna,
         COUNT(*)::int                                                          AS lead_generati,
         COUNT(*) FILTER (WHERE f.rank_nel_periodo = 1)::int                    AS lead_unici,
         COUNT(*) FILTER (WHERE f.rank_nel_periodo = 1 AND f.posizione = 1)::int AS convertiti,
         COUNT(*) FILTER (WHERE f.rank_nel_periodo = 1 AND f.posizione > 1)::int AS riconvertiti
  FROM filtrati f
  JOIN campagna c ON c.id = f.campagna_id
  GROUP BY c.nome
  ORDER BY lead_generati DESC
`;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  try {
    const db = getDb();
    const { rows } = await db.query<CampaignConversionRow>(QUERY, [from, to]);

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
