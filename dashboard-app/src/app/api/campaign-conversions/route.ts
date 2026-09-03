import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export type CampaignConversionRow = {
  campagna: string;
  /** Tutte le conversioni del periodo, ripetizioni della stessa persona incluse. */
  lead_generati: number;
  /** Lead NUOVI: persone che prima non esistevano su HubSpot e sono state
   *  create da questa iscrizione. Attribuzione alla prima campagna della VITA
   *  del contatto, non del periodo selezionato. */
  lead_unici: number;
};

// Per ogni campagna, nell'intervallo [from, to]:
//
// - Lead Generati: tutte le conversioni avvenute nel periodo, comprese le
//   ripetizioni della stessa persona sulla stessa campagna.
//
// - Lead Unici: i lead NUOVI, cioe' le persone che prima non esistevano su
//   HubSpot e sono nate da quell'iscrizione. Ogni contatto ha una sola prima
//   conversione in tutta la sua vita, quindi viene attribuito a una sola
//   campagna e una sola volta, per sempre. Ne discendono due proprieta' utili:
//   la somma fra campagne non ha doppi conteggi, e l'attribuzione NON cambia
//   allargando o restringendo il periodo (a differenza di un "primo del
//   periodo", che si sposta al variare delle date).
//
// La numerazione e' calcolata su TUTTA la storia (la finestra e' fuori dal
// filtro sulle date) e dopo la risoluzione delle fusioni: due schede unite
// sono una persona sola, quindi una sola prima conversione. Senza questo
// accorgimento i contatti fusi verrebbero contati due volte.
const QUERY = `
  WITH risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
  ),
  marcati AS (
    SELECT persona_id, campagna_id, ts,
           ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY ts, campagna_id) AS n_vita
    FROM risolti
  )
  SELECT c.nome AS campagna,
         COUNT(*)::int                                 AS lead_generati,
         COUNT(*) FILTER (WHERE m.n_vita = 1)::int     AS lead_unici
  FROM marcati m
  JOIN campagna c ON c.id = m.campagna_id
  WHERE m.ts >= $1::date AND m.ts < ($2::date + INTERVAL '1 day')
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
