"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatPct } from "@/lib/format";

type Datum = {
  date: string;
  [campaign: string]: string | number | null;
};

const COLORS = ["#0ea5e9", "#22c55e", "#a855f7", "#f59e0b", "#ef4444"];

export default function CampaignConversionPeaksChart({
  data,
  campaigns,
  baselineByCampaign,
  visibleCampaigns
}: {
  data: Datum[];
  campaigns: string[];
  baselineByCampaign?: Record<string, number>;
  visibleCampaigns?: string[];
}) {
  const isDeltaMode = Boolean(baselineByCampaign);
  const campaignsToRender = visibleCampaigns !== undefined ? visibleCampaigns : campaigns;

  const chartData = useMemo(() => {
    if (!isDeltaMode || !baselineByCampaign) return data;

    return data.map((row) => {
      const next: Datum = { date: row.date };
      for (const c of campaigns) {
        const v = row[c];
        if (v === null || v === undefined || v === "") {
          next[c] = null;
          continue;
        }
        const n = Number(v);
        next[c] = Number.isFinite(n) ? n - (baselineByCampaign[c] ?? 0) : null;
      }
      return next;
    });
  }, [baselineByCampaign, campaigns, data, isDeltaMode]);

  const yDomain = useMemo(() => {
    if (!isDeltaMode) return [0, 1] as [number, number];
    if (campaignsToRender.length === 0) return [-0.05, 0.05] as [number, number];
    let maxAbs = 0;
    for (const row of chartData) {
      for (const c of campaignsToRender) {
        const v = row[c];
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n)) maxAbs = Math.max(maxAbs, Math.abs(n));
      }
    }
    const padded = Math.max(0.05, maxAbs * 1.15);
    return [-padded, padded] as [number, number];
  }, [campaignsToRender, chartData, isDeltaMode]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 10, bottom: 0 }}>
        {isDeltaMode && (
          <Customized
            component={({ yAxisMap, offset }: any) => {
              const axis = yAxisMap ? Object.values(yAxisMap)[0] : undefined;
              const scale = axis?.scale as ((v: number) => number) | undefined;
              if (!scale || !offset) return null;

              const y1 = offset.top;
              const y2 = offset.top + offset.height;
              const span = y2 - y1;
              if (!Number.isFinite(span) || span <= 0) return null;

              const zeroY = scale(0);
              const pct = ((zeroY - y1) / span) * 100;
              const clamped = Math.max(0, Math.min(100, pct));

              return (
                <defs>
                  <linearGradient
                    id="deltaSplit"
                    x1="0"
                    y1={y1}
                    x2="0"
                    y2={y2}
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="#16a34a" stopOpacity={1} />
                    <stop offset={`${clamped}%`} stopColor="#16a34a" stopOpacity={1} />
                    <stop offset={`${clamped}%`} stopColor="#e11d48" stopOpacity={1} />
                    <stop offset="100%" stopColor="#e11d48" stopOpacity={1} />
                  </linearGradient>
                </defs>
              );
            }}
          />
        )}
        <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={24} />
        <YAxis
          tick={isDeltaMode ? { fontSize: 12 } : false}
          width={44}
          domain={yDomain}
          ticks={isDeltaMode ? [0] : undefined}
          tickFormatter={(v: string | number) => {
            if (!isDeltaMode) return String(v);
            const n = Number(v);
            if (!Number.isFinite(n)) return "";
            return Math.abs(n) < 1e-12 ? "0" : "";
          }}
        />
        {isDeltaMode && <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />}
        <Tooltip
          formatter={(v: string | number, name: string) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return ["-", name];
            if (isDeltaMode) {
              const delta = `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}`;
              return [delta, name];
            }
            return [formatPct(n, 1), name];
          }}
          labelFormatter={(label: string) => label}
        />
        {campaignsToRender.map((c, idx) => (
          <Area
            key={c}
            type="monotone"
            dataKey={c}
            stroke={isDeltaMode ? "url(#deltaSplit)" : COLORS[idx % COLORS.length]}
            fill={isDeltaMode ? "url(#deltaSplit)" : COLORS[idx % COLORS.length]}
            baseValue={isDeltaMode ? 0 : undefined}
            fillOpacity={0.18}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
