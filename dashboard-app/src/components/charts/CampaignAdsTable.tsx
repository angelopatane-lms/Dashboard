"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import type { CampaignSummary } from "@/lib/analytics";
import { formatInt, formatEur, formatPct, formatFloat } from "@/lib/format";

/**
 * Dati "Ads" per campagna e Categoria di raggruppamento.
 *
 * Fonti (tutte reali da settembre 2026):
 * - Spesa      -> foglio Google "Report_Storico_AAAA-MM", via /api/campaign-ads
 * - Lead       -> cronologia HubSpot id_campagna_refresh salvata su Postgres,
 *                 via /api/campaign-conversions
 * - Categoria  -> dedotta dal nome campagna (guessCategoria)
 * - Funnel     -> CampaignSummary dal foglio Operatori (Risposte=Connessioni,
 *                 Fissati=Appuntamenti, Processati=Consulenze, Importo=Boom)
 */
export type CampaignAdsRow = {
  categoria: string;
  campagna: string;
  spesa: number;
  /** Tutte le conversioni del periodo, ripetizioni della stessa persona incluse. */
  leadGenerati: number;
  /** Persone con UNA SOLA conversione in tutta la loro storia: si iscrivono
   *  qui e non tornano piu'. Appena si riconvertono altrove smettono di
   *  contare, quindi il valore di un periodo passato cala nel tempo. */
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

function heatBg(value: number, max: number): string {
  if (max === 0 || value === 0) return "";
  const pct = Math.min(value / max, 1);
  return `rgba(14, 165, 233, ${(0.08 + pct * 0.35).toFixed(2)})`;
}

function rateBg(rate: number | null): string {
  if (rate === null || rate === 0) return "";
  const pct = Math.min(rate, 1);
  return `rgba(245, 158, 11, ${(0.1 + pct * 0.45).toFixed(2)})`;
}

type MaxValues = {
  spesa: number;
  leadGenerati: number;
  cplGenerati: number;
  leadUnici: number;
  cplUnici: number;
  risposte: number;
  fissati: number;
  processati: number;
  cpas: number;
  chiusure: number;
  importo: number;
  cpa: number;
  roas: number;
};

function fmtPct(v: number | null): ReactNode {
  return v !== null ? formatPct(v, 1) : <span className="text-slate-400">–</span>;
}

function fmtEur(v: number | null, digits = 0): ReactNode {
  return v !== null ? formatEur(v, digits) : <span className="text-slate-400">–</span>;
}

const HEADERS = [
  "Spesa",
  "Lead Generati",
  "CPL Generati",
  "Lead Unici",
  "CPL Unici",
  "Connessioni",
  "Appuntamenti",
  "% Appuntamenti",
  "Consulenze",
  "CPAS",
  "% Appuntamento",
  "% Show Up",
  "Chiusure",
  "Importo",
  "CR Sales",
  "CPA",
  "ROAS"
];

function MetricCells({ m, max }: { m: DerivedMetrics; max: MaxValues }) {
  return (
    <>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.spesa, max.spesa) }}>
        {fmtEur(m.spesa)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.leadGenerati, max.leadGenerati) }}>
        {formatInt(m.leadGenerati)}
      </td>
      <td
        className="px-3 py-1.5 text-right tabular-nums"
        style={{ background: m.cplGenerati !== null ? heatBg(m.cplGenerati, max.cplGenerati) : undefined }}
      >
        {fmtEur(m.cplGenerati, 2)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.leadUnici, max.leadUnici) }}>
        {formatInt(m.leadUnici)}
      </td>
      <td
        className="px-3 py-1.5 text-right tabular-nums"
        style={{ background: m.cplUnici !== null ? heatBg(m.cplUnici, max.cplUnici) : undefined }}
      >
        {fmtEur(m.cplUnici, 2)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.risposte, max.risposte) }}>
        {formatInt(m.risposte)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.fissati, max.fissati) }}>
        {formatInt(m.fissati)}
      </td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.pctAppFissati) }}>
        {fmtPct(m.pctAppFissati)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.processati, max.processati) }}>
        {formatInt(m.processati)}
      </td>
      <td
        className="px-3 py-1.5 text-right tabular-nums"
        style={{ background: m.cpas !== null ? heatBg(m.cpas, max.cpas) : undefined }}
      >
        {fmtEur(m.cpas, 2)}
      </td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.pctAppSvolti) }}>
        {fmtPct(m.pctAppSvolti)}
      </td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.pctShowUp) }}>
        {fmtPct(m.pctShowUp)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.chiusure, max.chiusure) }}>
        {formatInt(m.chiusure)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.importo, max.importo) }}>
        {fmtEur(m.importo)}
      </td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.crSales) }}>
        {fmtPct(m.crSales)}
      </td>
      <td
        className="px-3 py-1.5 text-right tabular-nums"
        style={{ background: m.cpa !== null ? heatBg(m.cpa, max.cpa) : undefined }}
      >
        {fmtEur(m.cpa, 2)}
      </td>
      <td
        className="px-3 py-1.5 text-right font-semibold tabular-nums"
        style={{ background: m.roas !== null ? heatBg(m.roas, max.roas) : undefined }}
      >
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
    const list = Array.from(byCategoria.entries()).map(([categoria, rows]) => ({
      categoria,
      rows,
      totale: rows.reduce((acc, r) => addRaw(acc, r.raw), emptyRaw)
    }));

    const isAltroONessuna = (categoria: string) => {
      const c = categoria.trim().toLowerCase();
      return c === "altro" || c === "nessuna";
    };

    return list.sort((a, b) => {
      const aLast = isAltroONessuna(a.categoria);
      const bLast = isAltroONessuna(b.categoria);
      if (aLast !== bLast) return aLast ? 1 : -1;
      return b.totale.spesa - a.totale.spesa;
    });
  }, [adsRows, summaryByCampagna]);

  const grandTotal = useMemo(
    () => groups.reduce((acc, g) => addRaw(acc, g.totale), emptyRaw),
    [groups]
  );

  const maxValues = useMemo<MaxValues>(() => {
    const rowMetrics = groups.flatMap((g) => g.rows.map((r) => deriveMetrics(r.raw)));
    const maxOf = (values: Array<number | null>) =>
      Math.max(...values.map((v) => v ?? 0), 1);
    return {
      spesa: maxOf(rowMetrics.map((m) => m.spesa)),
      leadGenerati: maxOf(rowMetrics.map((m) => m.leadGenerati)),
      cplGenerati: maxOf(rowMetrics.map((m) => m.cplGenerati)),
      leadUnici: maxOf(rowMetrics.map((m) => m.leadUnici)),
      cplUnici: maxOf(rowMetrics.map((m) => m.cplUnici)),
      risposte: maxOf(rowMetrics.map((m) => m.risposte)),
      fissati: maxOf(rowMetrics.map((m) => m.fissati)),
      processati: maxOf(rowMetrics.map((m) => m.processati)),
      cpas: maxOf(rowMetrics.map((m) => m.cpas)),
      chiusure: maxOf(rowMetrics.map((m) => m.chiusure)),
      importo: maxOf(rowMetrics.map((m) => m.importo)),
      cpa: maxOf(rowMetrics.map((m) => m.cpa)),
      roas: maxOf(rowMetrics.map((m) => m.roas))
    };
  }, [groups]);

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
          {groups.map((g, groupIdx) => (
            <Fragment key={g.categoria}>
              {g.rows.map((r, idx) => (
                <tr key={`${g.categoria}-${r.campagna}`} className="hover:bg-slate-50/70 transition-colors">
                  {idx === 0 ? (
                    <td
                      className="py-1.5 pr-4 pl-0 align-top font-semibold text-slate-800 whitespace-nowrap"
                      rowSpan={g.rows.length}
                    >
                      {g.categoria}
                    </td>
                  ) : null}
                  <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap" title={r.campagna}>
                    {r.campagna}
                  </td>
                  <MetricCells m={deriveMetrics(r.raw)} max={maxValues} />
                </tr>
              ))}
              {groupIdx < groups.length - 1 ? (
                <tr key={`${g.categoria}-spacer`} className="bg-white">
                  <td className="h-3 p-0 border-0" colSpan={2 + HEADERS.length} />
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900">
            <td className="py-2 pr-4 pl-0" colSpan={2}>
              Totale
            </td>
            <MetricCells m={deriveMetrics(grandTotal)} max={maxValues} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
