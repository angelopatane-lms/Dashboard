"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ScatterPoint } from "@/lib/analytics";
import { formatInt } from "@/lib/format";

export default function CorrelationScatter({
  data,
  xLabel,
  yLabel
}: {
  data: ScatterPoint[];
  xLabel: string;
  yLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          name={xLabel}
          tickFormatter={(v: string | number) => formatInt(Number(v))}
          label={{ value: xLabel, position: "insideBottom", offset: -4 }}
        />
        <YAxis
          dataKey="y"
          name={yLabel}
          tickFormatter={(v: string | number) => formatInt(Number(v))}
          label={{ value: yLabel, angle: -90, position: "insideLeft" }}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          formatter={(v: string | number, name: string) => [formatInt(Number(v)), name]}
          labelFormatter={() => ""}
        />
        <Scatter data={data} fill="#0ea5e9" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
