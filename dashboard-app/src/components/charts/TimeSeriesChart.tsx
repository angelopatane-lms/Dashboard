"use client";

import {
  Area,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TimeSeriesPoint } from "@/lib/analytics";
import { formatInt } from "@/lib/format";

export type TrendSeriesKey = "assegnati" | "connessioni" | "appuntamenti" | "consulenze" | "chiusure" | "boom";

const SERIES: Array<{ key: TrendSeriesKey; label: string; color: string }> = [
  { key: "assegnati", label: "Assegnati", color: "#0ea5e9" },
  { key: "connessioni", label: "Connessioni", color: "#22c55e" },
  { key: "appuntamenti", label: "Appuntamenti", color: "#a855f7" },
  { key: "consulenze", label: "Consulenze", color: "#f59e0b" },
  { key: "chiusure", label: "Chiusure", color: "#ef4444" },
  { key: "boom", label: "Boom", color: "#14b8a6" }
];

export default function TimeSeriesChart({
  data,
  visibleKeys
}: {
  data: TimeSeriesPoint[];
  visibleKeys?: TrendSeriesKey[];
}) {
  const visible = new Set<TrendSeriesKey>(visibleKeys ?? SERIES.map((s) => s.key));
  const visibleSeries = SERIES.filter((s) => visible.has(s.key));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
        <defs>
          {visibleSeries.map((s) => (
            <linearGradient key={s.key} id={`trendFill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v: string | number) => formatInt(Number(v))}
        />
        <Tooltip
          content={({ active, label, payload }) => {
            if (!active || !payload || !payload.length) return null;

            const seen = new Set<string>();
            const items = payload.filter((p) => {
              const key = (p.dataKey ?? p.name ?? "").toString();
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });

            return (
              <div className="rounded-md border border-slate-200 bg-white p-2 text-xs shadow-sm">
                <div className="mb-1 font-semibold text-slate-900">{String(label)}</div>
                {items.map((p) => (
                  <div key={(p.dataKey ?? p.name ?? "").toString()} className="flex items-center justify-between gap-3">
                    <div className="text-slate-600">{String(p.name ?? p.dataKey)}</div>
                    <div className="font-semibold text-slate-900">{formatInt(Number(p.value ?? 0))}</div>
                  </div>
                ))}
              </div>
            );
          }}
        />
        {visibleSeries.map((s) => (
          <Area
            key={`${s.key}-area`}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke="none"
            fill={`url(#trendFill-${s.key})`}
            isAnimationActive={false}
          />
        ))}
        {visibleSeries.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
