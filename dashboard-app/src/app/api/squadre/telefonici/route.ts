import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ieriRoma } from "@/lib/report/giornaliero";
import { piuGiorni } from "@/lib/squadre/finestra";
import { perGiornoEPersona, primiTelefonici } from "@/lib/statiLead/telefonici";

/**
 * APPUNTAMENTI E CONSULENZE DEGLI ADVISOR EVENTI, giorno per giorno.
 *
 * PERCHE' UNA ROTTA A PARTE. Gli advisor eventi vendono biglietti al telefono:
 * niente videochiamata fissata, niente trattativa in pipeline High Ticket, e
 * quindi niente appuntamenti e niente consulenze nella fotografia che alimenta
 * le pagine squadre - che quelle due colonne le prende dalle trattative.
 * Misurato il 13 novembre 2026 sulla squadra ICMD: 1 appuntamento e 1
 * consulenza fra l'1 e il 13 novembre, contro 32 biglietti venduti. Una
 * conversione del 3200%, che e' il modo in cui un numero dice di essere
 * sbagliato.
 *
 * LA REGOLA E' QUELLA DELLA TABELLA ADVISOR, non una nuova: sta in
 * `src/lib/statiLead/telefonici.ts` e la usa anche `/api/advisor-telefonici`.
 * Si contano i movimenti dello Stato Lead, le trattative Vinte e Perse e le
 * chiusure, prendendo per ogni coppia advisor-contatto il PRIMO appuntamento e
 * la PRIMA consulenza.
 *
 * CHI LA APPLICA DECIDE A CHI. Questa rotta dice solo "per questi id, in questi
 * giorni, tanti appuntamenti e tante consulenze": e' il progetto Squadre a
 * usarli, e solo per le persone della squadra separata. Due chiavi invece di
 * una, cosi' se un domani qualcuno aggiunge gente al team HubSpot degli eventi
 * le squadre dei programmi restano come sono.
 *
 * NON TOCCA NESSUN'ALTRA ROTTA: `/api/squadre/giorni` resta quella di prima, e
 * chi non e' un advisor eventi non passa nemmeno di qui.
 */
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
    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN ?? "";
    // Si guarda tutta la storia per sapere qual e' il primo, ma le chiusure si
    // fermano alla fine della finestra chiesta: oltre non servono.
    const aMs = Date.parse(`${a}T23:59:59.999Z`);
    const primi = await primiTelefonici(db, token, aMs);

    const giornoRoma = (ms: number) =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
    const tutti = perGiornoEPersona(primi, giornoRoma);

    // Solo i giorni della finestra: il resto della storia e' servito a
    // stabilire i primi, non va mostrato.
    const giorni: Record<string, Record<string, { appuntamenti: number; consulenze: number }>> = {};
    for (const [g, perPersona] of tutti) {
      if (g < da || g > a) continue;
      const riga: Record<string, { appuntamenti: number; consulenze: number }> = {};
      for (const [id, v] of perPersona) riga[id] = v;
      giorni[g] = riga;
    }

    const nomi: Record<string, string> = {};
    for (const [id, nome] of primi.nomePerId) nomi[id] = nome;

    return NextResponse.json(
      { generato: new Date().toISOString(), finestra: { da, a }, nomi, giorni },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[squadre/telefonici]", perche);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
