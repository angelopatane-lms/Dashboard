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
 *
 * PIU' FINESTRE IN UNA CHIAMATA, dal 14 novembre 2026: `finestre=da:a,da:a`
 * ne legge fino a sedici di fila e le riporta nell'ordine chiesto. Serve al
 * giro orario del progetto Squadre, che le precalcola tutte e le posa nella
 * fotografia: cosi' la pagina trova il numero gia' pronto invece di aspettare
 * un secondo ogni volta che si tocca un pulsante del periodo, e Neon non si
 * sveglia a ogni apertura della pagina ma una volta all'ora, nella finestra
 * in cui e' acceso comunque.
 *
 * `gruppi=nome:CAT|CAT;altro:CAT` chiede anche i conti di insiemi di
 * categorie - una squadra con due prodotti, le cinque squadre dei programmi
 * insieme - deduplicati dentro l'insieme: la somma delle righe non lo sarebbe.
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
  const categorie = (q.get("categorie") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  /** `nome:CAT|CAT;altro:CAT` -> { nome: ["CAT", "CAT"], altro: ["CAT"] }. */
  const gruppi: Record<string, string[]> = {};
  for (const pezzo of (q.get("gruppi") ?? "").split(";")) {
    const taglio = pezzo.indexOf(":");
    if (taglio < 1) continue;
    const nome = pezzo.slice(0, taglio).trim();
    const quali = pezzo
      .slice(taglio + 1)
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (nome && quali.length) gruppi[nome] = quali;
  }

  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const elenco = (q.get("finestre") ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => f.split(":"))
    .filter(([d, aa]) => ISO.test(d ?? "") && ISO.test(aa ?? ""))
    .slice(0, 16)
    .map(([d, aa]) => ({ da: d, a: aa }));

  const da = q.get("da");
  const a = q.get("a");
  if (!elenco.length && (!da || !a)) {
    return NextResponse.json({ errore: "servono da e a, oppure finestre" }, { status: 400 });
  }
  const daPrima = q.get("daPrima");
  const aPrima = q.get("aPrima");

  try {
    const db = getDb();

    // LE FINESTRE SI LEGGONO UNA DI FILA ALL'ALTRA, non insieme: ognuna e'
    // una query da circa un secondo che gira grossi insiemi in memoria, e
    // lanciarle in parallelo le farebbe litigare sulla stessa connessione
    // senza arrivare prima.
    if (elenco.length) {
      const fuori = [];
      for (const f of elenco) {
        fuori.push({ da: f.da, a: f.a, ...(await leadDelPeriodo(db, f.da, f.a, categorie, gruppi)) });
      }
      return NextResponse.json(
        { generato: new Date().toISOString(), finestre: fuori },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const ora = await leadDelPeriodo(db, da!, a!, categorie, gruppi);
    const prima =
      daPrima && aPrima ? await leadDelPeriodo(db, daPrima, aPrima, categorie, gruppi) : null;
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
