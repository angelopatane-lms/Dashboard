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

export default function CampagnePersona({ bloccato }: { bloccato?: boolean }) {
  const [aperto, setAperto] = useState(false);
  const [persone, setPersone] = useState<Persona[]>([]);
  const [categorie, setCategorie] = useState<Categoria[]>([]);
  /** Quante se ne possono scegliere: lo dice il server, non una costante di qui. */
  const [massimo, setMassimo] = useState(3);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  /** Chi si sta salvando in questo momento: la sua riga resta ferma. */
  const [salvando, setSalvando] = useState<number | null>(null);

  const leggi = useCallback(async () => {
    setInCorso(true);
    setErrore(null);
    try {
      const r = await fetch("/api/campagne-persona", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `errore ${r.status}`);
      setPersone(d.persone ?? []);
      setCategorie(d.categorie ?? []);
      if (typeof d.massimo === "number") setMassimo(d.massimo);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  }, []);

  useEffect(() => {
    if (aperto && !persone.length && !inCorso) void leggi();
    // Si legge una volta all'apertura: queste impostazioni non si muovono da
    // sole, e rileggerle a intervalli sarebbe spendere chiamate per niente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aperto]);

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
      if (d.categorie?.length) setCategorie(d.categorie);
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
    <div>
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        aria-expanded={aperto}
        className="flex w-full items-center gap-x-4 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span
          className="w-44 shrink-0 cursor-help text-sm font-medium text-slate-800"
          title="Le categorie di campagna che ciascuna persona riceve per prime, le stesse della tabella Campagne. Chi non ne ha scelta nessuna riceve tutte le campagne, come sempre. Non e' un'esclusione: se le categorie scelte non bastano, il resto arriva dalle altre."
        >
          Campagne per Persona
        </span>
        {/* IL TETTO E NON LO STATO. Qui prima si leggeva quante persone
            hanno una preferenza: un'informazione che la riga dice gia' da
            sola, appena si apre, e che sulla riga chiusa e' solo una frase
            lunga. Il tetto invece e' l'unica cosa che non si scopre
            guardando. */}
        <span
          className="min-w-0 flex-1 cursor-help text-xs text-slate-500"
          title="Oltre tre categorie la ricerca di HubSpot supera i 18 filtri totali e risponde 400, che dentro l'app si legge come 'nessun lead disponibile'. Misurato."
        >
          Al massimo {massimo}
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

      {!aperto ? null : (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          {errore ? (
            <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errore}
            </p>
          ) : null}

          {inCorso && !persone.length ? (
            <p className="py-6 text-center text-xs text-slate-400">
              lettura delle persone e delle categorie…
            </p>
          ) : !persone.length ? (
            <p className="py-6 text-center text-xs text-slate-400">
              nessuna persona da impostare
            </p>
          ) : (
            <>
              {/* QUANTI CONTATTI HA OGNI CATEGORIA, in cima e una volta sola.
                  Ripeterlo in ogni tendina sarebbe rumore, ma senza non si sa
                  se una categoria ha ancora qualcosa da dare: e' la differenza
                  fra scegliere e indovinare. */}
              <p className="mb-3 text-[11px] text-slate-400">
                {categorie.length ? (
                  <>
                    Assegnabili per categoria:{" "}
                    {categorie
                      .map((c) => `${c.etichetta} ${formatoNumero.format(c.assegnabili)}`)
                      .join(" · ")}
                  </>
                ) : (
                  "elenco non disponibile"
                )}
              </p>

              <div className="divide-y divide-slate-100">
                {persone.map((p) => {
                  const scelte = categorieDi(p);
                  const prese = new Set(scelte.map((c) => c.etichetta));
                  const disponibili = categorie.filter((c) => !prese.has(c.etichetta));
                  const pieno = scelte.length >= massimo;
                  const fermo = bloccato || salvando === p.employee_id;
                  return (
                    <div
                      key={p.employee_id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5"
                    >
                      {/* PIU' LARGA DELLE ALTRE ETICHETTE DELLA SEZIONE: qui
                          dentro ci stanno nome, cognome e ruolo, e a 11rem
                          "Valentina Mandarino" andava a capo portandosi
                          dietro la riga. */}
                      <span className="w-56 shrink-0 text-sm text-slate-800">
                        {p.first_name} {p.last_name}
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-slate-400">
                          {p.role}
                        </span>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
