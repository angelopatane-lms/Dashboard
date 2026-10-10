"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Le campagne che ciascuna persona riceve per prime.
 *
 * COSA FA DAVVERO, perche' il nome puo' ingannare: non e' un filtro che
 * esclude. Chi ha una linea scelta la riceve PRIMA, e se quella linea non
 * basta a coprire la richiesta il resto arriva comunque dalle altre. Nessuno
 * resta a mani vuote perche' la sua campagna e' finita.
 *
 * CHI NON SCEGLIE NIENTE RICEVE TUTTO, che e' il caso di quasi tutti: la
 * colonna nasce vuota. Per questo una riga senza targhette dice "tutte le
 * campagne" invece di restare bianca - uno spazio vuoto si legge come
 * un'impostazione mancante, e questa invece e' un'impostazione precisa.
 *
 * CHIUSA DI PARTENZA. Contare quanti contatti ha ogni categoria costa una
 * ventina di chiamate a HubSpot, su un token condiviso con decine di flussi
 * Zapier. Chi apre la sezione quasi sempre viene per gli interruttori.
 */

type Persona = {
  employee_id: number;
  first_name: string;
  last_name: string;
  role: string;
  campagne_preferite: string;
};

/**
 * Una categoria del marketing, con i frammenti che la definiscono.
 *
 * SI SALVANO I FRAMMENTI, NON L'ETICHETTA: l'app di assegnazione confronta
 * `id_campagna_refresh` con quegli stessi frammenti - trattino basso finale
 * compreso - percio' la categoria che decide chi riceve un lead e quella
 * scritta nella tabella Campagne sono la stessa cosa.
 */
type Categoria = { etichetta: string; frammenti: string[]; assegnabili: number };

const formatoNumero = new Intl.NumberFormat("it-IT");

/**
 * La riga dentro il riquadro dei comandi.
 *
 * SEPARATA DAL PANNELLO perche' i due pezzi stanno in due posti diversi: la
 * riga fra gli altri comandi, dentro il riquadro bianco; il pannello fuori,
 * sul grigio della pagina, cosi' i suoi riquadri si allineano a quelli in
 * cima alla sezione invece di essere rientrati di sedici pixel.
 */
export default function CampagnePersonaRiga({
  aperto,
  onToggle
}: {
  aperto: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={aperto}
      className="flex w-full items-center gap-x-4 px-4 py-3 text-left transition hover:bg-slate-50"
    >
      <span
        className="w-44 shrink-0 cursor-help text-sm font-medium text-slate-800"
        title="Le categorie di campagna che ciascuna persona riceve per prime, le stesse della tabella Campagne. Chi non ne ha scelta nessuna riceve tutte le campagne, come sempre. Non e' un'esclusione: se le categorie scelte non bastano, il resto arriva dalle altre."
      >
        Categorie
      </span>
      {/* IL TETTO E NON LO STATO. Qui prima si leggeva quante persone hanno
          una preferenza: un'informazione che il pannello dice gia' da solo,
          appena si apre, e che sulla riga chiusa e' solo una frase lunga. Il
          tetto invece e' l'unica cosa che non si scopre guardando. */}
      <span
        className="min-w-0 flex-1 cursor-help text-xs text-slate-500"
        title="Oltre tre categorie la ricerca di HubSpot supera i 18 filtri totali e risponde 400, che dentro l'app si legge come 'nessun lead disponibile'. Misurato."
      >
        Combinazione personalizzata (max 3)
      </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${aperto ? "rotate-180" : ""}`}
      >
        <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * Il pannello, fuori dal riquadro dei comandi e sul grigio della pagina.
 *
 * Si monta quando la riga si apre e si smonta quando si chiude: per questo
 * legge all'avvio e non ha bisogno di sapere se e' aperto.
 */
export function CampagnePersonaPannello({ bloccato }: { bloccato?: boolean }) {
  const [persone, setPersone] = useState<Persona[]>([]);
  const [categorie, setCategorie] = useState<Categoria[]>([]);
  /** Quante se ne possono scegliere: lo dice il server, non una costante di qui. */
  const [massimo, setMassimo] = useState(3);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  /** Chi si sta salvando in questo momento: la sua riga resta ferma. */
  const [salvando, setSalvando] = useState<number | null>(null);
  /** I riquadri dei numeri arrivano dopo l'elenco, e lo dicono. */
  const [categorieInCorso, setCategorieInCorso] = useState(false);

  /**
   * Le due letture partono insieme e si disegnano appena arrivano, ciascuna
   * per conto suo.
   *
   * LE PERSONE ARRIVANO IN MEZZO SECONDO, i numeri delle categorie in sette e
   * mezzo: contarli vuol dire enumerare il serbatoio su HubSpot. Aspettando
   * entrambi, aprire la scheda voleva dire guardare un rettangolo bianco alto
   * mille pixel per dieci secondi, con l'elenco gia' pronto dietro.
   */
  const leggi = useCallback(async () => {
    setInCorso(true);
    setErrore(null);

    const gente = fetch("/api/campagne-persona", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? `errore ${r.status}`);
        setPersone(d.persone ?? []);
        if (typeof d.massimo === "number") setMassimo(d.massimo);
      })
      .catch((e) => setErrore(e instanceof Error ? e.message : String(e)))
      .finally(() => setInCorso(false));

    // I NUMERI NON FANNO FALLIRE NIENTE: se non arrivano, i riquadri restano
    // vuoti e la scheda funziona lo stesso. Per questo non toccano `errore`.
    fetch("/api/campagne-persona/categorie", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCategorie(d.categorie ?? []))
      .catch(() => setCategorie([]))
      .finally(() => setCategorieInCorso(false));

    setCategorieInCorso(true);
    await gente;
  }, []);

  useEffect(() => {
    void leggi();
    // Una volta sola, all'apertura: il pannello si monta quando la riga si
    // apre, quindi questo e' il momento. Queste impostazioni non si muovono da
    // sole, e rileggerle a intervalli sarebbe spendere chiamate per niente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Salva e riusa la risposta.
   *
   * LA RISPOSTA DELL'APP SOSTITUISCE L'ELENCO, invece di aggiornare qui la
   * riga e sperare che di la' sia andata uguale. Se qualcuno ha cambiato
   * qualcosa dalla pagina dell'app, lo si vede subito; e se il salvataggio non
   * e' riuscito, la targhetta non compare - che e' il modo giusto di dirlo.
   */
  const salva = useCallback(async (employee_id: number, campagne: string[]) => {
    setSalvando(employee_id);
    setErrore(null);
    try {
      const r = await fetch("/api/campagne-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id, campagne })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `errore ${r.status}`);
      setPersone(d.persone ?? []);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  }, []);

  /** I frammenti salvati per una persona. */
  const frammentiDi = (p: Persona) =>
    (p.campagne_preferite || "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

  /**
   * Le categorie di una persona, ricavate dai frammenti salvati.
   *
   * SI RISALE DAL FRAMMENTO ALL'ETICHETTA invece di salvare l'etichetta: se un
   * giorno il marketing aggiunge un frammento a una categoria, le preferenze
   * gia' impostate lo ereditano. Un frammento che nessuna categoria rivendica
   * si mostra com'e' - e' sempre meglio di farlo sparire.
   */
  /**
   * Le persone divise per ruolo, nell'ordine in cui l'app le manda.
   *
   * UNA COLONNA PER RUOLO, e sono due: sedici Advisor e tredici Setter, quasi
   * pari. Si ricavano dai dati invece di scriverli qui: il giorno che nasce un
   * terzo ruolo compare da solo, e non c'e' un elenco da tenere allineato a
   * mano con quello dell'app.
   */
  const gruppi: [string, Persona[]][] = (() => {
    const per = new Map<string, Persona[]>();
    for (const p of persone) {
      const r = (p.role || "Senza ruolo").trim();
      per.set(r, [...(per.get(r) ?? []), p]);
    }
    return [...per.entries()];
  })();

  const categorieDi = (p: Persona) => {
    const fr = frammentiDi(p);
    const viste: { etichetta: string; frammenti: string[] }[] = [];
    for (const c of categorie) {
      if (c.frammenti.some((f) => fr.includes(f))) viste.push(c);
    }
    const coperti = new Set(viste.flatMap((c) => c.frammenti));
    for (const f of fr) {
      if (!coperti.has(f)) viste.push({ etichetta: f, frammenti: [f] });
    }
    return viste;
  };

  return (
    <div className="mt-4">
          {errore ? (
            <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errore}
            </p>
          ) : null}

          {inCorso && !persone.length ? (
            <p className="rounded-lg border border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
              lettura delle persone…
            </p>
          ) : !persone.length ? (
            <p className="rounded-lg border border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
              nessuna persona da impostare
            </p>
          ) : (
            <>
              {/* QUANTI CONTATTI HA OGNI CATEGORIA, in cima e una volta sola.
                  Ripeterlo in ogni tendina sarebbe rumore, ma senza non si sa
                  se una categoria ha ancora qualcosa da dare: e' la differenza
                  fra scegliere e indovinare.

                  A RIQUADRI E NON IN FILA. Erano sei coppie nome-numero
                  separate da puntini su una riga sola: per sapere quanti ne ha
                  MBE MKTG bisognava leggere la frase fino a trovarlo. Nei
                  riquadri il numero sta sotto il suo nome e si trova
                  guardando, che e' il modo in cui questa riga viene letta.
                  Stessa forma dei riquadri in cima alla sezione, perche'
                  dicono la stessa cosa: quanto materiale c'e'. */}
              {categorie.length ? (
                <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {categorie.map((c) => (
                    <div
                      key={c.etichetta}
                      title={`${c.etichetta} — campagne il cui nome contiene: ${c.frammenti.join(", ")}`}
                      className="cursor-help rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {c.etichetta}
                      </div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                        {formatoNumero.format(c.assegnabili)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* I RIQUADRI ARRIVANO DOPO L'ELENCO e lo dicono, invece di
                   lasciare un buco: contarli costa una ventina di chiamate a
                   HubSpot, l'elenco mezzo secondo. */
                <p className="mb-3 text-[11px] text-slate-400">
                  {categorieInCorso ? "conteggio delle categorie…" : "elenco non disponibile"}
                </p>
              )}

              {/* UNA COLONNA PER RUOLO. A schermo intero ogni riga era vuota
                  per sessanta centimetri su cento - nome a sinistra, due
                  parole grigie, e la tendina inchiodata all'estrema destra -
                  moltiplicato per ventinove righe. Divisi per ruolo le righe
                  diventano meta' e la larghezza viene usata.

                  E IL RUOLO SPARISCE DALLE RIGHE, perche' lo dice la colonna:
                  ripeterlo ventinove volte era rumore che rubava lo spazio ai
                  nomi lunghi. */}
              {/* DUE COLONNE SOLO SOPRA I 1280px. A 1024 ci stavano per
                  larghezza ma non per contenuto: nome, targhette e tendina non
                  entravano in una riga sola e la tendina finiva sotto il nome,
                  che e' peggio di una colonna sola. */}
              <div className="grid gap-x-8 gap-y-6 rounded-lg border border-slate-200 bg-white px-4 py-4 xl:grid-cols-2">
                {gruppi.map(([ruolo, gente]) => (
                  <div key={ruolo}>
                    <div className="mb-1 flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {ruolo}
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-400">{gente.length}</span>
                    </div>
                    {gente.map((p) => {
                      const scelte = categorieDi(p);
                      const prese = new Set(scelte.map((c) => c.etichetta));
                      const disponibili = categorie.filter((c) => !prese.has(c.etichetta));
                      const pieno = scelte.length >= massimo;
                      const fermo = bloccato || salvando === p.employee_id;
                      return (
                        <div
                          key={p.employee_id}
                          /* RIGHE ALTERNATE APPENA TINTE: su una colonna di
                             sedici nomi aiutano l'occhio ad attraversare la
                             riga, che e' il gesto che qui si fa di continuo -
                             dal nome alla sua tendina. */
                          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded px-2 py-2 odd:bg-slate-50/70"
                        >
                          <span
                            className="w-36 shrink-0 truncate text-sm text-slate-800"
                            title={`${p.first_name} ${p.last_name}`}
                          >
                            {p.first_name} {p.last_name}
                          </span>

                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        {scelte.length ? (
                          scelte.map((c) => (
                            <span
                              key={c.etichetta}
                              title={`Campagne il cui nome contiene: ${c.frammenti.join(", ")}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                            >
                              <span>{c.etichetta}</span>
                              <button
                                type="button"
                                disabled={fermo}
                                onClick={() =>
                                  salva(
                                    p.employee_id,
                                    scelte
                                      .filter((x) => x.etichetta !== c.etichetta)
                                      .flatMap((x) => x.frammenti)
                                  )
                                }
                                className="text-slate-300 transition hover:text-rose-600 disabled:cursor-not-allowed"
                                title={`Togli ${c.etichetta}`}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">tutte le campagne</span>
                        )}
                      </span>

                          <select
                            value=""
                            disabled={fermo || pieno || !disponibili.length}
                        onChange={(e) => {
                          const scelta = categorie.find((c) => c.etichetta === e.target.value);
                          if (!scelta) return;
                          // SI SALVANO I FRAMMENTI, tutti quelli della
                          // categoria: MBE SALES ne ha tre, e tenerne uno solo
                          // vorrebbe dire perdere due terzi delle sue campagne.
                          salva(p.employee_id, [
                            ...scelte.flatMap((c) => c.frammenti),
                            ...scelta.frammenti
                          ]);
                        }}
                        className="w-44 shrink-0 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 outline-none transition hover:border-slate-400 focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">
                          {!categorie.length
                            ? "elenco non disponibile"
                            : pieno
                              ? `massimo ${massimo}`
                              : disponibili.length
                                ? "aggiungi categoria"
                                : "tutte aggiunte"}
                        </option>
                        {disponibili.map((c) => (
                          <option key={c.etichetta} value={c.etichetta}>
                            {c.etichetta} ({formatoNumero.format(c.assegnabili)})
                          </option>
                        ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
        </>
      )}
    </div>
  );
}
