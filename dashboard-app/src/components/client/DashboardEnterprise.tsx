"use client";

import { useEffect, useMemo, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { applyFilters, computeKpis, type Filters } from "@/lib/metrics";
import {
  aggregateByCampagna,
  aggregateByOperatore,
  aggregateDispatchByOperatore,
  aggregateTimeSeries,
  normalizeDispatch,
  normalizeOperatori
} from "@/lib/analytics";
import { formatFloat, formatInt, formatPct } from "@/lib/format";
import { FiltersBar } from "@/components/Filters";
import SectionTitle from "@/components/ui/SectionTitle";
import KPICard from "@/components/ui/KPICard";
import Card from "@/components/ui/Card";
import ChartTitle from "@/components/ui/ChartTitle";
import FunnelStagesChart from "@/components/charts/FunnelStagesChart";
import DispatchDonutChart from "@/components/charts/DispatchDonutChart";
import ReactivityGauge from "@/components/charts/ReactivityGauge";
import TimeSeriesChart, { type TrendSeriesKey } from "@/components/charts/TimeSeriesChart";
import OperatorPerformanceBar from "@/components/charts/OperatorPerformanceBar";
import CampaignSummaryBar from "@/components/charts/CampaignSummaryBar";
import DispatchQualityBar from "@/components/charts/DispatchQualityBar";
import CampaignConversionPeaksChart from "@/components/charts/CampaignConversionPeaksChart";
import DispatchEntryExitBar from "@/components/charts/DispatchEntryExitBar";
import FunnelStraightLinesChart, { type FunnelTrendKey } from "@/components/charts/FunnelStraightLinesChart";
import ContactEventsTimeline from "@/components/charts/ContactEventsTimeline";

type CampaignPeaksDatum = {
  date: string;
  [campaign: string]: string | number | null;
};

export default function DashboardEnterprise({
  operatoriRows,
  dispatchRows,
  dispatchRowsAll,
  operatoriRowsOggi,
  dispatchRowsOggi,
  dispatchRowsAllOggi,
  trackingEventiRows,
  operators,
  campaigns,
  hideDispatchment,
  hideCampagne,
  hideInsights,
  hideTimelineEventi
}: {
  operatoriRows: CsvRow[];
  dispatchRows: CsvRow[];
  dispatchRowsAll: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  dispatchRowsOggi: CsvRow[];
  dispatchRowsAllOggi: CsvRow[];
  trackingEventiRows: CsvRow[];
  operators: string[];
  campaigns: string[];
  hideDispatchment?: boolean;
  hideCampagne?: boolean;
  hideInsights?: boolean;
  hideTimelineEventi?: boolean;
}) {
  const [filters, setFilters] = useState<Filters>({});

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
  const dispatchRowsWithToday = useMemo(
    () => (includeToday ? [...dispatchRows, ...dispatchRowsOggi] : dispatchRows),
    [includeToday, dispatchRows, dispatchRowsOggi]
  );
  const dispatchRowsAllWithToday = useMemo(
    () => (includeToday ? [...dispatchRowsAll, ...dispatchRowsAllOggi] : dispatchRowsAll),
    [includeToday, dispatchRowsAll, dispatchRowsAllOggi]
  );

  const ALL_TREND_KEYS: TrendSeriesKey[] = [
    "assegnati",
    "connessioni",
    "appuntamenti",
    "serieA",
    "serieB",
    "proprietario"
  ];

  const ALL_FUNNEL_TREND_KEYS: FunnelTrendKey[] = [
    "effContatto",
    "convApp",
    "noShowPct",
    "showUpPct"
  ];

  const [selectedTrendKeys, setSelectedTrendKeys] = useState<Set<TrendSeriesKey>>(
    () => new Set(ALL_TREND_KEYS)
  );

  const [selectedFunnelTrendKeys, setSelectedFunnelTrendKeys] = useState<Set<FunnelTrendKey>>(
    () => new Set(ALL_FUNNEL_TREND_KEYS)
  );

  const isAllTrendSelected = selectedTrendKeys.size === ALL_TREND_KEYS.length;
  const trendVisibleKeys = isAllTrendSelected ? undefined : Array.from(selectedTrendKeys);

  const isAllFunnelTrendSelected = selectedFunnelTrendKeys.size === ALL_FUNNEL_TREND_KEYS.length;
  const funnelTrendVisibleKeys = isAllFunnelTrendSelected
    ? undefined
    : Array.from(selectedFunnelTrendKeys);

  const operatoriFiltered = useMemo(
    () => applyFilters(operatoriRowsWithToday, filters),
    [operatoriRowsWithToday, filters]
  );
  const dispatchFiltered = useMemo(
    () => applyFilters(dispatchRowsWithToday, filters),
    [dispatchRowsWithToday, filters]
  );
  const dispatchAllFiltered = useMemo(
    () => applyFilters(dispatchRowsAllWithToday, filters),
    [dispatchRowsAllWithToday, filters]
  );

  const kpis = useMemo(
    () => computeKpis(operatoriFiltered, dispatchFiltered),
    [operatoriFiltered, dispatchFiltered]
  );

  const dispatchKpisAll = useMemo(
    () => computeKpis([], dispatchAllFiltered),
    [dispatchAllFiltered]
  );

  const dispatchmentDeltaRaw = (dispatchKpisAll.dispatchSi ?? 0) - (dispatchKpisAll.dispatchNo ?? 0);
  const dispatchmentDeltaSafe = Number.isFinite(dispatchmentDeltaRaw) ? dispatchmentDeltaRaw : 0;
  const dispatchmentDelta = Math.round(dispatchmentDeltaSafe);
  const dispatchmentIsEmpty = dispatchmentDelta === 0;
  const dispatchmentIsBalanced = !dispatchmentIsEmpty && Math.abs(dispatchmentDelta) <= 20;

  const operatoriNorm = useMemo(
    () => normalizeOperatori(operatoriFiltered),
    [operatoriFiltered]
  );
  const dispatchNorm = useMemo(
    () => normalizeDispatch(dispatchFiltered),
    [dispatchFiltered]
  );

  const timeSeries = useMemo(
    () => aggregateTimeSeries(operatoriNorm, dispatchNorm, "day"),
    [operatoriNorm, dispatchNorm]
  );

  const operatorSummary = useMemo(
    () => aggregateByOperatore(operatoriNorm).slice(0, 12),
    [operatoriNorm]
  );

  const dispatchSummary = useMemo(
    () => aggregateDispatchByOperatore(dispatchNorm).slice(0, 12),
    [dispatchNorm]
  );

  const campaignSummary = useMemo(
    () => aggregateByCampagna(operatoriNorm, dispatchNorm).slice(0, 12),
    [operatoriNorm, dispatchNorm]
  );

  const effContatto = useMemo(
    () => (kpis.chiamate ? kpis.connessioni / kpis.chiamate : 0),
    [kpis]
  );
  const convApp = useMemo(
    () => (kpis.connessioni ? kpis.appuntamenti / kpis.connessioni : 0),
    [kpis]
  );
  const noShowPct = useMemo(
    () => (kpis.appuntamenti ? kpis.noShow / kpis.appuntamenti : 0),
    [kpis]
  );

  const reactivityPct = useMemo(() => {
    if (kpis.chiamate === 0) return 0;
    return Math.max(0, Math.min(100, 100 * (1 - kpis.reattivitaMediaMin / 300)));
  }, [kpis.chiamate, kpis.reattivitaMediaMin]);

  const funnelStages = useMemo(
    () => [
      { label: "Assegnati", value: kpis.assegnati, color: "#0ea5e9" },
      { label: "Chiamate", value: kpis.chiamate, color: "#64748b" },
      { label: "Conn.", value: kpis.connessioni, color: "#22c55e" },
      { label: "App.", value: kpis.appuntamenti, color: "#a855f7" }
    ],
    [kpis]
  );

  const leadStatusStages = useMemo(() => {
    const totals = operatoriNorm.reduce(
      (acc, r) => {
        acc.nuovi += r.nuovi;
        acc.nonRisposti += r.nonRisposti;
        acc.interesseFuturo += r.interesseFuturo;
        acc.semina += r.semina;
        acc.daRichiamare += r.daRichiamare;
        acc.bin += r.bin;
        acc.appuntamenti += r.appuntamenti;
        acc.noShow += r.noShow;
        return acc;
      },
      {
        nuovi: 0,
        nonRisposti: 0,
        interesseFuturo: 0,
        semina: 0,
        daRichiamare: 0,
        bin: 0,
        appuntamenti: 0,
        noShow: 0
      }
    );

    const total =
      totals.nuovi +
      totals.nonRisposti +
      totals.interesseFuturo +
      totals.semina +
      totals.daRichiamare +
      totals.bin +
      totals.appuntamenti +
      totals.noShow;

    const toPct = (n: number) => (total > 0 ? n / total : 0);

    return [
      { label: "Nuovi", value: toPct(totals.nuovi), color: "#0ea5e9" },
      { label: "Non\u00A0Risposti", value: toPct(totals.nonRisposti), color: "#64748b" },
      { label: "Interesse\u00A0Futuro", value: toPct(totals.interesseFuturo), color: "#a855f7" },
      { label: "Semina", value: toPct(totals.semina), color: "#f59e0b" },
      { label: "Da\u00A0Richiamare", value: toPct(totals.daRichiamare), color: "#22c55e" },
      { label: "BIN", value: toPct(totals.bin), color: "#ef4444" },
      { label: "Appuntamenti", value: toPct(totals.appuntamenti), color: "#14b8a6" },
      { label: "No Show", value: toPct(totals.noShow), color: "#94a3b8" }
    ];
  }, [operatoriNorm]);

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
        cur.ass += r.assegnati;
        cur.app += r.appuntamenti;
        recentByCamp.set(r.campagna, cur);
      } else if (t >= baselineStartMs && t <= baselineEndMs) {
        const cur = baselineByCamp.get(r.campagna) ?? { ass: 0, app: 0 };
        cur.ass += r.assegnati;
        cur.app += r.appuntamenti;
        baselineByCamp.set(r.campagna, cur);
      }
    }

    const campaignSet = new Set(
      (campaigns ?? [])
        .map((c) => c.trim())
        .filter((c) => c && c.toLowerCase() !== "nessuna")
    );
    const campaignKeys =
      campaignSet.size > 0
        ? Array.from(campaignSet)
        : Array.from(
            new Set<string>([
              ...Array.from(recentByCamp.keys()),
              ...Array.from(baselineByCamp.keys())
            ])
          );

    const rows = campaignKeys
      .map((campagna) => {
        const recent = recentByCamp.get(campagna) ?? { ass: 0, app: 0 };
        const baseline = baselineByCamp.get(campagna) ?? { ass: 0, app: 0 };

        const recentRate = recent.ass > 0 ? recent.app / recent.ass : 0;
        const baselineRate = baseline.ass > 0 ? baseline.app / baseline.ass : 0;
        const delta = recentRate - baselineRate;

        return {
          campagna,
          recentAss: recent.ass,
          recentApp: recent.app,
          baselineAss: baseline.ass,
          baselineApp: baseline.app,
          recentRate,
          baselineRate,
          delta
        };
      })
      .sort((a, b) => {
        const aAltro = a.campagna.trim().toLowerCase() === "altro";
        const bAltro = b.campagna.trim().toLowerCase() === "altro";
        if (aAltro && !bAltro) return 1;
        if (!aAltro && bAltro) return -1;
        return a.delta - b.delta;
      });

    return rows;
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
    const days = 60;
    const startMs = endMs - (days - 1) * dayMs;

    const assByCamp = new Map<string, number>();
    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;
      assByCamp.set(r.campagna, (assByCamp.get(r.campagna) ?? 0) + r.assegnati);
    }

    const campaigns = campaignAnomalies
      .map((r) => r.campagna)
      .filter((c) => (assByCamp.get(c) ?? 0) > 0);
    if (campaigns.length === 0) {
      return { campaigns: [] as string[], data: [] as CampaignPeaksDatum[] };
    }

    type Agg = { ass: number; app: number };
    const byDay = new Map<string, Map<string, Agg>>();

    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      if (!campaigns.includes(r.campagna)) continue;

      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;

      const dayKey = r.data;
      const dayMap = byDay.get(dayKey) ?? new Map<string, Agg>();
      const cur = dayMap.get(r.campagna) ?? { ass: 0, app: 0 };
      cur.ass += r.assegnati;
      cur.app += r.appuntamenti;
      dayMap.set(r.campagna, cur);
      byDay.set(dayKey, dayMap);
    }

    const data: CampaignPeaksDatum[] = Array.from(byDay.keys())
      .sort((a, b) => toMs(a) - toMs(b))
      .map((date) => {
        const dayMap = byDay.get(date) ?? new Map<string, Agg>();
        const row: CampaignPeaksDatum = { date };

        for (const c of campaigns) {
          const agg = dayMap.get(c);
          row[c] = agg && agg.ass > 0 ? agg.app / agg.ass : null;
        }

        return row;
      });

    return { campaigns, data };
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
    if (!focusedPeaksCampaign) {
      setFocusedPeaksCampaign(lowestDeltaCampaign);
      return;
    }
    const stillExists = campaignAnomalies.some((r) => r.campagna === focusedPeaksCampaign);
    if (!stillExists) setFocusedPeaksCampaign(lowestDeltaCampaign);
  }, [campaignAnomalies, focusedPeaksCampaign, lowestDeltaCampaign]);

  const insightsTableHeightPx = useMemo(() => {
    const headerPx = 32;
    const rowPx = 40;
    const rows = Math.max(1, campaignAnomalies.length);
    return Math.max(260, headerPx + rows * rowPx);
  }, [campaignAnomalies.length]);

  const baselineRateByCampaign = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of campaignAnomalies) out[r.campagna] = r.baselineRate;
    return out;
  }, [campaignAnomalies]);

  return (
    <div>
      <div className="min-w-0">
        <div id="filtri" className="w-full scroll-mt-6">
          <FiltersBar
            filters={filters}
            setFilters={setFilters}
            operators={operators}
            campaigns={campaigns}
          />
        </div>

        <div id="kpi" className="scroll-mt-6">
          <SectionTitle className="mt-10">KPI Principali</SectionTitle>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 lg:grid-cols-5 gap-6">
          <KPICard label="Assegnati" value={formatInt(kpis.assegnati)} />
          <KPICard
            label="Latenza"
            value={`${formatFloat(kpis.reattivitaMediaMin, 1)}`}
          />
          <KPICard label="Chiamate" value={formatInt(kpis.chiamate)} />
          <KPICard label="Connessioni" value={formatInt(kpis.connessioni)} />
          <KPICard label="Appuntamenti" value={formatInt(kpis.appuntamenti)} />
        </div>

        <div id="trend-funnel" className="scroll-mt-6">
          <SectionTitle className="mt-10">Trend Principali</SectionTitle>
        </div>
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <ChartTitle
                title="Trend Principali"
                description="Andamento storico dei principali indicatori di performance."
              />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTrendKeys((prev) =>
                      prev.size === ALL_TREND_KEYS.length ? new Set() : new Set(ALL_TREND_KEYS)
                    )
                  }
                  className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                    isAllTrendSelected ? "bg-slate-900" : "bg-slate-400 hover:bg-slate-500"
                  }`}
                >
                  Tutti
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has("assegnati")) next.delete("assegnati");
                      else next.add("assegnati");
                      return next;
                    })
                  }
                  className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                    selectedTrendKeys.has("assegnati")
                      ? "bg-[#0ea5e9]"
                      : "bg-[#0ea5e9]/40 hover:bg-[#0ea5e9]/60"
                  }`}
                >
                  Assegnati
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has("connessioni")) next.delete("connessioni");
                      else next.add("connessioni");
                      return next;
                    })
                  }
                  className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                    selectedTrendKeys.has("connessioni")
                      ? "bg-[#22c55e]"
                      : "bg-[#22c55e]/40 hover:bg-[#22c55e]/60"
                  }`}
                >
                  Connessioni
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has("appuntamenti")) next.delete("appuntamenti");
                      else next.add("appuntamenti");
                      return next;
                    })
                  }
                  className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                    selectedTrendKeys.has("appuntamenti")
                      ? "bg-[#a855f7]"
                      : "bg-[#a855f7]/40 hover:bg-[#a855f7]/60"
                  }`}
                >
                  Appuntamenti
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has("serieA")) next.delete("serieA");
                      else next.add("serieA");
                      return next;
                    })
                  }
                  className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                    selectedTrendKeys.has("serieA")
                      ? "bg-[#f59e0b]"
                      : "bg-[#f59e0b]/40 hover:bg-[#f59e0b]/60"
                  }`}
                >
                  Serie A
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has("serieB")) next.delete("serieB");
                      else next.add("serieB");
                      return next;
                    })
                  }
                  className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                    selectedTrendKeys.has("serieB")
                      ? "bg-[#ef4444]"
                      : "bg-[#ef4444]/40 hover:bg-[#ef4444]/60"
                  }`}
                >
                  Serie B
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has("proprietario")) next.delete("proprietario");
                      else next.add("proprietario");
                      return next;
                    })
                  }
                  className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                    selectedTrendKeys.has("proprietario")
                      ? "bg-[#64748b]"
                      : "bg-[#64748b]/40 hover:bg-[#64748b]/60"
                  }`}
                >
                  Proprietario
                </button>
              </div>
            </div>
            <div className="mt-4 h-[340px]">
              <TimeSeriesChart
                data={timeSeries}
                visibleKeys={trendVisibleKeys}
              />
            </div>
          </Card>
        </div>
        
      {hideDispatchment ? null : (
        <>
          <div id="distribuzioni" className="scroll-mt-6">
            <SectionTitle className="mt-10">Dispatchment</SectionTitle>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <ChartTitle
                title="Distribuzione Outcome"
                description="Ripartizione della qualità (Serie A, Serie B, Proprietario) sui lead lavorati. I contatori sotto riportano i volumi di Dispatch Entry/Exit."
              />
              <div className="mt-4 h-[260px]">
                <DispatchDonutChart
                  dispatchSi={dispatchKpisAll.dispatchSi}
                  dispatchNo={dispatchKpisAll.dispatchNo}
                  serieA={dispatchKpisAll.serieA}
                  serieB={dispatchKpisAll.serieB}
                  proprietario={dispatchKpisAll.proprietario}
                  showSiNo={false}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
                  <div className="text-gray-600">Dispatch Entry</div>
                  <div className="font-semibold text-gray-900">{formatInt(dispatchKpisAll.dispatchSi)}</div>
                </div>
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
                  <div className="text-gray-600">Dispatch Exit</div>
                  <div className="font-semibold text-gray-900">{formatInt(dispatchKpisAll.dispatchNo)}</div>
                </div>
              </div>
            </Card>
            <Card>
              <ChartTitle
                title="Bilanciamento Attività"
                description="Confronto tra Dispatch Entry e Dispatch Exit nel periodo selezionato."
              />
              <div className="mt-4 h-[260px]">
                <DispatchEntryExitBar entry={dispatchKpisAll.dispatchSi} exit={dispatchKpisAll.dispatchNo} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
                  <div className="text-gray-600">Dispatcher</div>
                  <div
                    className={`font-semibold ${
                      dispatchmentIsEmpty
                        ? "text-emerald-600"
                        : dispatchmentIsBalanced
                          ? "text-amber-600"
                          : "text-rose-600"
                    }`}
                  >
                    {dispatchmentIsEmpty
                      ? "Vuoto"
                      : dispatchmentIsBalanced
                        ? "Bilanciato"
                        : dispatchmentDelta > 20
                          ? "In Attesa"
                          : "Sbilanciato"}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
                  <div className="text-gray-600">Da Dispacciare</div>
                  <div className="font-semibold text-gray-900">
                    {dispatchmentDelta >= 0 ? "+" : ""}
                    {formatInt(dispatchmentDelta)}
                  </div>
                </div>
              </div>
            </Card>
            <Card className="md:col-span-2">
              <ChartTitle
                title="Outcome Operatore"
                description="Distribuzione della qualità per operatore: segmentazione in Serie A, Serie B e Proprietario."
              />
              <div className="mt-4 h-[340px]">
                <DispatchQualityBar data={dispatchSummary} />
              </div>
            </Card>
          </div>
        </>
      )}

      <div id="stati-lead" className="scroll-mt-6">
        <SectionTitle className="mt-10">Stati Lead</SectionTitle>
      </div>
      <Card>
        <ChartTitle
          title="Stato Lead Pattern"
          description="Conteggio aggregato dei principali Stati Lead a confronto con il numero di Appuntamenti e di No Show"
        />
        <div className="mt-4 h-[340px]">
          <FunnelStagesChart stages={leadStatusStages} valueFormat="pct" barSize={17} />
        </div>
      </Card>

      <div id="performance" className="scroll-mt-6">
        <SectionTitle className="mt-10">Performance</SectionTitle>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <Card>
          <ChartTitle
            title="KPI Operatore"
            description="Confronto per operatore su connessioni, appuntamenti e no show per individuare performance e criticità."
          />
          <div className="mt-4 h-[340px]">
            <OperatorPerformanceBar data={operatorSummary} />
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <ChartTitle
              title="Latenza"
              description="Tempo medio fra assegnazione e prima chiamata"
            />
            <div className="mt-4 h-[315px]">
              <ReactivityGauge value={kpis.reattivitaMediaMin} max={300} />
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Media Periodo:{" "}
              <span className="font-semibold text-gray-900">
                {formatFloat(kpis.reattivitaMediaMin, 1)} min
              </span>
            </div>
          </Card>
          <Card>
            <ChartTitle
              title="Reattività"
              description="Tempestività dell'Operatore nel passare all'azione"
            />
            <div className="mt-4 h-[315px]">
              <ReactivityGauge
                value={reactivityPct}
                max={100}
                unit="%"
                fillColor="#f59e0b"
              />
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Media Periodo:{" "}
              <span className="font-semibold text-gray-900">
                {formatFloat(reactivityPct, 1)}%
              </span>
            </div>
          </Card>
        </div>
        <Card>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <ChartTitle
              title="Trend Periodo"
              description="Trend lineare medio dei principali parametri Funnel nel periodo selezionato."
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelectedFunnelTrendKeys((prev) =>
                    prev.size === ALL_FUNNEL_TREND_KEYS.length
                      ? new Set()
                      : new Set(ALL_FUNNEL_TREND_KEYS)
                  )
                }
                className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                  isAllFunnelTrendSelected ? "bg-slate-900" : "bg-slate-400 hover:bg-slate-500"
                }`}
              >
                Tutti
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedFunnelTrendKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has("effContatto")) next.delete("effContatto");
                    else next.add("effContatto");
                    return next;
                  })
                }
                className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                  selectedFunnelTrendKeys.has("effContatto")
                    ? "bg-[#0ea5e9]"
                    : "bg-[#0ea5e9]/40 hover:bg-[#0ea5e9]/60"
                }`}
              >
                Efficienza Contatto
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedFunnelTrendKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has("convApp")) next.delete("convApp");
                    else next.add("convApp");
                    return next;
                  })
                }
                className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                  selectedFunnelTrendKeys.has("convApp")
                    ? "bg-[#22c55e]"
                    : "bg-[#22c55e]/40 hover:bg-[#22c55e]/60"
                }`}
              >
                Conversione Appuntamenti
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedFunnelTrendKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has("noShowPct")) next.delete("noShowPct");
                    else next.add("noShowPct");
                    return next;
                  })
                }
                className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                  selectedFunnelTrendKeys.has("noShowPct")
                    ? "bg-[#f59e0b]"
                    : "bg-[#f59e0b]/40 hover:bg-[#f59e0b]/60"
                }`}
              >
                Tasso di No Show
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedFunnelTrendKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has("showUpPct")) next.delete("showUpPct");
                    else next.add("showUpPct");
                    return next;
                  })
                }
                className={`rounded-md px-3 py-1 text-xs font-semibold text-white transition ${
                  selectedFunnelTrendKeys.has("showUpPct")
                    ? "bg-[#a855f7]"
                    : "bg-[#a855f7]/40 hover:bg-[#a855f7]/60"
                }`}
              >
                Tasso di Show Up
              </button>
            </div>
          </div>
          <div className="mt-4 h-[315px]">
            <FunnelStraightLinesChart data={timeSeries} visibleKeys={funnelTrendVisibleKeys} />
          </div>
        </Card>

        {hideCampagne ? null : (
          <>
            <div id="campagne" className="scroll-mt-6">
              <SectionTitle className="mt-10">Campagne</SectionTitle>
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
          </>
        )}
      </div>

      {hideInsights ? null : (
        <>
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
                  const focusBg = isFocused ? "bg-slate-50" : "bg-white";

                  return (
                    <div
                      key={row.campagna}
                      className={`grid grid-cols-12 gap-x-4 px-4 py-2 text-sm ${focusBg}`}
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
                        {sign}
                        {formatPct(delta, 1)}
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
        </>
      )}

      {hideTimelineEventi ? null : (
        <>
          <div id="timeline-eventi" className="scroll-mt-6">
            <SectionTitle className="mt-10">Timeline Eventi</SectionTitle>
          </div>
          <div className="mt-4">
            <ContactEventsTimeline rows={trackingEventiRows} />
          </div>
        </>
      )}
      </div>
    </div>
  );
}
