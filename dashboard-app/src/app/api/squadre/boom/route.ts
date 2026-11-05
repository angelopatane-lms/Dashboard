import { NextRequest, NextResponse } from "next/server";
import { ieriRoma } from "@/lib/report/giornaliero";
import { calcolaBoom } from "@/lib/squadre/boom";
import { piuGiorni } from "@/lib/squadre/finestra";
import { proprietari } from "@/lib/squadre/proprietari";

/**
 * I Boom di una finestra, adesso.
 *
 * PERCHE' UNA ROTTA A PARTE da quella dei giorni. Quella si chiama una volta a
 * notte e fotografa; questa si chiama a ogni apertura di una pagina delle
 * squadre, perche' un incasso cancellato o corretto deve sparire subito. Sono
 * due mestieri diversi: uno costa venti secondi e si puo' permettere di
 * svegliare il database, l'altro deve costare pochi secondi e non lo tocca
 * mai.
 *
 * NIENTE DATABASE QUI DENTRO: solo HubSpot. Neon si paga a ore di accensione,
 * e una pagina che lo sveglia a ogni visita lo terrebbe acceso tutta la
 * mattina - e' il guasto del 29 ottobre 2026.
 *
 * STESSA CHIAVE dell'altra rotta, `SQUADRE_SECRET`: e' lo stesso progetto a
 * chiamarle tutte e due, e due chiavi da tenere allineate sarebbero due
 * occasioni di sbagliare.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const a = q.get("a") ?? ieriRoma();
  const quanti = Math.min(Math.max(Number(q.get("giorni") ?? 60), 1), 400);
  const da = q.get("da") ?? piuGiorni(a, -(quanti - 1));

  try {
    const nomi = await proprietari(token);
    const uscita = await calcolaBoom(token, da, a, nomi.perId, (r) => console.log("[squadre/boom]", r));
    return NextResponse.json(uscita, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[squadre/boom]", perche);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
