"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatInt, formatPct } from "@/lib/format";

type Slice = {
  name: string;
  value: number;
  fill: string;
};

export default function DispatchDonutChart({
  dispatchSi,
  dispatchNo,
  serieA,
  serieB,
  proprietario,
  showSiNo = true
}: {
  dispatchSi: number;
  dispatchNo: number;
  serieA: number;
  serieB: number;
  proprietario: number;
  showSiNo?: boolean;
}) {
  const totalDispatch = dispatchSi + dispatchNo;

  const siNo: Slice[] = [
    { name: "Dispatch Sì", value: dispatchSi, fill: "#34d399" },
    { name: "Dispatch No", value: dispatchNo, fill: "#fb7185" }
  ];

  const qualityTotal = serieA + serieB + proprietario;
  const quality: Slice[] = [
    { name: "Serie A", value: serieA, fill: "#f59e0b" },
    { name: "Serie B", value: serieB, fill: "#a855f7" },
    { name: "Proprietario", value: proprietario, fill: "#64748b" }
  ];

  const qualityInnerRadius = showSiNo ? 34 : "55%";
  const qualityOuterRadius = showSiNo ? 58 : "85%";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip
          formatter={(v: string | number, name: string) => {
            const n = Number(v);
            const base = name.includes("Serie") || name === "Proprietario" ? qualityTotal : totalDispatch;
            return [`${formatInt(n)} (${formatPct(base ? n / base : 0, 1)})`, name];
          }}
        />

        {showSiNo ? (
          <Pie
            data={siNo}
            dataKey="value"
            nameKey="name"
            cx="28%"
            cy="50%"
            innerRadius={34}
            outerRadius={58}
            paddingAngle={2}
            isAnimationActive={false}
          >
            {siNo.map((s) => (
              <Cell key={s.name} fill={s.fill} />
            ))}
          </Pie>
        ) : null}
        <Pie
          data={quality}
          dataKey="value"
          nameKey="name"
          cx={showSiNo ? "74%" : "50%"}
          cy="50%"
          innerRadius={qualityInnerRadius}
          outerRadius={qualityOuterRadius}
          paddingAngle={2}
          isAnimationActive={false}
        >
          {quality.map((s) => (
            <Cell key={s.name} fill={s.fill} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
