"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { DispatchSummary } from "@/lib/analytics";
import { formatInt } from "@/lib/format";

export default function DispatchQualityBar({ data }: { data: DispatchSummary[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 18, right: 16, top: 8, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="operatore"
          interval={0}
          angle={-30}
          textAnchor="end"
          tickMargin={10}
          height={64}
        />
        <YAxis tickFormatter={(v: string | number) => formatInt(Number(v))} />
        <Tooltip
          formatter={(v: string | number) => formatInt(Number(v))}
          itemSorter={(item) => {
            const key = (item.dataKey ?? "").toString();
            if (key === "serieA") return 0;
            if (key === "serieB") return 1;
            if (key === "proprietario") return 2;
            return 99;
          }}
        />
        <Bar dataKey="serieA" name="Serie A" fill="#f59e0b" />
        <Bar dataKey="serieB" name="Serie B" fill="#8b5cf6" />
        <Bar dataKey="proprietario" name="Proprietario" fill="#64748b" />
      </BarChart>
    </ResponsiveContainer>
  );
}
