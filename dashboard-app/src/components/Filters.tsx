"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { Filters } from "@/lib/metrics";
import { VARIANTE_DEFAULT } from "@/lib/campagne";
import { PERIODO_DEFAULT, periodi, periodoScelto } from "@/lib/periodi";
import { coloriCampo } from "@/lib/campiFiltro";

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
        className={`mt-1 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm shadow-sm outline-none transition ${coloriCampo(
          !tutti
        )}`}
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
        // LA SCALA DEI PIANI, per non doverla piu' ricostruire:
        //   10  le colonne bloccate delle tabelle
        //   20  la riga delle intestazioni, e la barra in cima su telefono
        //   30  le celle d'angolo, ferme in tutte e due le direzioni
        //   40  questa tendina, e il velo scuro del menu laterale
        //   50  il menu laterale aperto su telefono
        //
        // A 30 stava alla pari con le celle d'angolo, e a parita' vince chi
        // viene dopo nella pagina: la tabella, che sta sotto i filtri. La riga
        // delle intestazioni si disegnava quindi sopra la tendina, tagliandola
        // in due con la sua striscia bianca e la sua linea grigia.
        //
        // 40 e non 50 di proposito: cosi' resta sotto al velo del menu
        // laterale, che a parita' di piano vince perche' viene dopo. Una
        // tendina che galleggiasse sopra il velo sarebbe l'unica cosa a fuoco
        // di una pagina spenta.
        <div className="absolute z-40 mt-1 w-full rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {opzioni.map((o) => (
            <label
              key={o.value}
              className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-100"
            >
              <input
                type="checkbox"
                // La spunta e' grigio molto scuro e diventa nera passandoci
                // sopra col mouse. Il grigio e' "neutral" e non "gray", che
                // nella tavolozza tira al blu: qui serve un grigio puro,
                // altrimenti accanto al nero si vedrebbe la sfumatura fredda.
                className="h-4 w-4 rounded border-slate-300 accent-neutral-800 group-hover:accent-black"
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
  const controlClassName = (isActive: boolean) =>
    `mt-1 w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none transition ${coloriCampo(
      isActive
    )}`;

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
        // Sempre nero: questo menu una scelta ce l'ha sempre, anche quando e'
        // quella predefinita, e sta comunque restringendo quello che si vede.
        true,
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

  // IL PERIODO E' UN MENU COME GLI ALTRI, e ha preso il posto dei campi Da e A.
  //
  // Sceglierlo scrive le due date, che restano il valore su cui lavorano le
  // query: cambia il modo di dirlo, non quello che viene chiesto al database.
  // Il nome del periodo viaggia insieme alle date perche' da sole non
  // basterebbero a ritrovarlo: di lunedi' "Oggi" e "Settimana corrente" danno
  // lo stesso intervallo, e il menu non saprebbe quale delle due mostrare.
  const periodoAttuale = filters.periodo ?? PERIODO_DEFAULT;
  const bloccoPeriodo = menu(
    "Periodo",
    // Sempre nero, come Campagna: un periodo c'e' sempre.
    true,
    periodoAttuale,
    (v) => {
      const scelto = periodoScelto(v);
      setFilters({ ...filters, periodo: scelto.value, from: scelto.from, to: scelto.to });
    },
    periodi().map((p) => (
      <option key={p.value} value={p.value}>
        {p.label}
      </option>
    ))
  );

  // L'ordine cambia con la pagina. Su Campagne si va dal contenitore al
  // dettaglio - Categoria, poi Campagna - e la variabile di taglio resta in
  // fondo; altrove il menu delle persone viene prima di quello delle campagne.
  const blocchi = varianti
    ? [bloccoPeriodo, bloccoCampagna, bloccoFormato, bloccoVarianti, bloccoOperatoreOTipologia]
    : [bloccoPeriodo, bloccoOperatoreOTipologia, bloccoCampagna, bloccoVendite, bloccoProdotti];

  // Le colonne si contano sui blocchi che ci sono davvero, invece di ricavarle
  // dalle condizioni che li accendono: quel conto andava rifatto a mano a ogni
  // filtro nuovo, ed era un'occasione di sbagliare a ogni giro.
  //
  // Le classi di Tailwind vanno scritte per intero: costruirle concatenando
  // ("lg:grid-cols-" + n) le renderebbe invisibili al compilatore, e la barra
  // resterebbe a una colonna sola sugli schermi larghi.
  const colonne = blocchi.filter(Boolean).length;
  const classeColonne =
    colonne >= 7
      ? "lg:grid-cols-7"
      : colonne === 6
        ? "lg:grid-cols-6"
        : colonne === 5
          ? "lg:grid-cols-5"
          : "lg:grid-cols-4";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${classeColonne}`}>
        {blocchi.map((b, i) => (
          <Fragment key={i}>{b}</Fragment>
        ))}
      </div>
    </div>
  );
}
