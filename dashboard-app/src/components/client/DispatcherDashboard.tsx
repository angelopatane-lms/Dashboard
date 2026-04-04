"use client";

import { useMemo, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { applyFilters, computeKpis, type Filters } from "@/lib/metrics";
import { aggregateDispatchByOperatore, normalizeDispatch } from "@/lib/analytics";
import { formatInt } from "@/lib/format";
import { FiltersBar } from "@/components/Filters";
import SectionTitle from "@/components/ui/SectionTitle";
import Card from "@/components/ui/Card";
import ChartTitle from "@/components/ui/ChartTitle";
import DispatchDonutChart from "@/components/charts/DispatchDonutChart";
import DispatchEntryExitBar from "@/components/charts/DispatchEntryExitBar";
import DispatchQualityBar from "@/components/charts/DispatchQualityBar";

export default function DispatcherDashboard({
  dispatchRows,
  dispatchRowsAll,
  dispatchRowsOggi,
  dispatchRowsAllOggi,
  operators,
  campaigns
}: {
  dispatchRows: CsvRow[];
  dispatchRowsAll: CsvRow[];
  dispatchRowsOggi: CsvRow[];
  dispatchRowsAllOggi: CsvRow[];
  operators: string[];
  campaigns: string[];
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

  const dispatchRowsWithToday = useMemo(
    () => (includeToday ? [...dispatchRows, ...dispatchRowsOggi] : dispatchRows),
    [includeToday, dispatchRows, dispatchRowsOggi]
  );

  const dispatchRowsAllWithToday = useMemo(
    () => (includeToday ? [...dispatchRowsAll, ...dispatchRowsAllOggi] : dispatchRowsAll),
    [includeToday, dispatchRowsAll, dispatchRowsAllOggi]
  );

  const dispatchFiltered = useMemo(
    () => applyFilters(dispatchRowsWithToday, filters),
    [dispatchRowsWithToday, filters]
  );

  const dispatchAllFiltered = useMemo(
    () => applyFilters(dispatchRowsAllWithToday, filters),
    [dispatchRowsAllWithToday, filters]
  );

  const dispatchKpisAll = useMemo(() => computeKpis([], dispatchAllFiltered), [dispatchAllFiltered]);

  const dispatchmentDeltaRaw = (dispatchKpisAll.dispatchSi ?? 0) - (dispatchKpisAll.dispatchNo ?? 0);
  const dispatchmentDeltaSafe = Number.isFinite(dispatchmentDeltaRaw) ? dispatchmentDeltaRaw : 0;
  const dispatchmentDelta = Math.round(dispatchmentDeltaSafe);
  const dispatchmentIsEmpty = dispatchmentDelta === 0;
  const dispatchmentIsBalanced = !dispatchmentIsEmpty && Math.abs(dispatchmentDelta) <= 20;

  const dispatchNorm = useMemo(() => normalizeDispatch(dispatchFiltered), [dispatchFiltered]);

  const dispatchSummary = useMemo(
    () => aggregateDispatchByOperatore(dispatchNorm).slice(0, 12),
    [dispatchNorm]
  );

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
    </div>
  );
}
