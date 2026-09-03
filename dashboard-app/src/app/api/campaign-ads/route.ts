import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/csv";
import { getString, toDateIso, toNumber } from "@/lib/metrics";

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

  return NextResponse.json(
    { rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}
