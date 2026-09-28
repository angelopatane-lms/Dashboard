// Chiamate e Connessioni per operatore, lette da HubSpot invece che dal foglio.
//
// PERCHE' ESISTE. Nella tabella Advisor quelle due colonne vengono dal foglio
// Operatori, compilato da un'automazione fuori dalla dashboard. Quando il
// foglio non si riempie il numero non e' basso: e' sbagliato. Misurato il 28
// settembre: un advisor con 136 lead assegnati e 3 chiamate segnate, e siccome
// gli appuntamenti arrivano invece da HubSpot la percentuale di appuntamento
// gli usciva al 400%.
//
// DA DOVE ARRIVA IL DATO. Dalla tabella `chiamata`, che il sync riempie
// leggendo le telefonate del CRM: una riga per chiamata, con il proprietario
// (chi ha chiamato), l'istante, e `connessa` a vero solo quando la disposizione
// HubSpot e' "Connected" - le altre (nessuna risposta, occupato, numero errato,
// segreteria) restano registrate ma non contano come connessione.
//
// LA CAMPAGNA E' QUELLA DEL MOMENTO DELLA CHIAMATA, non quella di oggi: si
// ricava dall'ultimo valore di `id_campagna_refresh` precedente alla
// telefonata. Una chiamata di marzo resta di marzo anche se il contatto si e'
// riconvertito a settembre.
//
// IL FILTRO PER CAMPAGNA usa la stessa regola del resto della pagina: l'etichetta
// del menu ("REM", "MBE MKTG") diventa un frammento e si cerca dentro il nome
// tecnico della campagna. Cosi' tutte le colonne di una riga rispondono alla
// stessa domanda, e non una per sottostringa e un'altra per uguaglianza esatta.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  // IL FRAMMENTO SI FERMA A UN CONFINE, non a meta' di una parola.
  //
  // "ICMD 14" diventa `icmd_14` e vale solo dove finisce li' o dove segue un
  // trattino basso: prende `icmd_14_richiesta_informazioni` e le altre 25
  // varianti, e NON prendera' `icmd_140` il giorno che nascera'.
  //
  // Resta fuori di proposito `icmd14_richiesta_informazioni_pakythemental`,
  // scritta senza separatore fra "icmd" e "14": esiste gia' la gemella scritta
  // bene, e inseguire le storpiature nel codice significa dare per buono che
  // vengano scritte male. Quella va corretta su HubSpot.
  const campagna = (searchParams.get("campagna") ?? "").trim();
  const frammento = campagna
    ? campagna.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    : "";

  // Stessa normalizzazione della tabella, cosi' "ANDREA VILARDO" del CRM e
  // "Andrea Vilardo" del foglio finiscono sulla stessa riga.
  const chiave = (nome: string) => nome.trim().toLowerCase().replace(/\s+/g, " ");

  try {
    const { rows } = await getDb().query<{ operatore: string; chiamate: string; connessioni: string }>(
      `SELECT p.nome AS operatore,
              COUNT(*)::text AS chiamate,
              COUNT(*) FILTER (WHERE ch.connessa)::text AS connessioni
         FROM chiamata ch
         JOIN proprietario p ON p.id = ch.proprietario_id
         LEFT JOIN campagna c ON c.id = ch.campagna_id
        WHERE ch.ts >= $1::date
          AND ch.ts < ($2::date + INTERVAL '1 day')
          -- Confronto per espressione regolare e non con LIKE: dentro un LIKE
          -- il trattino basso e' un jolly che vale "un carattere qualsiasi", e
          -- 'icmd_14' avrebbe agganciato anche 'icmdX14'. Qui il trattino e'
          -- se stesso, e il frammento deve finire dove finisce la parola.
          AND ($3 = '' OR lower(c.nome) ~ ($3 || '(_|$)'))
        GROUP BY 1`,
      [from, to, frammento]
    );

    const perOperatore: Record<string, { chiamate: number; connessioni: number }> = {};
    for (const r of rows) {
      perOperatore[chiave(r.operatore)] = {
        chiamate: Number(r.chiamate),
        connessioni: Number(r.connessioni)
      };
    }

    return NextResponse.json({ perOperatore }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[chiamate-operatore]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Lettura non riuscita" }, { status: 500 });
  }
}
