"use client";

import { useMemo, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { applyFilters, type Filters } from "@/lib/metrics";
import { aggregateByCampagna, normalizeDispatch, normalizeOperatori } from "@/lib/analytics";
import { FiltersBar } from "@/components/Filters";
import Card from "@/components/ui/Card";
import ChartTitle from "@/components/ui/ChartTitle";
import SectionTitle from "@/components/ui/SectionTitle";
import CampaignSummaryBar from "@/components/charts/CampaignSummaryBar";

export default function CampaignsDashboard({
  operatoriRows,
  dispatchRows,
  operatoriRowsOggi,
  dispatchRowsOggi,
  operators,
  campaigns
}: {
  operatoriRows: CsvRow[];
  dispatchRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  dispatchRowsOggi: CsvRow[];
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

  const operatoriRowsWithToday = useMemo(
    () => (includeToday ? [...operatoriRows, ...operatoriRowsOggi] : operatoriRows),
    [includeToday, operatoriRows, operatoriRowsOggi]
  );

  const dispatchRowsWithToday = useMemo(
    () => (includeToday ? [...dispatchRows, ...dispatchRowsOggi] : dispatchRows),
    [includeToday, dispatchRows, dispatchRowsOggi]
  );

  const operatoriFiltered = useMemo(
    () => applyFilters(operatoriRowsWithToday, filters),
    [operatoriRowsWithToday, filters]
  );

  const dispatchFiltered = useMemo(
    () => applyFilters(dispatchRowsWithToday, filters),
    [dispatchRowsWithToday, filters]
  );

  const operatoriNorm = useMemo(() => normalizeOperatori(operatoriFiltered), [operatoriFiltered]);
  const dispatchNorm = useMemo(() => normalizeDispatch(dispatchFiltered), [dispatchFiltered]);

  const campaignSummary = useMemo(
    () => aggregateByCampagna(operatoriNorm, dispatchNorm).slice(0, 12),
    [operatoriNorm, dispatchNorm]
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
    </div>
  );
}
