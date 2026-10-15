import { NextRequest, NextResponse } from "next/server";

/**
 * Le campagne che entrano anche senza `dispatch_outcome` e con il countdown.
 *
 * IL PROBLEMA. La ricerca dell'assegnatore chiede quattro cose insieme: niente
 * proprietario, niente countdown, un telefono, e `dispatch_outcome` uguale a
 * serie_a o serie_b. Misurato il 15 ottobre 2026 sulla campagna
 * lms_div_coach_intelligenza_spirituale_webinar: dei 2.062 contatti liberi,
 * 1.567 hanno `dispatch_outcome` VUOTO e 71 ce l'hanno a "proprietario". Sono
 * persone libere e raggiungibili che per l'assegnatore non esistono - non
 * perche' qualcuno le abbia escluse, ma perche' nessuno ha mai scritto quella
 * proprieta'. Altri 249 sono fermi su un countdown che nessuno sta consumando,
 * visto che proprietario non ne hanno.
 *
 * NON SI CORREGGE HUBSPOT, SI ALLARGA LA PESCA. Riscrivere `dispatch_outcome`
 * su millecinquecento contatti vorrebbe dire cambiare un dato che non e'
 * nostro, e che il flusso che lo gestisce potrebbe riscrivere domani. Qui si
 * dice soltanto "per queste campagne guarda anche loro", e solo finche'
 * l'interruttore resta acceso.
 *
 * Ponte verso l'app di assegnazione, come le altre rotte qui accanto: il
 * segreto condiviso resta sul server e non arriva mai al browser.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const INDIRIZZO =
  process.env.LMS_INGRESSO_URL ||
  "https://lms.217.154.117.118.nip.io/dispatch-api/ingresso-forzato";

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
    console.error("[assegnazione-lead/ingresso]", e);
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
