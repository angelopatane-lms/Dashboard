"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import type { CampaignSummary } from "@/lib/analytics";
import { formatInt, formatEur, formatPct, formatFloat } from "@/lib/format";

/**
 * Dati "Ads" per campagna (Spesa, Lead Generati, Lead Unici) e la relativa
 * Categoria di raggruppamento (es. COACH, IA, ...).
 *
 * TODO: oggi non esiste una fonte dati per Spesa/Lead/Categoria: questi valori
 * andranno collegati a un nuovo tab Google Sheet (o altra fonte Ads) con
 * colonne Categoria, Campagna, Spesa, Lead Generati, Lead Unici, joinate per
 * nome campagna con `CampaignSummary` (che fornisce gia' Risposte=Connessioni,
 * Fissati=Appuntamenti, Processati=Consulenze, Chiusure e Importo=Boom).
 */
export type CampaignAdsRow = {
  categoria: string;
  campagna: string;
  spesa: number;
  leadGenerati: number;
  leadUnici: number;
};

type RawTotals = {
  spesa: number;
  leadGenerati: number;
  leadUnici: number;
  risposte: number;
  fissati: number;
  processati: number;
  noShow: number;
  chiusure: number;
  importo: number;
};

type DerivedMetrics = RawTotals & {
  cplGenerati: number | null;
  cplUnici: number | null;
  pctAppFissati: number | null;
  cpas: number | null;
  pctAppSvolti: number | null;
  pctShowUp: number | null;
  crSales: number | null;
  cpa: number | null;
  roas: number | null;
};

const emptyRaw: RawTotals = {
  spesa: 0,
  leadGenerati: 0,
  leadUnici: 0,
  risposte: 0,
  fissati: 0,
  processati: 0,
  noShow: 0,
  chiusure: 0,
  importo: 0
};

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function toRaw(ads: CampaignAdsRow, summary?: CampaignSummary): RawTotals {
  return {
    spesa: ads.spesa,
    leadGenerati: ads.leadGenerati,
    leadUnici: ads.leadUnici,
    risposte: summary?.connessioni ?? 0,
    fissati: summary?.appuntamenti ?? 0,
    processati: summary?.consulenze ?? 0,
    noShow: summary?.noShow ?? 0,
    chiusure: summary?.chiusure ?? 0,
    importo: summary?.boom ?? 0
  };
}

function addRaw(a: RawTotals, b: RawTotals): RawTotals {
  return {
    spesa: a.spesa + b.spesa,
    leadGenerati: a.leadGenerati + b.leadGenerati,
    leadUnici: a.leadUnici + b.leadUnici,
    risposte: a.risposte + b.risposte,
    fissati: a.fissati + b.fissati,
    processati: a.processati + b.processati,
    noShow: a.noShow + b.noShow,
    chiusure: a.chiusure + b.chiusure,
    importo: a.importo + b.importo
  };
}

function div(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function deriveMetrics(raw: RawTotals): DerivedMetrics {
  return {
    ...raw,
    cplGenerati: div(raw.spesa, raw.leadGenerati),
    cplUnici: div(raw.spesa, raw.leadUnici),
    pctAppFissati: div(raw.fissati, raw.risposte),
    cpas: div(raw.spesa, raw.processati),
    pctAppSvolti: div(raw.processati, raw.fissati),
    pctShowUp: div(raw.noShow, raw.processati),
    crSales: div(raw.chiusure, raw.processati),
    cpa: div(raw.spesa, raw.chiusure),
    roas: div(raw.importo, raw.spesa)
  };
}

function fmtPct(v: number | null): ReactNode {
  return v !== null ? formatPct(v, 1) : <span className="text-slate-400">–</span>;
}

function fmtEur(v: number | null, digits = 0): ReactNode {
  return v !== null ? formatEur(v, digits) : <span className="text-slate-400">–</span>;
}

const HEADERS = [
  "Spesa",
  "L. Generati",
  "CPL Gen.",
  "L. Unici",
  "CPL Unici",
  "Risposte",
  "Fissati",
  "% App Fissati",
  "Processati",
  "CPAS",
  "% App Svolti",
  "% Show Up",
  "Chiusure",
  "Importo",
  "CR Sales",
  "CPA",
  "ROAS"
];

function MetricCells({ m }: { m: DerivedMetrics }) {
  return (
    <>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtEur(m.spesa)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(m.leadGenerati)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtEur(m.cplGenerati, 2)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(m.leadUnici)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtEur(m.cplUnici, 2)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(m.risposte)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(m.fissati)}</td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtPct(m.pctAppFissati)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(m.processati)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtEur(m.cpas, 2)}</td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtPct(m.pctAppSvolti)}</td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtPct(m.pctShowUp)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(m.chiusure)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtEur(m.importo)}</td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtPct(m.crSales)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtEur(m.cpa, 2)}</td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
        {m.roas !== null ? `${formatFloat(m.roas, 2)}x` : <span className="text-slate-400">–</span>}
      </td>
    </>
  );
}

export default function CampaignAdsTable({
  adsRows,
  campaignSummary
}: {
  adsRows: CampaignAdsRow[];
  campaignSummary: CampaignSummary[];
}) {
  const summaryByCampagna = useMemo(() => {
    const map = new Map<string, CampaignSummary>();
    for (const s of campaignSummary) map.set(normKey(s.campagna), s);
    return map;
  }, [campaignSummary]);

  const groups = useMemo(() => {
    const byCategoria = new Map<string, { campagna: string; raw: RawTotals }[]>();
    for (const ads of adsRows) {
      const raw = toRaw(ads, summaryByCampagna.get(normKey(ads.campagna)));
      const list = byCategoria.get(ads.categoria) ?? [];
      list.push({ campagna: ads.campagna, raw });
      byCategoria.set(ads.categoria, list);
    }
    return Array.from(byCategoria.entries()).map(([categoria, rows]) => ({
      categoria,
      rows,
      totale: rows.reduce((acc, r) => addRaw(acc, r.raw), emptyRaw)
    }));
  }, [adsRows, summaryByCampagna]);

  const grandTotal = useMemo(
    () => groups.reduce((acc, g) => addRaw(acc, g.totale), emptyRaw),
    [groups]
  );

  if (!adsRows.length) return null;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 pl-0 text-left">Categoria</th>
            <th className="px-3 py-2 text-left">Campagna</th>
            {HEADERS.map((h) => (
              <th key={h} className="px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {groups.map((g) => (
            <Fragment key={g.categoria}>
              {g.rows.map((r, idx) => (
                <tr key={`${g.categoria}-${r.campagna}`} className="hover:bg-slate-50/70 transition-colors">
                  {idx === 0 ? (
                    <td
                      className="py-1.5 pr-4 pl-0 align-top font-semibold text-slate-800 whitespace-nowrap"
                      rowSpan={g.rows.length + 1}
                    >
                      {g.categoria}
                    </td>
                  ) : null}
                  <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap" title={r.campagna}>
                    {r.campagna}
                  </td>
                  <MetricCells m={deriveMetrics(r.raw)} />
                </tr>
              ))}
              <tr key={`${g.categoria}-totale`} className="bg-slate-50 font-semibold text-slate-900">
                <td className="px-3 py-1.5">Totale</td>
                <MetricCells m={deriveMetrics(g.totale)} />
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900">
            <td className="py-2 pr-4 pl-0" colSpan={2}>
              Totale complessivo
            </td>
            <MetricCells m={deriveMetrics(grandTotal)} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
