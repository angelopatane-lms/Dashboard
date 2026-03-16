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

type Datum = {
  name: string;
  value: number;
  fill: string;
};

export default function DispatchEntryExitBar({
  entry,
  exit,
  emptyThresholdPct = 0.05
}: {
  entry: number;
  exit: number;
  emptyThresholdPct?: number;
}) {
  const total = entry + exit;
  const delta = entry - exit;
  const imbalancePct = total ? Math.abs(delta) / total : 0;
  const isEmpty = total > 0 && imbalancePct <= emptyThresholdPct;

  const data: Datum[] = [
    { name: "Dispatch Entry", value: entry, fill: "#f59e0b" },
    { name: "Dispatch Exit", value: exit, fill: "#64748b" }
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v: string | number) => formatInt(Number(v))}
        />
        <Tooltip
          formatter={(v: string | number, name: string) => {
            const n = Number(v);
            return [`${formatInt(n)} (${formatPct(total ? n / total : 0, 1)})`, name];
          }}
        />
        <Bar dataKey="value" isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
