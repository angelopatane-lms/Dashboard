"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TimeSeriesPoint } from "@/lib/analytics";
import { formatInt } from "@/lib/format";

export default function InsightSparklines({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
        <XAxis dataKey="bucket" hide />
        <YAxis hide />
        <Tooltip
          formatter={(v: string | number, name: string) => [formatInt(Number(v)), name]}
          labelFormatter={(label: string) => label}
        />
        <Line type="monotone" dataKey="assegnati" stroke="#0ea5e9" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="connessioni" stroke="#22c55e" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="appuntamenti" stroke="#a855f7" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
