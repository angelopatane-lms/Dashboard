import { NextRequest, NextResponse } from "next/server";
import { fetchCsv } from "@/lib/csv";
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

function tabCsvUrl(sheetName: string): string {
  return `https://docs.google.com/spreadsheets/d/${ADS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
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

  await Promise.all(
    months.map(async ({ year, month }) => {
      const tabName = monthTabName(year, month);
      try {
        const csvRows = await fetchCsv(tabCsvUrl(tabName), { next: { revalidate: 300 } });
        for (const r of csvRows) {
          const data = toDateIso(getString(r, "Data"));
          const campagna = getString(r, "Campagna");
          const spesa = toNumber(getString(r, "Spesa"));
          if (!data && !campagna && !spesa) continue;
          rows.push({ data, campagna, spesa });
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
