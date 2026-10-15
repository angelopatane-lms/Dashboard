import { NextRequest, NextResponse } from "next/server";

/**
 * Le campagne in cui il blocco del webinar non si applica.
 *
 * IL BLOCCO: un contatto il cui webinar non e' finito da almeno una settimana
 * non viene assegnato, perche' dentro quella finestra lo lavora il flusso del
 * webinar. Qui si elencano le eccezioni.
 *
 * ECCEZIONI E NON ELENCO DI APPLICAZIONE: se qualcuno dimentica di aggiornarlo,
 * resta il comportamento di sempre - il blocco pieno. Il verso opposto, "si
 * applica solo a queste", dimenticato spegnerebbe la protezione ovunque.
 *
 * Ponte verso l'app di assegnazione, come le altre rotte qui accanto: il
 * segreto condiviso resta sul server e non arriva mai al browser.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const INDIRIZZO =
  process.env.LMS_WEBINAR_URL ||
  "https://lms.217.154.117.118.nip.io/dispatch-api/webinar-eccezioni";

async function chiama(metodo: "GET" | "POST", corpo?: unknown) {
  const token = process.env.LMS_ASSEGNAZIONI_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "LMS_ASSEGNAZIONI_TOKEN non impostato: la sezione resta in sola lettura" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const r = await fetch(INDIRIZZO, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo ? { "Content-Type": "application/json" } : {})
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
    const dati = await r.json().catch(() => ({ error: `risposta non leggibile (${r.status})` }));
    return NextResponse.json(dati, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[assegnazione-lead/webinar]", e);
    return NextResponse.json(
      { error: "l'app di assegnazione non risponde" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function GET() {
  return chiama("GET");
}

export async function POST(req: NextRequest) {
  const corpo = await req.json().catch(() => null);
  if (!corpo) return NextResponse.json({ error: "corpo mancante" }, { status: 400 });
  return chiama("POST", corpo);
}
