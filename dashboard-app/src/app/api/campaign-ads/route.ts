import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { baseAccettabile, RE_SUFFISSO_VARIANTE, sqlNomeBase, type MappaVarianti } from "@/lib/campagne";
import { leggiSpesaAds } from "@/lib/spesaAds";

// Il tipo resta esportato da qui perche' il client lo importa da questo
// indirizzo; la lettura del foglio sta in @/lib/spesaAds, che la condivide con
// il grafico dell'andamento.
export type { CampaignAdsSpendRow } from "@/lib/spesaAds";

export const dynamic = "force-dynamic";

/**
 * Per ogni nome che finisce con un suffisso di variante ("_test_instant", "_2",
 * "_new", "_lal", "_interessi"...), il nome della campagna base - ma solo se quella base
 * esiste davvero fra le campagne HubSpot.
 *
 * La costruisce il server perche' solo lui ha l'elenco delle campagne; il client
 * la usa per raggruppare la spesa esattamente come fanno le query sui lead.
 * Senza, la riga "..._spirituale_test" resterebbe separata dalla sua base e
 * continuerebbe a mostrare spesa senza un solo lead.
 *
 * I candidati arrivano da due parti: i nomi visti nel foglio della spesa (che
 * spesso non esistono come campagne HubSpot) e le campagne HubSpot stesse.
 */
async function mappaVarianti(nomiFoglio: Iterable<string>): Promise<MappaVarianti> {
  const candidati = new Map<string, string>();
  for (const nome of nomiFoglio) {
    const k = nome.trim().toLowerCase();
    const base = k.replace(RE_SUFFISSO_VARIANTE, "");
    if (base !== k && baseAccettabile(base)) candidati.set(k, base);
  }

  try {
    const db = getDb();
    // Le varianti gia' presenti fra le campagne HubSpot.
    const { rows } = await db.query<{ variante: string; base: string }>(
      `SELECT lower(trim(v.nome)) AS variante, b.nome AS base
         FROM campagna v
         JOIN campagna b ON b.nome = ${sqlNomeBase("v")}
        WHERE v.nome = lower(v.nome)
          AND b.nome <> lower(trim(v.nome))
          AND position('_' in b.nome) > 0`
    );
    const mappa: MappaVarianti = {};
    for (const r of rows) mappa[r.variante] = r.base;

    // ...e quelle che compaiono solo nel foglio della spesa, tenute solo se la
    // base corrisponde a una campagna vera.
    const daVerificare = [...candidati.keys()].filter((k) => !(k in mappa));
    if (daVerificare.length) {
      const basi = daVerificare.map((k) => candidati.get(k) as string);
      const { rows: esistenti } = await db.query<{ nome: string }>(
        `SELECT nome FROM campagna WHERE nome = ANY($1::text[])`,
        [basi]
      );
      const set = new Set(esistenti.map((r) => r.nome));
      for (const k of daVerificare) {
        const base = candidati.get(k) as string;
        if (set.has(base)) mappa[k] = base;
      }
    }
    return mappa;
  } catch (err) {
    // Senza database la tabella deve continuare a funzionare: si rinuncia
    // all'unificazione, non ai dati.
    console.error("[campaign-ads] mappa varianti non disponibile:", err instanceof Error ? err.message : err);
    return {};
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const rows = await leggiSpesaAds(from, to);

  const varianti = await mappaVarianti(rows.map((r) => r.campagna));

  return NextResponse.json(
    { rows, varianti },
    { headers: { "Cache-Control": "no-store" } }
  );
}
