import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
// L'aggregazione e' per NOME NORMALIZZATO e non per campagna_id: in HubSpot
// esistono campagne che differiscono solo per maiuscole ("rem_meet_greet..." e
// "Rem_meet_greet..."), che sono la stessa campagna scritta in due modi. Senza
// unirle qui uscirebbero due righe che a valle si sovrascrivono a vicenda, e ha
// gia' causato una riga con 1 connessione al posto di 1.749.
// Per i Generati si usa COUNT(DISTINCT persona), non la somma: chi ha
// convertito su entrambe le grafie va contato una volta sola.
const QUERY = `
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
    SELECT lower(trim(c.nome)) AS nome, COUNT(DISTINCT r.persona_id)::int AS n
    FROM risolti r JOIN campagna c ON c.id = r.campagna_id
    WHERE r.ts >= $1::date AND r.ts < ($2::date + INTERVAL '1 day')
    GROUP BY 1
  ),
  unici AS (
    SELECT lower(trim(c.nome)) AS nome, COUNT(*)::int AS n
    FROM prima_conversione p JOIN campagna c ON c.id = p.campagna_id
    WHERE p.ts >= $1::date AND p.ts < ($2::date + INTERVAL '1 day')
    GROUP BY 1
  )
  SELECT COALESCE(g.nome, u.nome) AS campagna,
         COALESCE(g.n, 0) AS lead_generati,
         COALESCE(u.n, 0) AS lead_unici
  FROM generati g
  FULL OUTER JOIN unici u ON u.nome = g.nome
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
