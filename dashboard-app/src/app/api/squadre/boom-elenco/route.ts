import { NextRequest, NextResponse } from "next/server";
import { elencoBoomDiPersona } from "@/lib/squadre/boom";

/**
 * I BOOM DI UNA PERSONA, uno per riga, per il dettaglio delle pagine squadre.
 *
 * SI CHIAMA SOLO QUANDO QUALCUNO PREME "Chiusure" su una scheda del pannello,
 * e non a ogni apertura di pagina: l'altra rotta - `/api/squadre/boom` -
 * manda somme proprio per non far viaggiare il nome di ogni cliente insieme
 * ai numeri di tutti. Qui le righe sono di una persona sola, in un periodo
 * solo, e arrivano perche' sono state chieste.
 *
 * STESSA CHIAVE DELLE ALTRE ROTTE SQUADRE, `SQUADRE_SECRET`: a chiamarla e'
 * sempre il progetto Squadre, che prima ha controllato il pass della squadra
 * e che la persona chiesta sia una delle sue. Il browser non arriva mai qui.
 *
 * NON TOCCA IL DATABASE: i Boom stanno su HubSpot, che si paga a chiamata.
 * E' la ragione per cui questo dettaglio si puo' aprire quante volte si
 * vuole senza svegliare Neon.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const RE_GIORNO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const atteso = process.env.SQUADRE_SECRET;
  if (!atteso) {
    return NextResponse.json({ errore: "SQUADRE_SECRET non impostata" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${atteso}`) {
    return NextResponse.json({ errore: "chiave non valida" }, { status: 403 });
  }
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ errore: "HUBSPOT_PRIVATE_APP_TOKEN non impostata" }, { status: 500 });
  }

  const q = req.nextUrl.searchParams;
  const da = q.get("da") ?? "";
  const a = q.get("a") ?? "";
  const persona = (q.get("persona") ?? "").trim();
  if (!RE_GIORNO.test(da) || !RE_GIORNO.test(a)) {
    return NextResponse.json({ errore: "da e a devono essere date AAAA-MM-GG" }, { status: 400 });
  }
  if (!/^\d+$/.test(persona)) {
    return NextResponse.json({ errore: "persona deve essere un id" }, { status: 400 });
  }

  try {
    const righe = await elencoBoomDiPersona(token, da, a, persona);
    return NextResponse.json(
      { persona, finestra: { da, a }, righe, letto: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[squadre/boom-elenco]", perche);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
