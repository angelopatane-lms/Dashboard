"use client";

import { Fragment, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { Filters } from "@/lib/metrics";
import { VARIANTE_DEFAULT } from "@/lib/campagne";

/**
 * Menu a piu' scelte, con caselle di spunta dentro una tendina.
 *
 * Un <select multiple> nativo funziona solo tenendo premuto Ctrl mentre si
 * clicca, cosa che nessuno indovina; qui invece si spunta quello che serve.
 *
 * NESSUNA SPUNTA VALE COME TUTTE. Chi toglie l'ultima spunta quasi sempre vuole
 * togliere il filtro, non svuotare la tabella: mostrare zero righe sarebbe una
 * risposta inutile a un gesto ambiguo. L'etichetta dice "Tutti" in quel caso,
 * cosi' non resta il dubbio.
 */
function MenuMultiplo({
  etichetta,
  opzioni,
  scelti,
  onChange
}: {
  etichetta: string;
  opzioni: Array<{ label: string; value: string }>;
  scelti: string[];
  onChange: (scelti: string[]) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const contenitore = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!aperto) return;
    const chiudiFuori = (e: MouseEvent) => {
      if (contenitore.current && !contenitore.current.contains(e.target as Node)) setAperto(false);
    };
    const chiudiConEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAperto(false);
    };
    document.addEventListener("mousedown", chiudiFuori);
    document.addEventListener("keydown", chiudiConEsc);
    return () => {
      document.removeEventListener("mousedown", chiudiFuori);
      document.removeEventListener("keydown", chiudiConEsc);
    };
  }, [aperto]);

  const tutti = scelti.length === 0 || scelti.length === opzioni.length;
  const riassunto = tutti
    ? "Tutti"
    : opzioni
        .filter((o) => scelti.includes(o.value))
        .map((o) => o.label)
        .join(", ");

  const cambia = (valore: string) => {
    const dopo = scelti.includes(valore) ? scelti.filter((v) => v !== valore) : [...scelti, valore];
    onChange(dopo.length === opzioni.length ? [] : dopo);
  };

  return (
    <div ref={contenitore} className="relative">
      <label className="text-xs font-medium text-slate-600">{etichetta}</label>
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        className={`mt-1 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm shadow-sm outline-none transition ${
          tutti
            ? "border-slate-200 bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            : "border-slate-700 bg-black text-white focus:border-slate-200 focus:ring-2 focus:ring-slate-200/20"
        }`}
      >
        <span className="truncate">{riassunto}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0 opacity-70"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {aperto ? (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {opzioni.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                // accent-black: la spunta segue il nero del tema dei filtri
                // attivi invece del blu predefinito del browser.
                className="h-4 w-4 rounded border-slate-300 accent-black"
                checked={scelti.length === 0 || scelti.includes(o.value)}
                onChange={() => cambia(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  varianteLabel = "Variante",
  formati,
  formatoLabel = "Formato",
  campagnaMultipla = false
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
  /** Se presente, compare il menu del formato: evento dal vivo o funnel sempre
   *  attivo. Ha la voce vuota, perche' "tutti" e' il valore predefinito. */
  formati?: Array<{ label: string; value: string }>;
  formatoLabel?: string;
  /** Se vero il menu delle campagne diventa a piu' scelte e scrive in
   *  filters.categorie. Lo usa la sola pagina Campagne, dove quel menu elenca
   *  le categorie e serve poterne escludere qualcuna. */
  campagnaMultipla?: boolean;
}) {
  // Le classi di Tailwind vanno scritte per intero: costruirle concatenando
  // ("lg:grid-cols-" + n) le renderebbe invisibili al compilatore, e la barra
  // resterebbe a una colonna sola sugli schermi larghi.
  const colonne =
    (varianti ? 5 : 4 + (vendite !== undefined ? 1 : 0) + (prodotti !== undefined ? 1 : 0)) +
    (formati ? 1 : 0);
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

  // I valori scelti viaggiano come elenco separato da virgole dentro lo stesso
  // campo di testo degli altri filtri: cosi' il tipo Filters resta semplice.
  const bloccoFormato = formati ? (
    <MenuMultiplo
      etichetta={formatoLabel}
      opzioni={formati}
      scelti={(filters.formato ?? "").split(",").filter(Boolean)}
      onChange={(scelti) => setFilters({ ...filters, formato: scelti.length ? scelti.join(",") : undefined })}
    />
  ) : null;

  const bloccoCampagna = campagnaMultipla ? (
    <MenuMultiplo
      etichetta={campaignLabel}
      opzioni={(campaigns ?? []).map((c) => ({ label: c, value: c }))}
      scelti={(filters.categorie ?? "").split(",").filter(Boolean)}
      onChange={(scelti) => setFilters({ ...filters, categorie: scelti.length ? scelti.join(",") : undefined })}
    />
  ) : (
    menu(
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
    )
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
    ? [bloccoCampagna, bloccoFormato, bloccoVarianti, bloccoOperatoreOTipologia]
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
