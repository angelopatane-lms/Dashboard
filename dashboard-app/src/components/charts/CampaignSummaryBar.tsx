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
import type { CampaignSummary } from "@/lib/analytics";
import { formatInt } from "@/lib/format";

export default function CampaignSummaryBar({ data }: { data: CampaignSummary[] }) {
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
      <BarChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 44 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="campagna" interval={0} angle={-45} textAnchor="end" height={64} />
        <YAxis tickFormatter={(v: string | number) => formatInt(Number(v))} />
        <Tooltip formatter={(v: string | number) => formatInt(Number(v))} />
        <Bar dataKey="assegnati" name="Assegnati" fill="#0ea5e9" />
        <Bar dataKey="connessioni" name="Connessioni" fill="#22c55e" />
        <Bar dataKey="appuntamenti" name="Appuntamenti" fill="#a855f7" />
        <Bar dataKey="noShow" name="No Show" fill="#ef4444" />
        <Bar dataKey="showUp" name="Show Up" fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  );
}
