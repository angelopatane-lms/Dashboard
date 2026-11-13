import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ieriRoma } from "@/lib/report/giornaliero";
import { piuGiorni } from "@/lib/squadre/finestra";

/**
 * GLI ASSEGNATI, E QUANTI DI QUELLI VENGONO DAL MARKETING.
 *
 * COSA VUOL DIRE "DAL MARKETING": lo dice CHI ha fatto il cambio di mano, che
 * HubSpot registra nella cronologia del proprietario. Sono marketing:
 *
 *   - le assegnazioni fatte da un FLUSSO, cioe' automatiche dopo una
 *     conversione o una riconversione;
 *   - quelle fatte A MANO DA UN MARKETING MANAGER, che assegna in blocco i
 *     lead delle sue campagne. Sono la maggioranza: 3.915 su 4.205 assegnazioni
 *     manuali dell'1-13 novembre 2026 sono di Salvo Trifiro' e Adriano Fochini.
 *
 * Non sono marketing: l'app di riassegnazione (il setter CHIEDE i lead), le
 * altre integrazioni, le fusioni di contatti e le assegnazioni manuali di
 * chiunque altro - un advisor che si passa un contatto e' un giro interno.
 *
 * Misurato l'1-13 novembre 2026: 5.709 assegnazioni su 11.248, cioe' il 51% -
 * 1.794 dai flussi e 3.915 dai due marketing manager.
 *
 * PERCHE' NON SI GUARDA IL LEAD MA IL GESTO. Il 13 novembre 2026 abbiamo
 * provato tutti i segnali che il contatto porta con se' - quanto e' recente la
 * conversione, il cambio di `id_campagna_refresh`, il countdown e
 * `dispatch_outcome` al momento del cambio - e nessuno separa: su 46
 * assegnazioni con la campagna cambiata nell'ultima ora solo 22 venivano dai
 * flussi, e un quarto delle assegnazioni dei flussi ha la campagna vecchia.
 * Vedi src/lib/assegnazioni/origine.ts.
 *
 * UN'ASSEGNAZIONE E' UN CAMBIO DI MANO VERSO QUALCUNO DI NUOVO: senza
 * proprietario non c'e' nessuno a cui attribuirla, e con lo stesso di prima
 * non e' cambiato niente. Anche questa e' la regola del tempo di risposta.
 *
 * LA STORIA COMINCIA IL 29 OTTOBRE 2026, da quando il foglio Tracking Eventi
 * esiste: sui giorni prima questa rotta non ha righe, e la pagina mostra solo
 * il totale senza la ripartizione. Meglio un dettaglio che manca di un
 * dettaglio inventato.
 */
/**
 * GLI UTENTI HUBSPOT DEI MARKETING MANAGER, per id utente (non proprietario).
 *
 * Sono quelli che assegnano in blocco i lead delle campagne: le loro
 * assegnazioni manuali sono marketing a tutti gli effetti. La lista e' corta e
 * scritta qui perche' cambia quando cambia un marketing manager, cioe' quasi
 * mai, e va letta insieme ai nomi: 74459462 e' Salvo Trifiro', 69116118 e'
 * Adriano Fochini.
 */
const MARKETING_MANAGER = ["74459462", "69116118"];

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const atteso = process.env.SQUADRE_SECRET;
  if (!atteso) {
    return NextResponse.json({ errore: "SQUADRE_SECRET non impostata" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${atteso}`) {
    return NextResponse.json({ errore: "chiave non valida" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const a = q.get("a") ?? ieriRoma();
  const quanti = Math.min(Math.max(Number(q.get("giorni") ?? 60), 1), 400);
  const da = q.get("da") ?? piuGiorni(a, -(quanti - 1));

  try {
    const db = getDb();
    const { rows } = await db.query<{ giorno: string; id: string; totali: string; marketing: string }>(
      `
      WITH e AS (
        SELECT contatto_id, ts, proprietario_id, origine, origine_id,
               lag(proprietario_id) OVER (PARTITION BY contatto_id ORDER BY ts) AS prec
          FROM assegnazione_evento
      )
      SELECT to_char((ts AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM-DD') AS giorno,
             proprietario_id::text AS id,
             count(*)::text AS totali,
             count(*) FILTER (
               WHERE origine = 'flusso'
                  OR (origine = 'manuale' AND origine_id = ANY($3::text[]))
             )::text AS marketing
        FROM e
       WHERE ts >= ($1::date::timestamp AT TIME ZONE 'Europe/Rome')
         AND ts <  (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Rome')
         AND proprietario_id IS NOT NULL
         AND (prec IS NULL OR prec <> proprietario_id)
       GROUP BY 1, 2
      `,
      [da, a, MARKETING_MANAGER]
    );

    const giorni: Record<string, Record<string, { totali: number; marketing: number }>> = {};
    for (const r of rows) {
      (giorni[r.giorno] ??= {})[r.id] = { totali: Number(r.totali), marketing: Number(r.marketing) };
    }

    return NextResponse.json(
      { generato: new Date().toISOString(), finestra: { da, a }, giorni },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[squadre/assegnazioni]", perche);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
