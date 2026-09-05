import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { leggiVariante, sqlFiltroCampagna, sqlNomeCampagna, type Variante } from "@/lib/campagne";

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

// Per ogni campagna, nell'intervallo [from, to]:
//
// - Lead Generati: PERSONE DISTINTE che hanno convertito su quella campagna nel
//   periodo. Iscriversi due volte alla stessa campagna vale 1; iscriversi a tre
//   campagne diverse vale 1 per ciascuna, quindi 3 in totale. Ne segue che la
//   somma fra campagne e' maggiore delle persone reali: e' voluto, perche' ogni
//   campagna deve ricevere il merito di chi ha effettivamente coinvolto.
//
// - Lead Unici: le persone la cui PRIMA CONVERSIONE IN ASSOLUTO cade nel
//   periodo, attribuite alla campagna di quella prima conversione. Sono i lead
//   nuovi: prima non esistevano nel database.
//
//   Due proprieta' che ne discendono:
//   1. STABILE NEL TEMPO. La data della prima conversione non cambia mai,
//      quindi rileggendo un mese passato fra sei mesi si ottiene lo stesso
//      numero di oggi. (Una regola basata su "quante conversioni ha in tutto"
//      sarebbe invece retroattiva: il numero calerebbe man mano che quei lead
//      tornano a convertire.)
//   2. SOMMA ESATTA. Ogni persona ha una sola prima conversione in tutta la
//      vita, quindi compare in una sola campagna e una sola volta: sommando fra
//      campagne si ottengono le persone reali, senza doppi conteggi.
//
//   Unico caso in cui il valore puo' cambiare: la fusione di due schede, che
//   crea una persona sola la cui prima conversione e' la piu' antica delle due.
//   E' raro (misurato: 1 caso su 7.670) e va nella direzione giusta.
//
// La prima conversione e' calcolata su TUTTA la storia (fuori dal filtro sulle
// date) e dopo la risoluzione delle fusioni.
//
// QUALI CAMPAGNE E COME SI RAGGRUPPANO: vedi src/lib/campagne.ts. Il nome di
// riga e il filtro arrivano da li' perche' devono coincidere con quelli che il
// client applica alla spesa del foglio Ads.
//
// Il raggruppamento avviene QUI e non a valle: unendo la variante instant alla
// campagna base lato client si sommerebbero due conteggi di persone, contando
// due volte chi ha convertito su entrambe. COUNT(DISTINCT) sul nome gia' unito
// lo evita.
function costruisciQuery(variante: Variante): string {
  const nome = sqlNomeCampagna(variante);
  const filtro = sqlFiltroCampagna(variante);
  return `
  WITH risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
  ),
  -- Prima conversione in assoluto di ogni persona: una riga per persona,
  -- calcolata su TUTTA la storia (nessun filtro di data qui dentro) e dopo la
  -- risoluzione delle fusioni, cosi' due schede unite sono una persona sola.
  prima_conversione AS (
    SELECT DISTINCT ON (persona_id) persona_id, campagna_id, ts
    FROM risolti
    ORDER BY persona_id, ts, campagna_id
  ),
  generati AS (
    SELECT ${nome} AS nome, COUNT(DISTINCT r.persona_id)::int AS n
    FROM risolti r JOIN campagna c ON c.id = r.campagna_id
    WHERE r.ts >= $1::date AND r.ts < ($2::date + INTERVAL '1 day')
      AND ${filtro}
    GROUP BY 1
  ),
  unici AS (
    SELECT ${nome} AS nome, COUNT(*)::int AS n
    FROM prima_conversione p JOIN campagna c ON c.id = p.campagna_id
    WHERE p.ts >= $1::date AND p.ts < ($2::date + INTERVAL '1 day')
      AND ${filtro}
    GROUP BY 1
  )
  SELECT COALESCE(g.nome, u.nome) AS campagna,
         COALESCE(g.n, 0) AS lead_generati,
         COALESCE(u.n, 0) AS lead_unici
  FROM generati g
  FULL OUTER JOIN unici u ON u.nome = g.nome
  ORDER BY lead_generati DESC
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
