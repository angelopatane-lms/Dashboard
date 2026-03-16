"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { OperatorSummary } from "@/lib/analytics";
import { formatInt } from "@/lib/format";

export default function OperatorPerformanceBar({ data }: { data: OperatorSummary[] }) {
  const chartData = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        showUp: Math.max(0, row.appuntamenti - row.noShow)
      })),
    [data]
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ left: 28, right: 24, top: 8, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="operatore"
          interval={0}
          angle={-30}
          textAnchor="end"
          height={60}
          tickMargin={10}
          padding={{ left: 24, right: 24 }}
        />
        <YAxis tickFormatter={(v: string | number) => formatInt(Number(v))} />
        <Tooltip
          formatter={(v: string | number, name: string) => [formatInt(Number(v)), name]}
        />
        <Bar dataKey="assegnati" name="Assegnati" fill="#0ea5e9" />
        <Bar dataKey="connessioni" name="Connessioni" fill="#22c55e" />
        <Bar dataKey="appuntamenti" name="Appuntamenti" fill="#a855f7" />
        <Bar dataKey="noShow" name="No Show" fill="#ef4444" />
        <Bar dataKey="showUp" name="Show Up" fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  );
}
