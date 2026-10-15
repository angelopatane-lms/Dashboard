import { NextRequest, NextResponse } from "next/server";

/**
 * Quanti lead per richiesta, divisi fra serie A e serie B, per ruolo.
 *
 * E' un ponte verso l'app di assegnazione, come /api/assegnazione-lead: il
 * segreto condiviso vive qui e non arriva mai al browser.
 *
 * DUE RUOLI, DUE RIGHE. Setter e Advisor hanno quantita' separate - e' il
 * motivo per cui la rotta lavora su un ruolo alla volta: chi cambia i Setter
 * non deve poter toccare gli Advisor per distrazione.
 *
 * SOTTO /dispatch-api/ E NON /api/: su quel server traefik manda tutto
 * `/api/*` a un'altra applicazione. Vedi il commento in ../route.ts.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const INDIRIZZO =
  process.env.LMS_QUANTITA_URL ||
  "https://lms.217.154.117.118.nip.io/dispatch-api/lead-quantita";

async function chiama(metodo: "GET" | "POST", corpo?: unknown) {
  const token = process.env.LMS_ASSEGNAZIONI_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "LMS_ASSEGNAZIONI_TOKEN non impostato: la quantita' resta in sola lettura" },
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
    console.error("[assegnazione-lead/quantita]", e);
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
  if (!corpo) {
    return NextResponse.json({ error: "corpo mancante" }, { status: 400 });
  }
  return chiama("POST", corpo);
}
