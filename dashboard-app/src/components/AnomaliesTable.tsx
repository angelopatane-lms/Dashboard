import type { ZScoreAnomaly } from "@/lib/analytics";
import { formatFloat, formatInt } from "@/lib/format";

export default function AnomaliesTable({ items }: { items: ZScoreAnomaly[] }) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
        Nessuna anomalia rilevata (z-score ≥ 2).
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <th className="px-4 py-3">Chiave</th>
            <th className="px-4 py-3">Metrica</th>
            <th className="px-4 py-3">Valore</th>
            <th className="px-4 py-3">z</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.slice(0, 20).map((a) => (
            <tr key={`${a.metric}:${a.key}`}>
              <td className="px-4 py-3 text-slate-900">{a.key}</td>
              <td className="px-4 py-3 text-slate-700">{a.metric}</td>
              <td className="px-4 py-3 text-slate-700">{formatInt(a.value)}</td>
              <td className="px-4 py-3 text-slate-700">{formatFloat(a.z, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
