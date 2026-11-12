import { NextRequest, NextResponse } from "next/server";
import { tempoRisposta } from "@/lib/tempoRisposta/calcolo";

/**
 * IL TEMPO DI RISPOSTA DEL PERIODO, per la card "Latenza" della Dashboard.
 *
 * Il numero che la card mostrava prima veniva dalla colonna Latenza del
 * foglio Operatori: una media di medie, calcolata una volta dall'Apps Script
 * e non piu' verificabile, che contava anche le ore di notte come attesa e
 * guardava la prima chiamata dell'operatore invece della prima chiamata a
 * quel lead. Diceva 87 minuti dove la mediana vera e' 150.
 *
 * Il perche' della definizione sta in `lib/tempoRisposta/calcolo.ts`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const dal = req.nextUrl.searchParams.get("dal") ?? "";
  const al = req.nextUrl.searchParams.get("al") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dal) || !/^\d{4}-\d{2}-\d{2}$/.test(al)) {
    return NextResponse.json({ errore: "servono dal e al, in formato YYYY-MM-DD" }, { status: 400 });
  }
  try {
    // `al` arriva compreso, la misura taglia a mezzanotte: si sposta di un
    // giorno, altrimenti l'ultimo giorno del periodo resterebbe fuori.
    const fine = new Date(`${al}T00:00:00Z`);
    fine.setUTCDate(fine.getUTCDate() + 1);
    const t = await tempoRisposta(dal, fine.toISOString().slice(0, 10));
    return NextResponse.json(t);
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[api/tempo-risposta]", perche);
    return NextResponse.json({ errore: perche }, { status: 500 });
  }
}
