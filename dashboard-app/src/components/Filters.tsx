"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { Filters } from "@/lib/metrics";
import { VARIANTE_DEFAULT } from "@/lib/campagne";
import { PERIODO_DEFAULT, periodi, periodoScelto } from "@/lib/periodi";
import { coloriCampo } from "@/lib/campiFiltro";

/**
 * Apre e chiude una tendina, e la chiude da sola quando si clicca fuori o si
 * preme Esc.
 *
 * Sta in un posto solo perche' i due menu la vogliono uguale: separati, uno dei
 * due sarebbe rimasto indietro alla prima correzione.
 */
function useTendina() {
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

  return { aperto, setAperto, contenitore };
}

/** La freccia in fondo al campo, uguale per tutti i menu. */
function Freccia() {
  return (
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
  );
}

/**
 * IL PIANO DELLE TENDINE APERTE, per non doverlo piu' ricostruire:
 *   10  le colonne bloccate delle tabelle
 *   20  la riga delle intestazioni, e la barra in cima su telefono
 *   30  le celle d'angolo, ferme in tutte e due le direzioni
 *   40  le tendine dei filtri, e il velo scuro del menu laterale
 *   50  il menu laterale aperto su telefono
 *
 * A 30 stavano alla pari con le celle d'angolo, e a parita' vince chi viene
 * dopo nella pagina: la tabella, che sta sotto i filtri. La riga delle
 * intestazioni si disegnava quindi sopra la tendina, tagliandola in due con la
 * sua striscia bianca e la sua linea grigia.
 *
 * 40 e non 50 di proposito: cosi' resta sotto al velo del menu laterale, che a
 * parita' di piano vince perche' viene dopo. Una tendina che galleggiasse sopra
 * il velo sarebbe l'unica cosa a fuoco di una pagina spenta.
 *
 * L'altezza massima serve agli elenchi lunghi - gli operatori, le campagne -
 * che altrimenti uscirebbero dal fondo della pagina.
 */
const TENDINA =
  "absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg";

/**
 * Menu a scelta singola, scritto da noi al posto del <select> del browser.
 *
 * IL MOTIVO E' UNA RIGA BLU. Nell'elenco aperto di un <select> la voce sotto al
 * mouse viene evidenziata dal browser con il suo azzurro di sistema, e il CSS
 * su <option> non la tocca: era l'unico blu rimasto in una dashboard per il
 * resto in bianco e nero. Disegnando la tendina si decide anche quel colore.
 *
 * Costa la tastiera: frecce e ricerca per iniziale, che il <select> nativo dava
 * gratis, qui non ci sono. Restano il click e Esc per chiudere.
 */
function MenuSingolo({
  etichetta,
  opzioni,
  scelto,
  attivo,
  onChange
}: {
  etichetta: string;
  opzioni: Array<{ label: string; value: string }>;
  scelto: string;
  attivo: boolean;
  onChange: (valore: string) => void;
}) {
  const { aperto, setAperto, contenitore } = useTendina();
  const corrente = opzioni.find((o) => o.value === scelto);

  return (
    <div ref={contenitore} className="relative">
      <label className="text-xs font-medium text-slate-600">{etichetta}</label>
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        className={`mt-1 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm shadow-sm outline-none transition ${coloriCampo(
          attivo
        )}`}
      >
        <span className="truncate">{corrente?.label ?? ""}</span>
        <Freccia />
      </button>

      {aperto ? (
        <div className={TENDINA}>
          {opzioni.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setAperto(false);
              }}
              // La voce sotto al mouse si riempie di grigio scuro: e' la stessa
              // barra piena dell'elenco di sistema, nel colore della dashboard
              // invece che nell'azzurro del browser.
              className={`flex w-full cursor-pointer items-center rounded px-2 py-1.5 text-left text-sm transition hover:bg-neutral-800 hover:text-white ${
                o.value === scelto ? "bg-neutral-100 font-medium" : ""
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  const { aperto, setAperto, contenitore } = useTendina();

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
        <Freccia />
      </button>

      {aperto ? (
        <div className={TENDINA}>
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
  const menu = (
    etichetta: string,
    attivo: boolean,
    valore: string,
    onChange: (v: string) => void,
    opzioni: Array<{ label: string; value: string }>
  ) => (
    <MenuSingolo
      etichetta={etichetta}
      opzioni={opzioni}
      scelto={valore}
      attivo={attivo}
      onChange={onChange}
    />
  );

  /** La voce di apertura degli elenchi dove "nessun filtro" e' uno stato vero. */
  const tutte = (etichetta: string) => ({ label: etichetta, value: "" });

  const bloccoOperatoreOTipologia = tipologie
    ? menu(
        tipologiaLabel,
        Boolean(filters.tipologia && filters.tipologia.trim()),
        filters.tipologia ?? "",
        (v) => setFilters({ ...filters, tipologia: v || undefined }),
        [tutte("Tutte"), ...tipologie]
      )
    : menu(
        operatorLabel,
        Boolean(filters.operatore && filters.operatore.trim()),
        filters.operatore ?? "",
        (v) => setFilters({ ...filters, operatore: v || undefined }),
        [tutte("Tutti"), ...(operators ?? []).map((o) => ({ label: o, value: o }))]
      );

  const bloccoVarianti = varianti
    ? menu(
        varianteLabel,
        // Sempre nero: questo menu una scelta ce l'ha sempre, anche quando e'
        // quella predefinita, e sta comunque restringendo quello che si vede.
        true,
        filters.variante ?? VARIANTE_DEFAULT,
        (v) => setFilters({ ...filters, variante: v }),
        varianti
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
    [tutte("Tutte"), ...(campaigns ?? []).map((c) => ({ label: c, value: c }))]
    )
  );

  const bloccoVendite =
    vendite !== undefined
      ? menu(
          "Vendita",
          Boolean(filters.vendita && filters.vendita.trim()),
          filters.vendita ?? "",
          (v) => setFilters({ ...filters, vendita: v || undefined }),
          [tutte("Tutte"), ...vendite]
        )
      : null;

  const bloccoProdotti =
    prodotti !== undefined
      ? menu(
          "Prodotto",
          Boolean(filters.prodotto && filters.prodotto.trim()),
          filters.prodotto ?? "",
          (v) => setFilters({ ...filters, prodotto: v || undefined }),
          [tutte("Tutti"), ...prodotti]
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
    periodi().map((p) => ({ label: p.label, value: p.value }))
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
