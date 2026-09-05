import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  leggiVariante,
  SQL_CTE_MARCATI,
  SQL_JOIN_BASE,
  sqlFiltroCampagna,
  sqlNomeBase,
  sqlNomeCampagna,
  sqlNomeInstant,
  varianteEsegmento,
  varianteUnificaNomi,
  type Variante
} from "@/lib/campagne";

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
  /** Appuntamenti fissati: trattative NATE nel periodo.
   *
   *  Arrivano da qui e non piu' da HubSpot in diretta perche' la nostra tabella
   *  ha in piu' il contatto, e senza quello il gruppo instant non si puo'
   *  ricostruire. Le due fonti contengono gli stessi deal - stessa pipeline,
   *  stesso filtro sulla data - e sul trimestre differiscono di 3 righe su
   *  2.022, cioe' deal senza proprietario che l'API in diretta scarta. */
  appuntamenti: number;
};

// La data della consulenza e' precalcolata in `trattativa.svolta_ts` dal sync,
// perche' non e' ricavabile dallo stato attuale della trattativa: le proprieta'
// su cui il workflow decide cambiano a ogni passaggio successivo. Vedi
// src/lib/trattative/sync.ts.
//
// Si contano solo le trattative con una campagna: quelle senza
// id_campagna_track (circa il 2%) restano nel database ma non hanno una riga a
// cui appartenere.
//
// NOME E VARIANTE: vedi src/lib/campagne.ts.
//
// IL GRUPPO INSTANT SI DECIDE DAL CONTATTO, non dal nome campagna. La
// trattativa conserva il nome com'era quando e' nata, e un workflow scrive
// id_campagna_track PRIMA che la riscrittura aggiunga il marcatore: il nome
// quindi quasi sempre non ce l'ha, anche quando il contatto era stato assegnato
// subito. Misurato sul trimestre: per nome le consulenze instant sono 166, per
// contatto 192, e le 166 sono tutte dentro le 192 - il criterio del contatto
// contiene l'altro, quindi lo sostituisce senza perdere nulla.
//
// Il contatto arriva da trattativa.contact_id, riempito dal sync leggendo le
// associazioni HubSpot. Per i no-show si risale alla trattativa tramite
// deal_id, che e' l'unica chiave che quella tabella conserva.
//
// Consulenze e no-show sono due insiemi di EVENTI con date proprie, contati
// separatamente e poi uniti: una trattativa puo' comparire in entrambi (ha
// disertato a luglio, e' stata ripianificata e si e' svolta ad agosto).
function costruisciQuery(variante: Variante): string {
  const segmento = varianteEsegmento(variante);
  const instant = variante === "instant";
  // Nelle viste per segmento il nome della riga si ricava dalla campagna base,
  // non dal nome memorizzato: due trattative della stessa campagna possono
  // averlo scritto in due modi a seconda di quando sono nate.
  const nome = !segmento ? sqlNomeCampagna(variante) : instant ? sqlNomeInstant() : sqlNomeBase();
  // Il filtro sul suffisso non serve piu': a dividere i due gruppi e' il
  // contatto. Resta la sola regola del minuscolo.
  const filtro = segmento ? "c.nome = lower(c.nome)" : sqlFiltroCampagna(variante);
  const joinBase = varianteUnificaNomi(variante) ? SQL_JOIN_BASE : "";

  const appartiene = (idContatto: string) =>
    !segmento
      ? "TRUE"
      : `${instant ? "" : "NOT "}EXISTS (SELECT 1 FROM marcati m
             WHERE m.persona = ${idContatto} AND m.campagna = ${sqlNomeBase()})`;

  return `
  WITH ${segmento ? `${SQL_CTE_MARCATI},` : ""}
  -- Consulenze e appuntamenti escono dalla stessa scansione: sono la stessa
  -- tabella letta con due date diverse, svolta_ts e creata_ts.
  svolte AS (
    SELECT ${nome} AS nome,
           COUNT(*) FILTER (
             WHERE t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day')
           )::int AS n,
           COUNT(*) FILTER (
             WHERE t.creata_ts >= $1::date AND t.creata_ts < ($2::date + INTERVAL '1 day')
           )::int AS nate
    FROM trattativa t JOIN campagna c ON c.id = t.campagna_id
    ${joinBase}
    WHERE (
        (t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day'))
        OR (t.creata_ts >= $1::date AND t.creata_ts < ($2::date + INTERVAL '1 day'))
      )
      AND ${filtro}
      AND ${appartiene("t.contact_id")}
    GROUP BY 1
  ),
  disertati AS (
    SELECT ${nome} AS nome, COUNT(*)::int AS n
    FROM no_show n
    JOIN campagna c ON c.id = n.campagna_id
    LEFT JOIN trattativa td ON td.deal_id = n.deal_id
    ${joinBase}
    WHERE n.ts >= $1::date AND n.ts < ($2::date + INTERVAL '1 day')
      AND ${filtro}
      AND ${appartiene("td.contact_id")}
    GROUP BY 1
  )
  SELECT COALESCE(s.nome, d.nome) AS campagna,
         COALESCE(s.n, 0)    AS consulenze,
         COALESCE(d.n, 0)    AS no_show,
         COALESCE(s.nate, 0) AS appuntamenti
  FROM svolte s
  FULL OUTER JOIN disertati d ON d.nome = s.nome
  ORDER BY consulenze DESC
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
    const { rows } = await db.query<CampaignTrattativeRow>(costruisciQuery(variante), [from, to]);

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
