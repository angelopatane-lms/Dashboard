import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { scriviRichiesta } from "@/lib/assegnazioni/richieste";

/**
 * L'app di assegnazione racconta cosa ha deciso, richiesta per richiesta.
 *
 * PERCHE' LO MANDA LEI INVECE DI FARCELO CHIEDERE. Una richiesta rifiutata non
 * lascia righe da nessuna parte: non su HubSpot - nessun contatto cambia - e
 * nemmeno nella tabella delle assegnazioni dell'app, che registra solo i lead
 * consegnati. L'unico momento in cui quell'informazione esiste e' l'istante
 * della decisione. Se non la dichiara allora, dopo non c'e' piu'.
 *
 * COSA CI SBLOCCA. Il 6 ottobre 2026, su sedici richieste, nove non sono state
 * servite, e per sapere il perche' e' servito interrogare a mano il database
 * dell'app: una persona bloccata dal tetto, una con lo Slack ID sbagliato, sei
 * con il sistema spento. Da ora quella meta' di giornata si legge in pagina
 * accanto all'altra.
 *
 * NON SOSTITUISCE IL CONTROLLO INCROCIATO. Una consegna puo' cadere - un
 * rilascio, un minuto di rete - e quando cade non lascia traccia. Il totale che
 * l'app dichiara di se' resta il modo per accorgersene: se ha consegnato piu'
 * lead di quanti risultino dalle richieste che abbiamo ricevuto, ne manca
 * qualcuna.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Il corpo ammesso: una richiesta sono poche righe. */
const TETTO_CORPO = 64 * 1024;

/**
 * Lo stesso segreto che i due sistemi condividono gia': LMS_ASSEGNAZIONI_TOKEN
 * qui, DASHBOARD_TOKEN sul server dell'app. Inventarne un terzo vorrebbe dire
 * generarlo, metterlo in due posti e ricordarsene, per nessuna sicurezza in
 * piu'.
 */
const NOME_SEGRETO = "LMS_ASSEGNAZIONI_TOKEN";

function ugualiInSicurezza(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
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

  const corpo = await req.text();
  if (corpo.length > TETTO_CORPO) {
    return NextResponse.json({ error: "corpo troppo lungo" }, { status: 413 });
  }

  let letto: unknown;
  try {
    letto = JSON.parse(corpo);
  } catch {
    console.error("[lms/assegnazioni] corpo non leggibile:", corpo.slice(0, 300));
    return NextResponse.json({ error: "corpo non leggibile" }, { status: 400 });
  }

  // Si accetta una richiesta sola o una lista: un recupero di arretrati manda
  // piu' righe in una volta, e costringerlo a una chiamata per riga sarebbe
  // pignolo e basta.
  const elenco = Array.isArray(letto) ? letto : [letto];
  if (!elenco.length) return NextResponse.json({ ok: true, scritte: 0 });

  const scritte: string[] = [];
  const respinte: Array<{ id: unknown; perche: string }> = [];
  for (const d of elenco) {
    try {
      const r = await scriviRichiesta(d as Record<string, unknown>);
      scritte.push(r.id);
    } catch (e) {
      // UNA RIGA STORTA NON FA CADERE LE ALTRE, e si dice quale: rispondere
      // 500 a tutto il lotto farebbe riprovare anche quelle gia' scritte.
      const m = e instanceof Error ? e.message : String(e);
      console.error("[lms/assegnazioni] riga respinta:", m);
      respinte.push({ id: (d as { id?: unknown })?.id, perche: m });
    }
  }

  return NextResponse.json(
    { ok: true, scritte: scritte.length, respinte },
    { status: respinte.length && !scritte.length ? 400 : 200, headers: { "Cache-Control": "no-store" } }
  );
}

/** Per controllare dal server dell'app che l'indirizzo risponda. */
export async function GET() {
  return NextResponse.json({
    endpoint: "lms-assegnazioni",
    variabile: NOME_SEGRETO,
    segreto: Boolean(process.env.LMS_ASSEGNAZIONI_TOKEN)
  });
}
