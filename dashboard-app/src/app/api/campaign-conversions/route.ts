import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export type CampaignConversionRow = {
  campagna: string;
  /** Tutte le conversioni del periodo, ripetizioni della stessa persona incluse. */
  lead_generati: number;
  /** Persone con UNA SOLA conversione in tutta la loro storia. Smettono di
   *  essere uniche appena si riconvertono, quindi il valore di un periodo
   *  passato diminuisce nel tempo. */
  lead_unici: number;
};

// Per ogni campagna, nell'intervallo [from, to]:
//
// - Lead Generati: tutte le conversioni avvenute nel periodo, comprese le
//   ripetizioni della stessa persona sulla stessa campagna.
//
// - Lead Unici: le persone che hanno UNA SOLA conversione in tutta la loro
//   storia. Restano uniche finche' non si riconvertono: appena
//   id_campagna_refresh cambia una seconda volta, quel contatto non e' piu'
//   unico ma riconvertito, e smette di contare per la campagna che l'aveva
//   portato.
//
//   CONSEGUENZA DA TENERE PRESENTE: il valore e' retroattivo. I Lead Unici di
//   un mese passato DIMINUISCONO col tempo, man mano che quei lead tornano a
//   convertire. Due letture dello stesso periodo a distanza di settimane
//   daranno numeri diversi: e' inerente alla definizione, non un errore.
//
// Il conteggio per persona e' su TUTTA la storia (fuori dal filtro sulle date)
// e dopo la risoluzione delle fusioni: due schede unite sono una persona sola,
// e la somma dei loro eventi decide se e' unica o riconvertita.
const QUERY = `
  WITH risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
  ),
  conteggi AS (
    SELECT persona_id, COUNT(*) AS eventi_vita
    FROM risolti
    GROUP BY persona_id
  )
  SELECT c.nome AS campagna,
         COUNT(*)::int                                    AS lead_generati,
         COUNT(*) FILTER (WHERE k.eventi_vita = 1)::int   AS lead_unici
  FROM risolti r
  JOIN conteggi k ON k.persona_id = r.persona_id
  JOIN campagna c ON c.id = r.campagna_id
  WHERE r.ts >= $1::date AND r.ts < ($2::date + INTERVAL '1 day')
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
