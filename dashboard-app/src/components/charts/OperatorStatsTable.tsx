"use client";

import { useMemo } from "react";
import type { OperatorSummary } from "@/lib/analytics";
import { formatInt, formatPct } from "@/lib/format";

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

export default function OperatorStatsTable({ data }: { data: OperatorSummary[] }) {
  const totals = useMemo(() => {
    return data.reduce(
      (acc, r) => ({
        assegnati: acc.assegnati + r.assegnati,
        chiamate: acc.chiamate + r.chiamate,
        connessioni: acc.connessioni + r.connessioni,
        appuntamenti: acc.appuntamenti + r.appuntamenti,
        consulenze: acc.consulenze + r.consulenze,
        chiusure: acc.chiusure + r.chiusure,
        boom: acc.boom + r.boom
      }),
      { assegnati: 0, chiamate: 0, connessioni: 0, appuntamenti: 0, consulenze: 0, chiusure: 0, boom: 0 }
    );
  }, [data]);

  const maxValues = useMemo(
    () => ({
      assegnati: Math.max(...data.map((r) => r.assegnati), 1),
      chiamate: Math.max(...data.map((r) => r.chiamate), 1),
      connessioni: Math.max(...data.map((r) => r.connessioni), 1),
      appuntamenti: Math.max(...data.map((r) => r.appuntamenti), 1),
      consulenze: Math.max(...data.map((r) => r.consulenze), 1),
      chiusure: Math.max(...data.map((r) => r.chiusure), 1),
      boom: Math.max(...data.map((r) => r.boom), 1)
    }),
    [data]
  );

  const totalTp = tassoPresa(totals.appuntamenti, totals.connessioni);
  const totalTc = tassoChiusura(totals.chiusure, totals.consulenze);

  if (!data.length) return null;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 pl-0 text-left">Advisor</th>
            <th className="px-3 py-2">Assegnati</th>
            <th className="px-3 py-2">Chiamate</th>
            <th className="px-3 py-2">Risposte</th>
            <th className="px-3 py-2">Fissati</th>
            <th className="px-3 py-2">T. Presa Appt.</th>
            <th className="px-3 py-2">Processati</th>
            <th className="px-3 py-2">Chiusure</th>
            <th className="px-3 py-2">T. Chiusura</th>
            <th className="px-3 py-2">Boom €</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((r) => {
            const tp = tassoPresa(r.appuntamenti, r.connessioni);
            const tc = tassoChiusura(r.chiusure, r.consulenze);
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
                  style={{ background: heatBg(r.chiusure, maxValues.chiusure) }}
                >
                  {formatInt(r.chiusure)}
                </td>
                <td
                  className="px-3 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: rateBg(tc) }}
                >
                  {tc !== null ? formatPct(tc, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.boom, maxValues.boom) }}
                >
                  {formatInt(r.boom)}
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
