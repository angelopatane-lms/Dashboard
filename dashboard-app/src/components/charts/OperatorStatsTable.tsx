"use client";

import { useMemo } from "react";
import type { OperatorSummary } from "@/lib/analytics";
import { formatInt, formatPct } from "@/lib/format";

function heatBg(value: number, max: number): string {
  if (max === 0 || value === 0) return "";
  const pct = Math.min(value / max, 1);
  return `rgba(20, 184, 166, ${(0.07 + pct * 0.3).toFixed(2)})`;
}

function rateBg(rate: number | null): string {
  if (rate === null || rate === 0) return "";
  const pct = Math.min(rate, 1);
  return `rgba(99, 102, 241, ${(0.08 + pct * 0.3).toFixed(2)})`;
}

function tassoPresa(appt: number, conn: number): number | null {
  return conn > 0 ? appt / conn : null;
}

function tassoChiusura(chius: number, cons: number): number | null {
  return cons > 0 ? chius / cons : null;
}

export default function OperatorStatsTable({
  data,
  hubspotOverrides
}: {
  data: OperatorSummary[];
  hubspotOverrides?: Record<string, { chiusure: number; boom: number }>;
}) {
  const effChiusure = (r: OperatorSummary) => hubspotOverrides?.[r.operatore]?.chiusure ?? r.chiusure;
  const effBoom = (r: OperatorSummary) => hubspotOverrides?.[r.operatore]?.boom ?? r.boom;

  const totals = useMemo(() => {
    return data.reduce(
      (acc, r) => ({
        assegnati: acc.assegnati + r.assegnati,
        chiamate: acc.chiamate + r.chiamate,
        connessioni: acc.connessioni + r.connessioni,
        appuntamenti: acc.appuntamenti + r.appuntamenti,
        consulenze: acc.consulenze + r.consulenze,
        chiusure: acc.chiusure + effChiusure(r),
        boom: acc.boom + effBoom(r)
      }),
      { assegnati: 0, chiamate: 0, connessioni: 0, appuntamenti: 0, consulenze: 0, chiusure: 0, boom: 0 }
    );
  }, [data, hubspotOverrides]);

  const maxValues = useMemo(
    () => ({
      assegnati: Math.max(...data.map((r) => r.assegnati), 1),
      chiamate: Math.max(...data.map((r) => r.chiamate), 1),
      connessioni: Math.max(...data.map((r) => r.connessioni), 1),
      appuntamenti: Math.max(...data.map((r) => r.appuntamenti), 1),
      consulenze: Math.max(...data.map((r) => r.consulenze), 1),
      chiusure: Math.max(...data.map((r) => effChiusure(r)), 1),
      boom: Math.max(...data.map((r) => effBoom(r)), 1)
    }),
    [data, hubspotOverrides]
  );

  const sorted = useMemo(
    () => [...data].sort((a, b) => effBoom(b) - effBoom(a) || b.appuntamenti - a.appuntamenti),
    [data, hubspotOverrides]
  );

  const totalTp = tassoPresa(totals.appuntamenti, totals.connessioni);
  const totalTc = tassoChiusura(totals.chiusure, totals.consulenze);

  if (!data.length) return null;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[#64748b] text-right text-xs font-semibold uppercase tracking-wide text-white">
            <th className="py-2 pr-4 pl-3 text-left">Advisor</th>
            <th className="px-3 py-2 whitespace-nowrap">Assegnati</th>
            <th className="px-3 py-2 whitespace-nowrap">Chiamate</th>
            <th className="px-3 py-2 whitespace-nowrap">Connessioni</th>
            <th className="px-3 py-2 whitespace-nowrap">Appuntamenti</th>
            <th className="px-3 py-2 whitespace-nowrap">% Appuntamento</th>
            <th className="px-3 py-2 whitespace-nowrap">Consulenze</th>
            <th className="px-3 py-2 whitespace-nowrap">Chiusure</th>
            <th className="px-3 py-2 whitespace-nowrap">% Chiusura</th>
            <th className="px-3 py-2 whitespace-nowrap">Boom</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((r) => {
            const tp = tassoPresa(r.appuntamenti, r.connessioni);
            const tc = tassoChiusura(effChiusure(r), r.consulenze);
            return (
              <tr key={r.operatore} className="hover:bg-slate-50 transition-colors">
                <td className="py-1.5 pr-4 pl-3 font-medium text-slate-800 whitespace-nowrap">
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
                  style={{ background: heatBg(r.appuntamenti, maxValues.appuntamenti) }}
                >
                  {formatInt(r.appuntamenti)}
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
                  style={{ background: heatBg(effChiusure(r), maxValues.chiusure) }}
                >
                  {formatInt(effChiusure(r))}
                </td>
                <td
                  className="px-3 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: rateBg(tc) }}
                >
                  {tc !== null ? formatPct(tc, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(effBoom(r), maxValues.boom) }}
                >
                  {formatInt(effBoom(r))}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-400 bg-slate-100 font-semibold text-slate-900">
            <td className="py-2 pr-4 pl-3 text-sm">Totale complessivo</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.assegnati)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.chiamate)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.connessioni)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.appuntamenti)}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {totalTp !== null ? formatPct(totalTp, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.consulenze)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.chiusure)}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {totalTc !== null ? formatPct(totalTc, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{formatInt(totals.boom)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
