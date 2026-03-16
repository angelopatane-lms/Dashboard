"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

export default function ReactivityGauge({
  value,
  max = 60,
  unit = "min",
  fillColor = "#0ea5e9"
}: {
  value: number;
  max?: number;
  unit?: string;
  fillColor?: string;
}) {
  const safeMax = max > 0 ? max : 60;
  const v = Math.max(0, Math.min(safeMax, value));

  const data = [{ name: "Latenza", value: v, fill: fillColor }];

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={data}
          innerRadius="74%"
          outerRadius="98%"
          startAngle={210}
          endAngle={-30}
        >
          <PolarAngleAxis type="number" domain={[0, safeMax]} tick={false} />
          <RadialBar dataKey="value" background />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[42px] font-semibold tracking-tight text-slate-900">{Math.round(v)}</div>
        <div className="text-sm font-medium text-slate-500">{unit}</div>
      </div>
      <div className="pointer-events-none absolute top-[74%] left-[24.2%] -translate-x-1/2 -translate-y-1/2 text-xs font-medium text-slate-500">
        0
      </div>
      <div className="pointer-events-none absolute top-[74%] right-[23.8%] translate-x-1/2 -translate-y-1/2 text-xs font-medium text-slate-500">
        {safeMax}
      </div>
    </div>
  );
}
