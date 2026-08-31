"use client";

import { useEffect, useMemo, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { applyFilters, type Filters } from "@/lib/metrics";
import { aggregateByCampagna, normalizeOperatori } from "@/lib/analytics";
import { formatPct } from "@/lib/format";
import CampaignConversionPeaksChart from "@/components/charts/CampaignConversionPeaksChart";
import { FiltersBar } from "@/components/Filters";
import Card from "@/components/ui/Card";
import ChartTitle from "@/components/ui/ChartTitle";
import SectionTitle from "@/components/ui/SectionTitle";
import CampaignSummaryBar from "@/components/charts/CampaignSummaryBar";
import CampaignAdsTable, { type CampaignAdsRow } from "@/components/charts/CampaignAdsTable";

type CampaignPeaksDatum = {
  date: string;
  [campaign: string]: string | number | null;
};

// TODO: sostituire con i dati reali (Categoria, Spesa, Lead Generati, Lead
// Unici per campagna) non appena sara' disponibile la fonte Ads dedicata
// (nuovo tab Google Sheet). Nel frattempo generiamo valori placeholder
// deterministici (stessi ad ogni render, niente Math.random) partendo dai
// nomi campagna reali, cosi' Risposte/Fissati/Processati/Chiusure/Importo
// restano collegati ai dati reali.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function guessCategoria(campagna: string): string {
  const c = campagna.toLowerCase();
  if (c.includes("coach")) return "COACH";
  if (c.includes("imprenditoria")) return "IA";
  return "ALTRO";
}

function buildPlaceholderAdsRows(campaigns: string[]): CampaignAdsRow[] {
  return campaigns
    .filter((c) => c && c.trim().toLowerCase() !== "nessuna")
    .map((campagna) => {
      const h = hashString(campagna);
      const leadGenerati = 50 + (h % 600);
      const leadUnici = Math.max(1, Math.round(leadGenerati * (0.2 + ((h >> 3) % 50) / 100)));
      const spesa = Math.round((150 + (h % 900)) * 1.37 * 100) / 100;
      return { categoria: guessCategoria(campagna), campagna, spesa, leadGenerati, leadUnici };
    });
}

export default function CampaignsDashboard({
  operatoriRows,
  operatoriRowsOggi,
  operators,
  campaigns
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  operators: string[];
  campaigns: string[];
}) {
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
  }, []);

  const defaultTo = useMemo(
    () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" }),
    []
  );

  const [filters, setFilters] = useState<Filters>(() => ({ from: defaultFrom, to: defaultTo }));

  const todayIsoRome = useMemo(
    () =>
      new Date().toLocaleDateString("en-CA", {
        timeZone: "Europe/Rome"
      }),
    []
  );

  const includeToday = useMemo(() => {
    const from = filters.from ?? "";
    const to = filters.to ?? "";
    if (!todayIsoRome) return false;
    if (from && from > todayIsoRome) return false;
    if (to && to < todayIsoRome) return false;
    return true;
  }, [filters.from, filters.to, todayIsoRome]);

  const operatoriRowsWithToday = useMemo(
    () => (includeToday ? [...operatoriRows, ...operatoriRowsOggi] : operatoriRows),
    [includeToday, operatoriRows, operatoriRowsOggi]
  );

  const operatoriFiltered = useMemo(
    () => applyFilters(operatoriRowsWithToday, filters),
    [operatoriRowsWithToday, filters]
  );

  const operatoriNorm = useMemo(() => normalizeOperatori(operatoriFiltered), [operatoriFiltered]);

  const campaignSummaryFull = useMemo(() => aggregateByCampagna(operatoriNorm), [operatoriNorm]);

  const campaignSummary = useMemo(() => campaignSummaryFull.slice(0, 12), [campaignSummaryFull]);

  const campaignAdsRows = useMemo(() => buildPlaceholderAdsRows(campaigns), [campaigns]);

  const campaignAnomalies = useMemo(() => {
    const toMs = (iso: string) => new Date(iso).getTime();
    const maxDateIso = operatoriNorm.reduce<string | null>(
      (acc, r) => (!acc || r.data > acc ? r.data : acc),
      null
    );
    if (!maxDateIso) return [];

    const endMs = toMs(maxDateIso);
    const dayMs = 24 * 60 * 60 * 1000;
    const recentDays = 7;
    const baselineDays = 90;
    const recentStartMs = endMs - (recentDays - 1) * dayMs;
    const baselineEndMs = recentStartMs - dayMs;
    const baselineStartMs = baselineEndMs - (baselineDays - 1) * dayMs;

    type Agg = { ass: number; app: number };
    const recentByCamp = new Map<string, Agg>();
    const baselineByCamp = new Map<string, Agg>();

    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t)) continue;
      if (t >= recentStartMs && t <= endMs) {
        const cur = recentByCamp.get(r.campagna) ?? { ass: 0, app: 0 };
        cur.ass += r.assegnati; cur.app += r.appuntamenti;
        recentByCamp.set(r.campagna, cur);
      } else if (t >= baselineStartMs && t <= baselineEndMs) {
        const cur = baselineByCamp.get(r.campagna) ?? { ass: 0, app: 0 };
        cur.ass += r.assegnati; cur.app += r.appuntamenti;
        baselineByCamp.set(r.campagna, cur);
      }
    }

    const campaignSet = new Set(
      (campaigns ?? []).map((c) => c.trim()).filter((c) => c && c.toLowerCase() !== "nessuna")
    );
    const campaignKeys = campaignSet.size > 0
      ? Array.from(campaignSet)
      : Array.from(new Set<string>([...Array.from(recentByCamp.keys()), ...Array.from(baselineByCamp.keys())]));

    return campaignKeys
      .map((campagna) => {
        const recent = recentByCamp.get(campagna) ?? { ass: 0, app: 0 };
        const baseline = baselineByCamp.get(campagna) ?? { ass: 0, app: 0 };
        const recentRate = recent.ass > 0 ? recent.app / recent.ass : 0;
        const baselineRate = baseline.ass > 0 ? baseline.app / baseline.ass : 0;
        return { campagna, recentRate, baselineRate, delta: recentRate - baselineRate };
      })
      .sort((a, b) => {
        const aAltro = a.campagna.trim().toLowerCase() === "altro";
        const bAltro = b.campagna.trim().toLowerCase() === "altro";
        if (aAltro && !bAltro) return 1;
        if (!aAltro && bAltro) return -1;
        return a.delta - b.delta;
      });
  }, [operatoriNorm, campaigns]);

  const campaignPeaks = useMemo(() => {
    const toMs = (iso: string) => new Date(iso).getTime();
    const maxDateIso = operatoriNorm.reduce<string | null>(
      (acc, r) => (!acc || r.data > acc ? r.data : acc),
      null
    );
    if (!maxDateIso) return { campaigns: [] as string[], data: [] as CampaignPeaksDatum[] };

    const endMs = toMs(maxDateIso);
    const dayMs = 24 * 60 * 60 * 1000;
    const startMs = endMs - 59 * dayMs;

    const assByCamp = new Map<string, number>();
    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;
      assByCamp.set(r.campagna, (assByCamp.get(r.campagna) ?? 0) + r.assegnati);
    }

    const peakCampaigns = campaignAnomalies
      .map((r) => r.campagna)
      .filter((c) => (assByCamp.get(c) ?? 0) > 0);
    if (peakCampaigns.length === 0) return { campaigns: [] as string[], data: [] as CampaignPeaksDatum[] };

    type Agg = { ass: number; app: number };
    const byDay = new Map<string, Map<string, Agg>>();
    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data || !peakCampaigns.includes(r.campagna)) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;
      const dayMap = byDay.get(r.data) ?? new Map<string, Agg>();
      const cur = dayMap.get(r.campagna) ?? { ass: 0, app: 0 };
      cur.ass += r.assegnati; cur.app += r.appuntamenti;
      dayMap.set(r.campagna, cur);
      byDay.set(r.data, dayMap);
    }

    const data: CampaignPeaksDatum[] = Array.from(byDay.keys())
      .sort((a, b) => toMs(a) - toMs(b))
      .map((date) => {
        const dayMap = byDay.get(date) ?? new Map<string, Agg>();
        const row: CampaignPeaksDatum = { date };
        for (const c of peakCampaigns) {
          const agg = dayMap.get(c);
          row[c] = agg && agg.ass > 0 ? agg.app / agg.ass : null;
        }
        return row;
      });

    return { campaigns: peakCampaigns, data };
  }, [operatoriNorm, campaignAnomalies]);

  const [focusedPeaksCampaign, setFocusedPeaksCampaign] = useState<string | null>(null);

  const lowestDeltaCampaign = useMemo(() => {
    if (campaignAnomalies.length === 0) return null;
    return campaignAnomalies.reduce<string | null>((acc, r) => {
      if (!acc) return r.campagna;
      const prev = campaignAnomalies.find((x) => x.campagna === acc);
      if (!prev) return r.campagna;
      return r.delta < prev.delta ? r.campagna : acc;
    }, null);
  }, [campaignAnomalies]);

  const peaksVisibleCampaigns = useMemo(() => {
    if (focusedPeaksCampaign) return [focusedPeaksCampaign];
    if (lowestDeltaCampaign) return [lowestDeltaCampaign];
    return [] as string[];
  }, [focusedPeaksCampaign, lowestDeltaCampaign]);

  useEffect(() => {
    if (!lowestDeltaCampaign) return;
    if (!focusedPeaksCampaign) { setFocusedPeaksCampaign(lowestDeltaCampaign); return; }
    const stillExists = campaignAnomalies.some((r) => r.campagna === focusedPeaksCampaign);
    if (!stillExists) setFocusedPeaksCampaign(lowestDeltaCampaign);
  }, [campaignAnomalies, focusedPeaksCampaign, lowestDeltaCampaign]);

  const insightsTableHeightPx = useMemo(() => {
    const rows = Math.max(1, campaignAnomalies.length);
    return Math.max(260, 32 + rows * 40);
  }, [campaignAnomalies.length]);

  const baselineRateByCampaign = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of campaignAnomalies) out[r.campagna] = r.baselineRate;
    return out;
  }, [campaignAnomalies]);

  return (
    <div>
      <div id="filtri" className="w-full scroll-mt-6">
        <FiltersBar
          filters={filters}
          setFilters={setFilters}
          operators={operators}
          campaigns={campaigns}
        />
      </div>

      <Card className="mt-6">
        <CampaignAdsTable adsRows={campaignAdsRows} campaignSummary={campaignSummaryFull} />
      </Card>

      <div id="campagne" className="scroll-mt-6">
        <SectionTitle className="mt-10">KPI Campagne</SectionTitle>
      </div>
      <Card>
        <ChartTitle
          title="KPI Campagne"
          description="Confronto per campagna su assegnati, connessioni, appuntamenti, no show e show up."
        />
        <div className="mt-4 h-[340px]">
          <CampaignSummaryBar data={campaignSummary} />
        </div>
      </Card>

      <div id="insights" className="scroll-mt-6">
        <SectionTitle className="mt-10">Insights</SectionTitle>
      </div>
      <div
        className="mt-6 overflow-hidden rounded-md bg-white ring-1 ring-slate-200"
        style={{ height: insightsTableHeightPx }}
      >
        <div className="grid grid-cols-12 gap-x-4 border-b border-slate-700 bg-[#64748b] px-4 py-2 text-[13px] font-semibold text-white">
          <div className="col-span-4 whitespace-nowrap">Campagna</div>
          <div className="col-span-3 whitespace-nowrap text-center">Conversione 7g</div>
          <div className="col-span-3 whitespace-nowrap text-center">Conversione 90g</div>
          <div className="col-span-2 whitespace-nowrap text-center text-[17px]">Δ</div>
        </div>
        <div className="divide-y divide-slate-200">
          {campaignAnomalies.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">Nessuna anomalia disponibile.</div>
          ) : (
            campaignAnomalies.map((row) => {
              const delta = row.delta;
              const sign = delta >= 0 ? "+" : "";
              const deltaColor = delta < 0 ? "text-rose-700" : "text-emerald-700";
              const isFocused = focusedPeaksCampaign === row.campagna;
              return (
                <div
                  key={row.campagna}
                  className={`grid grid-cols-12 gap-x-4 px-4 py-2 text-sm ${isFocused ? "bg-slate-50" : "bg-white"}`}
                >
                  <button
                    type="button"
                    onClick={() => setFocusedPeaksCampaign(row.campagna)}
                    className="col-span-4 truncate text-left font-medium text-slate-900 hover:underline"
                    title={row.campagna}
                  >
                    {row.campagna}
                  </button>
                  <div className="col-span-3 text-center text-slate-700">{formatPct(row.recentRate, 1)}</div>
                  <div className="col-span-3 text-center text-slate-700">{formatPct(row.baselineRate, 1)}</div>
                  <div className={`col-span-2 text-center font-semibold ${deltaColor}`}>
                    {sign}{formatPct(delta, 1)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Card className="mt-6">
        <div className="h-[360px]">
          <CampaignConversionPeaksChart
            data={campaignPeaks.data}
            campaigns={campaignPeaks.campaigns}
            baselineByCampaign={baselineRateByCampaign}
            visibleCampaigns={peaksVisibleCampaigns}
          />
        </div>
      </Card>
    </div>
  );
}
