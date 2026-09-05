import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { leggiVariante } from "@/lib/campagne";
import { costruisciQuery } from "@/lib/queryConversioni";

export const dynamic = "force-dynamic";

export type CampaignConversionRow = {
  campagna: string;
  /** Persone distinte che hanno convertito su questa campagna nel periodo.
   *  Due iscrizioni alla stessa campagna valgono 1; tre campagne diverse
   *  valgono 1 ciascuna. */
  lead_generati: number;
  /** Lead NUOVI: persone la cui prima conversione in assoluto cade nel periodo.
   *  Il valore e' stabile nel tempo e somma esattamente fra campagne. */
  lead_unici: number;
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