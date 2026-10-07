import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getDb } from "@/lib/db";

/**
 * Quanti appuntamenti ha fissato oggi una persona. Per l'app di assegnazione.
 *
 * A COSA SERVE. Il bot che distribuisce i lead ha una regola: chi ha troppi
 * contatti ancora da chiamare non riceve altro, A MENO che oggi abbia fissato
 * abbastanza appuntamenti. Quella regola non e' mai scattata, perche'
 * count_today_appointments() era un segnaposto che restituiva 0 a chiunque.
 *
 * PERCHE' LA RISPOSTA ARRIVA DA QUI E NON DA HUBSPOT. L'app poteva chiederlo
 * da se', ed e' la prima strada che avevamo preso: contare i contatti passati
 * a "Appuntamento fissato" oggi. Non funziona. Su questo portale qualcosa
 * tocca in massa migliaia di contatti al giorno - il 7 ottobre 2026, 9.228 dei
 * 12.511 in quello stato risultavano "modificati oggi" - quindi il filtro sulla
 * data non distingue niente, e per sapere chi e' cambiato DAVVERO oggi bisogna
 * leggere la cronologia contatto per contatto: dei 100 piu' recenti ne erano
 * cambiati 12. Dentro una richiesta Slack non e' sostenibile, e sarebbe
 * inaffidabile in modo invisibile - per una persona molto attiva il conteggio
 * verrebbe troncato e il bonus non scatterebbe, senza che nulla lo segnali.
 *
 * Qui invece e' una riga di SQL su dati che abbiamo gia', aggiornati in tempo
 * reale dal webhook delle trattative.
 *
 * LA DEFINIZIONE E' QUELLA DELLA DASHBOARD, e non una terza inventata per
 * l'occasione: un appuntamento e' una trattativa creata nella pipeline
 * Appuntamenti, attribuita al setter se c'e' e altrimenti al proprietario.
 * E' la stessa regola di /api/hubspot-trattative e di /api/advisor-andamento,
 * quindi il numero che il bot usa per decidere e il numero che si legge sulla
 * pagina Advisor sono lo stesso numero. Due definizioni della stessa parola in
 * due posti e' il modo piu' rapido per ritrovarsi due cifre diverse e non
 * sapere a quale credere.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * IL SEGRETO E' QUELLO CHE I DUE SISTEMI CONDIVIDONO GIA'.
 *
 * La Dashboard chiama l'app con `LMS_ASSEGNAZIONI_TOKEN`, che sul server
 * dell'app si chiama `DASHBOARD_TOKEN` ed e' lo stesso valore. Qui la chiamata
 * va nel verso opposto, ma le due parti sono le stesse e il segreto lo hanno
 * gia' tutte e due: inventarne un terzo vorrebbe dire generarlo, metterlo in
 * due posti e ricordarsene - tre occasioni di sbagliare per nessuna sicurezza
 * in piu'.
 */
const NOME_SEGRETO = "LMS_ASSEGNAZIONI_TOKEN";

/** Confronto a tempo costante fra stringhe di lunghezza qualsiasi. */
function ugualiInSicurezza(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * La mezzanotte italiana, non quella del database.
 *
 * Il database e' in GMT: `date_trunc('day', now())` farebbe cominciare la
 * giornata alle 02:00 ora italiana, e le trattative create fra mezzanotte e le
 * due finirebbero nel giorno prima. Si perderebbero gli appuntamenti presi di
 * notte - pochi, ma a danno di chi li ha presi.
 */
const MEZZANOTTE_ROMA =
  "date_trunc('day', now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome'";

export async function GET(req: NextRequest) {
  const atteso = process.env.LMS_ASSEGNAZIONI_TOKEN;
  if (!atteso) {
    return NextResponse.json(
      { error: `${NOME_SEGRETO} non impostato` },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const dato = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!ugualiInSicurezza(dato, atteso)) {
    return NextResponse.json(
      { error: "non autorizzato" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const chiesto = (req.nextUrl.searchParams.get("proprietario") ?? "").trim();

  try {
    const db = getDb();

    // Senza `proprietario` si risponde con tutti: serve a controllare che il
    // totale torni con quello della pagina Advisor, che e' l'unico modo per
    // accorgersi se le due definizioni si separano.
    if (!chiesto) {
      const { rows } = await db.query<{ proprietario: string; nome: string; appuntamenti: string }>(
        `SELECT COALESCE(t.setter_id, t.proprietario_id)::text AS proprietario,
                p.nome AS nome,
                COUNT(*)::text AS appuntamenti
           FROM trattativa t
           JOIN proprietario p ON p.id = COALESCE(t.setter_id, t.proprietario_id)
          WHERE t.creata_ts >= ${MEZZANOTTE_ROMA}
          GROUP BY 1, 2
          ORDER BY COUNT(*) DESC`
      );
      return NextResponse.json(
        {
          persone: rows.map((r) => ({ ...r, appuntamenti: Number(r.appuntamenti) })),
          totale: rows.reduce((s, r) => s + Number(r.appuntamenti), 0)
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!/^\d+$/.test(chiesto)) {
      return NextResponse.json(
        { error: "proprietario deve essere un id numerico" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { rows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM trattativa t
        WHERE t.creata_ts >= ${MEZZANOTTE_ROMA}
          AND COALESCE(t.setter_id, t.proprietario_id) = $1::bigint`,
      [chiesto]
    );

    return NextResponse.json(
      { proprietario: chiesto, appuntamenti: Number(rows[0]?.n ?? 0) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    // SI RISPONDE CON UN ERRORE, NON CON ZERO. Chi chiama deve poter
    // distinguere "non ha fissato appuntamenti" da "non te lo so dire": col
    // secondo il bot nega il bonus ma non afferma un numero sul lavoro di una
    // persona.
    console.error("[lms/appuntamenti-oggi]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "errore imprevisto" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
