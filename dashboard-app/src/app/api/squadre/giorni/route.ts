import { NextRequest, NextResponse } from "next/server";
import { ieriRoma } from "@/lib/report/giornaliero";
import { calcolaFinestra, piuGiorni } from "@/lib/squadre/finestra";

/**
 * I numeri delle squadre, a chi ha la chiave. Niente pagine, niente HTML:
 * solo il JSON che il progetto Squadre si viene a prendere ogni mattina.
 *
 * PERCHE' LA DASHBOARD LI CALCOLA PER UN ALTRO PROGETTO. Le definizioni di
 * "chiusura", "svolta", "no show" vivono qui, insieme al token di HubSpot e
 * alla connessione a Neon. Portarle di la' vorrebbe dire ricopiarle, e due
 * copie della stessa regola divergono sempre. Cosi' invece c'e' una sola
 * verita' e le pagine delle squadre ne sono un lettore come un altro.
 *
 * NON E' LA ROTTA DI UN CRON: non la chiama Vercel, la chiama il progetto
 * Squadre, che ha il suo orario. Per questo non guarda CRON_SECRET ma una
 * chiave sua, SQUADRE_SECRET, che le due parti si scambiano - e che si puo'
 * cambiare senza toccare i cron della Dashboard.
 *
 * RISPONDE LA FINESTRA, NON LO STORICO. Chi chiama ha il suo archivio e sa
 * fondere; qui si calcola solo il pezzo chiesto. Trenta giorni sono 19
 * secondi, misurati il 31 ottobre 2026.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const quanti = Math.min(Math.max(Number(q.get("giorni") ?? 30), 1), 120);
  const da = q.get("da") ?? piuGiorni(a, -(quanti - 1));

  try {
    const uscita = await calcolaFinestra(token, da, a);
    return NextResponse.json(uscita, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
