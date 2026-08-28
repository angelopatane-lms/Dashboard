"use client";

import { useMemo } from "react";
import type { OperatorSummary } from "@/lib/analytics";
import { formatInt, formatPct, formatEur } from "@/lib/format";

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

function tassoPresa(appt: number, conn: number): number | null {
  return conn > 0 ? appt / conn : null;
}

function tassoChiusura(chius: number, cons: number): number | null {
  return cons > 0 ? chius / cons : null;
}

export default function OperatorStatsTable({
  data,
  hubspotOverrides,
  trattativeOverrides,
  precomputedTotals,
  hubspotLoading,
  trattativeLoading,
  hubspotFiltered = false,
  operatorLabel = "Advisor"
}: {
  data: OperatorSummary[];
  hubspotOverrides?: Record<string, { chiusure: number; boom: number }>;
  trattativeOverrides?: Record<string, number>;
  precomputedTotals?: { chiusure: number; boom: number };
  hubspotLoading?: boolean;
  trattativeLoading?: boolean;
  hubspotFiltered?: boolean;
  operatorLabel?: string;
}) {
  const effChiusure = (r: OperatorSummary) =>
    hubspotOverrides?.[r.operatore]?.chiusure ?? (hubspotFiltered ? 0 : r.chiusure);
  const effBoom = (r: OperatorSummary) =>
    hubspotOverrides?.[r.operatore]?.boom ?? (hubspotFiltered ? 0 : r.boom);
  const effAppuntamenti = (r: OperatorSummary) =>
    trattativeOverrides !== undefined
      ? (trattativeOverrides[r.operatore] ?? 0)
      : r.appuntamenti;

  const totals = useMemo(() => {
    const base = data.reduce(
      (acc, r) => ({
        assegnati: acc.assegnati + r.assegnati,
        chiamate: acc.chiamate + r.chiamate,
        connessioni: acc.connessioni + r.connessioni,
        appuntamenti: acc.appuntamenti + effAppuntamenti(r),
        consulenze: acc.consulenze + r.consulenze,
        chiusure: acc.chiusure + effChiusure(r),
        boom: acc.boom + effBoom(r)
      }),
      { assegnati: 0, chiamate: 0, connessioni: 0, appuntamenti: 0, consulenze: 0, chiusure: 0, boom: 0 }
    );
    return {
      ...base,
      chiusure: precomputedTotals?.chiusure ?? base.chiusure,
      boom: precomputedTotals?.boom ?? base.boom
    };
  }, [data, hubspotOverrides, trattativeOverrides, precomputedTotals]);

  const maxValues = useMemo(
    () => ({
      assegnati: Math.max(...data.map((r) => r.assegnati), 1),
      chiamate: Math.max(...data.map((r) => r.chiamate), 1),
      connessioni: Math.max(...data.map((r) => r.connessioni), 1),
      appuntamenti: Math.max(...data.map((r) => effAppuntamenti(r)), 1),
      consulenze: Math.max(...data.map((r) => r.consulenze), 1),
      chiusure: Math.max(...data.map((r) => effChiusure(r)), 1),
      boom: Math.max(...data.map((r) => effBoom(r)), 1)
    }),
    [data, hubspotOverrides, trattativeOverrides]
  );

  const sorted = useMemo(
    () => [...data].sort((a, b) => effBoom(b) - effBoom(a) || effAppuntamenti(b) - effAppuntamenti(a)),
    [data, hubspotOverrides, trattativeOverrides]
  );

  const totalTp = tassoPresa(totals.appuntamenti, totals.connessioni);
  const totalTc = tassoChiusura(totals.chiusure, totals.consulenze);

  if (!data.length) return null;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 pl-0 text-left">{operatorLabel}</th>
            <th className="px-3 py-2">Assegnati</th>
            <th className="px-3 py-2">Chiamate</th>
            <th className="px-3 py-2">Connessioni</th>
            <th className="px-3 py-2">Appuntamenti</th>
            <th className="px-3 py-2">% Appuntamento</th>
            <th className="px-3 py-2">Consulenze</th>
            <th className="px-3 py-2">Chiusure</th>
            <th className="px-3 py-2">% Chiusura</th>
            <th className="px-3 py-2">Boom</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((r) => {
            const tp = tassoPresa(effAppuntamenti(r), r.connessioni);
            const tc = tassoChiusura(effChiusure(r), r.consulenze);
            return (
              <tr key={r.operatore} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-1.5 pr-4 pl-0 font-medium text-slate-800 whitespace-nowrap">
                  {r.operatore}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.assegnati, maxValues.assegnati) }}
                >
                  {formatInt(r.assegnati)}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.chiamate, maxValues.chiamate) }}
                >
                  {formatInt(r.chiamate)}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.connessioni, maxValues.connessioni) }}
                >
                  {formatInt(r.connessioni)}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: trattativeLoading ? undefined : heatBg(effAppuntamenti(r), maxValues.appuntamenti) }}
                >
                  {trattativeLoading ? <span className="text-slate-400">–</span> : formatInt(effAppuntamenti(r))}
                </td>
                <td
                  className="px-3 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: rateBg(tp) }}
                >
                  {tp !== null ? formatPct(tp, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.consulenze, maxValues.consulenze) }}
                >
                  {formatInt(r.consulenze)}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: hubspotLoading ? undefined : heatBg(effChiusure(r), maxValues.chiusure) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : formatInt(effChiusure(r))}
                </td>
                <td
                  className="px-3 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: hubspotLoading ? undefined : rateBg(tc) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : tc !== null ? formatPct(tc, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: hubspotLoading ? undefined : heatBg(effBoom(r), maxValues.boom) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : formatEur(effBoom(r))}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
            <td className="py-2 pr-4 pl-0 text-sm">Totale complessivo</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.assegnati)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.chiamate)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.connessioni)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{trattativeLoading ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.appuntamenti)}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {trattativeLoading ? <span className="font-normal text-slate-400">–</span> : totalTp !== null ? formatPct(totalTp, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.consulenze)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{hubspotLoading ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.chiusure)}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {hubspotLoading ? <span className="font-normal text-slate-400">–</span> : totalTc !== null ? formatPct(totalTc, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{hubspotLoading ? <span className="font-normal text-slate-400">–</span> : formatEur(totals.boom)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
