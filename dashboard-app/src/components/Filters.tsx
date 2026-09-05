"use client";

import { Fragment, useRef, type MutableRefObject, type ReactNode } from "react";
import type { Filters } from "@/lib/metrics";
import { VARIANTE_DEFAULT } from "@/lib/campagne";

export function FiltersBar({
  filters,
  setFilters,
  operators = [],
  campaigns = [],
  vendite,
  prodotti,
  operatorLabel = "Operatore",
  campaignLabel = "Campagna",
  tipologie,
  tipologiaLabel = "Tipologia",
  varianti,
  varianteLabel = "Variante"
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
  operators?: string[];
  campaigns?: string[];
  vendite?: Array<{ label: string; value: string }>;
  prodotti?: Array<{ label: string; value: string }>;
  operatorLabel?: string;
  /** La pagina Campagne lo chiama "Categoria": li' il menu elenca le categorie
   *  (DIV COACH, REM, MBE...), non i nomi delle campagne. */
  campaignLabel?: string;
  /** Se presente, al posto del menu Operatore compare questo. Serve alla pagina
   *  Campagne, dove filtrare per operatore non ha significato: le righe sono
   *  campagne, non persone. */
  tipologie?: Array<{ label: string; value: string }>;
  tipologiaLabel?: string;
  /** Se presente, compare il menu delle varianti. A differenza degli altri non
   *  ha una voce vuota: "Tutte" e' gia' una delle opzioni. */
  varianti?: Array<{ label: string; value: string }>;
  varianteLabel?: string;
}) {
  // Le classi di Tailwind vanno scritte per intero: costruirle concatenando
  // ("lg:grid-cols-" + n) le renderebbe invisibili al compilatore, e la barra
  // resterebbe a una colonna sola sugli schermi larghi.
  const colonne = varianti ? 5 : 4 + (vendite !== undefined ? 1 : 0) + (prodotti !== undefined ? 1 : 0);
  const classeColonne =
    colonne >= 7 ? "lg:grid-cols-7" : colonne === 6 ? "lg:grid-cols-6" : colonne === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4";
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

  const openDatePicker = (ref: MutableRefObject<HTMLInputElement | null>) => {
    const el = ref.current;
    if (!el) return;
    const anyEl = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof anyEl.showPicker === "function") anyEl.showPicker();
    else el.focus();
  };

  const campoData = (
    etichetta: string,
    valore: string,
    ref: MutableRefObject<HTMLInputElement | null>,
    onChange: (v: string | undefined) => void
  ) => (
    <div>
      <label className="text-xs font-medium text-slate-600">{etichetta}</label>
      <div className="relative">
        <input
          ref={ref}
          type="date"
          className={dateControlClassName(Boolean(valore && valore.trim()))}
          value={valore}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {Boolean(valore && valore.trim()) && (
          <button
            type="button"
            onClick={() => openDatePicker(ref)}
            className="absolute inset-y-0 right-2 my-auto h-6 w-6 rounded-md text-white/90 hover:text-white"
            aria-label="Apri calendario"
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
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
  );

  const menu = (
    etichetta: string,
    attivo: boolean,
    valore: string,
    onChange: (v: string) => void,
    voci: ReactNode
  ) => (
    <div>
      <label className="text-xs font-medium text-slate-600">{etichetta}</label>
      <select className={controlClassName(attivo)} value={valore} onChange={(e) => onChange(e.target.value)}>
        {voci}
      </select>
    </div>
  );

  const bloccoOperatoreOTipologia = tipologie
    ? menu(
        tipologiaLabel,
        Boolean(filters.tipologia && filters.tipologia.trim()),
        filters.tipologia ?? "",
        (v) => setFilters({ ...filters, tipologia: v || undefined }),
        <>
          <option value="">Tutte</option>
          {tipologie.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </>
      )
    : menu(
        operatorLabel,
        Boolean(filters.operatore && filters.operatore.trim()),
        filters.operatore ?? "",
        (v) => setFilters({ ...filters, operatore: v || undefined }),
        <>
          <option value="">Tutti</option>
          {(operators ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </>
      );

  const bloccoVarianti = varianti
    ? menu(
        varianteLabel,
        (filters.variante ?? VARIANTE_DEFAULT) !== VARIANTE_DEFAULT,
        filters.variante ?? VARIANTE_DEFAULT,
        (v) => setFilters({ ...filters, variante: v }),
        varianti.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))
      )
    : null;

  const bloccoCampagna = menu(
    campaignLabel,
    Boolean(filters.campagna && filters.campagna.trim()),
    filters.campagna ?? "",
    (v) => setFilters({ ...filters, campagna: v || undefined }),
    <>
      <option value="">Tutte</option>
      {(campaigns ?? []).map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </>
  );

  const bloccoVendite =
    vendite !== undefined
      ? menu(
          "Vendita",
          Boolean(filters.vendita && filters.vendita.trim()),
          filters.vendita ?? "",
          (v) => setFilters({ ...filters, vendita: v || undefined }),
          <>
            <option value="">Tutte</option>
            {vendite.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </>
        )
      : null;

  const bloccoProdotti =
    prodotti !== undefined
      ? menu(
          "Prodotto",
          Boolean(filters.prodotto && filters.prodotto.trim()),
          filters.prodotto ?? "",
          (v) => setFilters({ ...filters, prodotto: v || undefined }),
          <>
            <option value="">Tutti</option>
            {prodotti.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </>
        )
      : null;

  // L'ordine cambia con la pagina. Su Campagne si va dal contenitore al
  // dettaglio - Categoria, poi Campagna - e la variabile di taglio resta in
  // fondo; altrove il menu delle persone viene prima di quello delle campagne.
  const blocchi = varianti
    ? [bloccoCampagna, bloccoVarianti, bloccoOperatoreOTipologia]
    : [bloccoOperatoreOTipologia, bloccoCampagna, bloccoVendite, bloccoProdotti];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${classeColonne}`}>
        {campoData("Da", filters.from ?? "", fromRef, (v) => setFilters({ ...filters, from: v }))}
        {campoData("A", filters.to ?? "", toRef, (v) => setFilters({ ...filters, to: v }))}
        {blocchi.map((b, i) => (
          <Fragment key={i}>{b}</Fragment>
        ))}
      </div>
    </div>
  );
}
