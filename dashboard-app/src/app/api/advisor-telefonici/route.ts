import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { chiaveNome, primiTelefonici } from "@/lib/statiLead/telefonici";

/**
 * Appuntamenti e Consulenze di chi lavora solo al telefono.
 *
 * Quattro advisor seguono il low ticket senza fissare videochiamate: niente
 * appuntamento sul calendario, quindi niente trattativa, quindi le due colonne
 * della tabella Advisor restavano a zero su persone che a settembre hanno
 * chiuso 69 vendite. Qui si ricostruiscono da tre fonti.
 *
 * LA REGOLA NON STA PIU' QUI DENTRO: dal 13 novembre 2026 vive in
 * `src/lib/statiLead/telefonici.ts`, perche' la leggono in due - questa rotta
 * e le pagine squadre, dove la squadra ICMD ha lo stesso problema. Il
 * ragionamento per esteso - perche' si conta il primo e non ogni volta,
 * perche' le chiusure valgono come consulenza - sta nel commento di testa di
 * quel file. Qui resta solo quello che e' proprio di questa rotta: il
 * periodo, il filtro campagna e i conteggi per nome.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * La stessa normalizzazione che la dashboard applica al filtro Campagna
 * altrove: l'etichetta scelta nel menu ("ICMD 14", "REM") diventa un pezzo di
 * stringa da cercare dentro l'id della campagna. Deve restare identica a quella
 * di DashboardEnterprise, altrimenti le stesse righe si filtrano in due modi.
 */
const normalizzaCampagna = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  // Vuoto quando non c'e' filtro: in quel caso non si scarta niente.
  const campagna = normalizzaCampagna(searchParams.get("campagna") ?? "") || null;

  const daMs = Date.parse(`${from}T00:00:00.000Z`);
  const aMs = Date.parse(`${to}T23:59:59.999Z`);

  try {
    const db = getDb();
    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN ?? "";
    const primi = await primiTelefonici(db, token, aMs, campagna);

    const conteggi: Record<string, { appuntamenti: number; consulenze: number }> = {};
    for (const nome of primi.nomePerId.values()) conteggi[chiaveNome(nome)] = { appuntamenti: 0, consulenze: 0 };
    const dentro = (ms: number) => ms >= daMs && ms <= aMs;
    for (const [k, ms] of primi.primoApp) {
      if (!dentro(ms)) continue;
      const nome = primi.nomePerId.get(k.split("|")[0]);
      if (nome) conteggi[chiaveNome(nome)].appuntamenti += 1;
    }
    for (const [k, ms] of primi.primoCons) {
      if (!dentro(ms)) continue;
      const nome = primi.nomePerId.get(k.split("|")[0]);
      if (nome) conteggi[chiaveNome(nome)].consulenze += 1;
    }

    return NextResponse.json({ conteggi }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[advisor-telefonici]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
