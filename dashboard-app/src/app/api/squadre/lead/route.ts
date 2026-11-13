import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { leadDelPeriodo } from "@/lib/squadre/lead";

/**
 * I LEAD GENERATI DAL MARKETING, per le pagine squadre.
 *
 * Due finestre in una chiamata: quella che si sta guardando e quella con cui
 * si confronta. Sono due letture da circa un secondo l'una, e chiederle
 * insieme evita che la pagina ne aspetti due di fila ogni volta che si tocca
 * un pulsante del periodo.
 *
 * LE CATEGORIE LE DECIDE CHI CHIAMA. Qui si sa solo di prodotti - DIV COACH,
 * REM, ICMD - e non di squadre: a legare le due cose e' `squadre.json`, nel
 * progetto Squadre, che e' anche l'unico posto dove si decide chi sta dentro e
 * chi fuori. Senza l'elenco si contano tutte, che serve per guardare.
 *
 * PERCHE' IL TOTALE NON E' LA SOMMA DELLE RIGHE: vedi il commento di
 * `src/lib/squadre/lead.ts`. Chi si iscrive a campagne di due squadre compare
 * in tutte e due e nel totale conta una volta sola, ed e' il motivo per cui
 * questa rotta esiste invece di sommare quello che la tabella Campagne sa
 * gia' dire.
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
  const da = q.get("da");
  const a = q.get("a");
  if (!da || !a) return NextResponse.json({ errore: "servono da e a" }, { status: 400 });
  const daPrima = q.get("daPrima");
  const aPrima = q.get("aPrima");
  const categorie = (q.get("categorie") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  try {
    const db = getDb();
    const ora = await leadDelPeriodo(db, da, a, categorie);
    const prima = daPrima && aPrima ? await leadDelPeriodo(db, daPrima, aPrima, categorie) : null;
    return NextResponse.json(
      { generato: new Date().toISOString(), finestra: { da, a }, ora, prima },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[squadre/lead]", perche);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
