"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatInt, formatPct } from "@/lib/format";

export type FunnelStage = {
  label: string;
  value: number;
  color: string;
};

export default function FunnelStagesChart({
  stages,
  valueFormat = "int",
  barSize,
  showLabels = true
}: {
  stages: FunnelStage[];
  valueFormat?: "int" | "pct";
  barSize?: number;
  showLabels?: boolean;
}) {
  const formatValue = (v: string | number) =>
    valueFormat === "pct" ? formatPct(Number(v), 1) : formatInt(Number(v));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={stages}
        layout="vertical"
        margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          tick={{ fontSize: 12 }}
          tickFormatter={formatValue}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={showLabels ? 90 : 12}
          tick={showLabels ? { fontSize: 12 } : false}
          axisLine={true}
          tickLine={showLabels}
        />
        <Tooltip
          separator=": "
          labelFormatter={() => ""}
          formatter={(v: string | number, _name: string, item) => {
            const label = (item as { payload?: { label?: string } } | undefined)?.payload
              ?.label;
            return [formatValue(v), label ?? ""];
          }}
        />
        <Bar
          dataKey="value"
          isAnimationActive={false}
          barSize={barSize}
        >
          {stages.map((s) => (
            <Cell key={s.label} fill={s.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
