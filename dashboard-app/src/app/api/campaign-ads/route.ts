import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/csv";
import { getDb } from "@/lib/db";
import { getString, toDateIso, toNumber } from "@/lib/metrics";
import { baseAccettabile, RE_SUFFISSO_VARIANTE, type MappaVarianti } from "@/lib/campagne";

export const dynamic = "force-dynamic";

// Foglio "Report Storico" con la spesa Ads giornaliera per campagna.
// Colonna A = Data (dd/mm/yyyy), B = Campagna, C = Spesa.
// Ogni mese vive in un tab a parte, con nome "Report_Storico_YYYY-MM".
const ADS_SHEET_ID = "16aLNOsxlaO-WVmahnLJ0gisI_l7P3y1-YAiTOVcGUlA";

export type CampaignAdsSpendRow = {
  data: string;
  campagna: string;
  spesa: number;
};

function tabCsvUrl(sheetName?: string): string {
  const base = `https://docs.google.com/spreadsheets/d/${ADS_SHEET_ID}/gviz/tq?tqx=out:csv`;
  return sheetName ? `${base}&sheet=${encodeURIComponent(sheetName)}` : base;
}

/**
 * Riconosce i tab di mese che NON esistono.
 *
 * Chiedendo a gviz un tab inesistente non si ottiene un errore: Google serve in
 * silenzio il primo foglio del documento. Quelle righe finivano nei conti come
 * spesa reale, moltiplicate per ogni mese mancante nell'intervallo (misurato:
 * chiedendo il 2025 arrivavano 384 righe fantasma per 14.791 EUR).
 *
 * Il foglio di ripiego e' identico a quello che si ottiene senza specificare
 * alcun tab, quindi lo si scarica una volta e si confronta. Il confronto e' sul
 * contenuto e non sulle date, perche' il ripiego e' datato dicembre 2025 e un
 * controllo per mese lo lascerebbe passare proprio in quel mese.
 */
async function testoFoglioPredefinito(): Promise<string | null> {
  try {
    const res = await fetch(tabCsvUrl(), {
      next: { revalidate: 300 },
      headers: { accept: "text/csv" }
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function monthTabName(year: number, month1to12: number): string {
  return `Report_Storico_${year}-${String(month1to12).padStart(2, "0")}`;
}

function monthsBetween(fromIso: string, toIso: string): Array<{ year: number; month: number }> {
  const now = new Date();
  const fallback = [{ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }];

  const start = fromIso ? new Date(`${fromIso}T00:00:00Z`) : null;
  const end = toIso ? new Date(`${toIso}T00:00:00Z`) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fallback;

  const months: Array<{ year: number; month: number }> = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth() + 1;

  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 36) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    guard += 1;
  }
  return months.length ? months : fallback;
}

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
         JOIN campagna b ON b.nome = regexp_replace(lower(trim(v.nome)), '_(test(_.+)?|[0-9]+|new|lal|int|interessi)$', '')
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

  const months = monthsBetween(from, to);
  const rows: CampaignAdsSpendRow[] = [];

  // Scaricato una volta sola e confrontato con ogni tab di mese: vedi
  // testoFoglioPredefinito().
  const predefinito = await testoFoglioPredefinito();

  await Promise.all(
    months.map(async ({ year, month }) => {
      const tabName = monthTabName(year, month);
      try {
        const res = await fetch(tabCsvUrl(tabName), {
          next: { revalidate: 300 },
          headers: { accept: "text/csv" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const testo = await res.text();

        // Primo controllo: il tab non esiste e gviz ha servito il foglio
        // predefinito al posto suo.
        if (predefinito !== null && testo === predefinito) {
          console.warn(`[campaign-ads] ${tabName}: tab inesistente (ricevuto il foglio predefinito), ignorato`);
          return;
        }

        // Secondo controllo, di riserva: si tengono comunque solo le righe
        // datate nel mese richiesto, cosi' una riga fuori posto non inquina i
        // totali nemmeno se il primo controllo non scattasse.
        const prefissoMese = `${year}-${String(month).padStart(2, "0")}`;
        let scartate = 0;

        for (const r of parseCsv(testo)) {
          const data = toDateIso(getString(r, "Data"));
          const campagna = getString(r, "Campagna");
          const spesa = toNumber(getString(r, "Spesa"));
          if (!data && !campagna && !spesa) continue;
          if (!data.startsWith(prefissoMese)) {
            scartate += 1;
            continue;
          }
          rows.push({ data, campagna, spesa });
        }

        if (scartate) {
          console.warn(`[campaign-ads] ${tabName}: scartate ${scartate} righe fuori dal mese`);
        }
      } catch (err) {
        // Tab del mese non ancora disponibile (o non ancora creato): si ignora.
        console.warn(`[campaign-ads] tab non disponibile: ${tabName}`, err instanceof Error ? err.message : err);
      }
    })
  );

  const varianti = await mappaVarianti(rows.map((r) => r.campagna));

  return NextResponse.json(
    { rows, varianti },
    { headers: { "Cache-Control": "no-store" } }
  );
}
