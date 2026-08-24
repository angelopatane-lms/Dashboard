"use client";

import { useRef, type RefObject } from "react";
import type { Filters } from "@/lib/metrics";

export function FiltersBar({
  filters,
  setFilters,
  operators = [],
  campaigns = [],
  vendite,
  prodotti,
  operatorLabel = "Operatore"
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
  operators?: string[];
  campaigns?: string[];
  vendite?: Array<{ label: string; value: string }>;
  prodotti?: Array<{ label: string; value: string }>;
  operatorLabel?: string;
}) {
  const hasExtra = vendite !== undefined || prodotti !== undefined;
  const fromRef = useRef<HTMLInputElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);

  const controlClassName = (isActive: boolean) =>
    `mt-1 w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none transition ${
      isActive
        ? "border-slate-700 bg-black text-white focus:border-slate-200 focus:ring-2 focus:ring-slate-200/20"
        : "border-slate-200 bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
    }`;

  const dateControlClassName = (isActive: boolean) =>
    isActive
      ? `${controlClassName(true)} pr-9 filter-date-dark hide-native-picker`
      : controlClassName(false);

  const openDatePicker = (ref: RefObject<HTMLInputElement | null>) => {
    const el = ref.current;
    if (!el) return;
    const anyEl = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof anyEl.showPicker === "function") anyEl.showPicker();
    else el.focus();
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${hasExtra ? "lg:grid-cols-6" : "lg:grid-cols-4"}`}>
        <div>
          <label className="text-xs font-medium text-slate-600">Da</label>
          <div className="relative">
            <input
              ref={fromRef}
              type="date"
              className={dateControlClassName(Boolean(filters.from && filters.from.trim()))}
              value={filters.from ?? ""}
              onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
            />
            {Boolean(filters.from && filters.from.trim()) && (
              <button
                type="button"
                onClick={() => openDatePicker(fromRef)}
                className="absolute inset-y-0 right-2 my-auto h-6 w-6 rounded-md text-white/90 hover:text-white"
                aria-label="Apri calendario"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M7 3v2M17 3v2M4 7h16M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">A</label>
          <div className="relative">
            <input
              ref={toRef}
              type="date"
              className={dateControlClassName(Boolean(filters.to && filters.to.trim()))}
              value={filters.to ?? ""}
              onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
            />
            {Boolean(filters.to && filters.to.trim()) && (
              <button
                type="button"
                onClick={() => openDatePicker(toRef)}
                className="absolute inset-y-0 right-2 my-auto h-6 w-6 rounded-md text-white/90 hover:text-white"
                aria-label="Apri calendario"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M7 3v2M17 3v2M4 7h16M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">{operatorLabel}</label>
          <select
            className={controlClassName(Boolean(filters.operatore && filters.operatore.trim()))}
            value={filters.operatore ?? ""}
            onChange={(e) =>
              setFilters({ ...filters, operatore: e.target.value || undefined })
            }
          >
            <option value="">Tutti</option>
            {(operators ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Campagna</label>
          <select
            className={controlClassName(Boolean(filters.campagna && filters.campagna.trim()))}
            value={filters.campagna ?? ""}
            onChange={(e) => setFilters({ ...filters, campagna: e.target.value || undefined })}
          >
            <option value="">Tutte</option>
            {(campaigns ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {vendite !== undefined && (
          <div>
            <label className="text-xs font-medium text-slate-600">Tipologia</label>
            <select
              className={controlClassName(Boolean(filters.vendita && filters.vendita.trim()))}
              value={filters.vendita ?? ""}
              onChange={(e) => setFilters({ ...filters, vendita: e.target.value || undefined })}
            >
              <option value="">Tutte</option>
              {vendite.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {prodotti !== undefined && (
          <div>
            <label className="text-xs font-medium text-slate-600">Prodotto</label>
            <select
              className={controlClassName(Boolean(filters.prodotto && filters.prodotto.trim()))}
              value={filters.prodotto ?? ""}
              onChange={(e) => setFilters({ ...filters, prodotto: e.target.value || undefined })}
            >
              <option value="">Tutti</option>
              {prodotti.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
