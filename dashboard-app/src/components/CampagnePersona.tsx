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
 * CHIUSA DI PARTENZA. L'elenco delle linee costa una ventina di ricerche su
 * HubSpot, su un token condiviso con decine di flussi Zapier. Chi apre la
 * sezione quasi sempre viene per gli interruttori.
 */

type Persona = {
  employee_id: number;
  first_name: string;
  last_name: string;
  role: string;
  campagne_preferite: string;
};

type Linea = { chiave: string; etichetta: string; assegnabili: number };

const formatoNumero = new Intl.NumberFormat("it-IT");

export default function CampagnePersona({ bloccato }: { bloccato?: boolean }) {
  const [aperto, setAperto] = useState(false);
  const [persone, setPersone] = useState<Persona[]>([]);
  const [linee, setLinee] = useState<Linea[]>([]);
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
      setLinee(d.linee ?? []);
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
      if (d.linee?.length) setLinee(d.linee);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  }, []);

  const scelteDi = (p: Persona) =>
    (p.campagne_preferite || "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

  const conPreferenza = persone.filter((p) => scelteDi(p).length).length;

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
          title="Le linee di campagna che ciascuna persona riceve per prime. Chi non ne ha scelta nessuna riceve tutte le campagne, come sempre. Non e' un'esclusione: se la linea scelta non basta, il resto arriva dalle altre."
        >
          Campagne per Persona
        </span>
        <span className="min-w-0 flex-1 text-xs text-slate-500">
          {!aperto && !persone.length
            ? "chiusa"
            : conPreferenza
              ? `${conPreferenza} ${conPreferenza === 1 ? "persona ha" : "persone hanno"} una preferenza`
              : "nessuna preferenza: tutti ricevono tutte le campagne"}
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
              lettura delle persone e delle linee…
            </p>
          ) : !persone.length ? (
            <p className="py-6 text-center text-xs text-slate-400">
              nessuna persona da impostare
            </p>
          ) : (
            <>
              {/* QUANTI CONTATTI HA OGNI LINEA, in cima e una volta sola.
                  Ripeterlo in ogni tendina sarebbe rumore, ma senza non si sa
                  se una linea ha ancora qualcosa da dare: e' la differenza fra
                  scegliere e indovinare. */}
              <p className="mb-3 text-[11px] text-slate-400">
                Linee disponibili:{" "}
                {linee.length
                  ? linee
                      .map((l) => `${l.etichetta} ${formatoNumero.format(l.assegnabili)}`)
                      .join(" · ")
                  : "elenco non disponibile"}
              </p>

              <div className="divide-y divide-slate-100">
                {persone.map((p) => {
                  const scelte = scelteDi(p);
                  const disponibili = linee.filter((l) => !scelte.includes(l.chiave));
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
                              key={c}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                            >
                              <span className="font-mono">{c.toUpperCase()}</span>
                              <button
                                type="button"
                                disabled={fermo}
                                onClick={() =>
                                  salva(
                                    p.employee_id,
                                    scelte.filter((x) => x !== c)
                                  )
                                }
                                className="text-slate-300 transition hover:text-rose-600 disabled:cursor-not-allowed"
                                title={`Togli ${c.toUpperCase()}`}
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
                        disabled={fermo || !disponibili.length}
                        onChange={(e) => {
                          if (e.target.value) salva(p.employee_id, [...scelte, e.target.value]);
                        }}
                        className="w-40 shrink-0 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 outline-none transition hover:border-slate-400 focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">
                          {!linee.length
                            ? "elenco non disponibile"
                            : disponibili.length
                              ? "aggiungi linea"
                              : "tutte aggiunte"}
                        </option>
                        {disponibili.map((l) => (
                          <option key={l.chiave} value={l.chiave}>
                            {l.etichetta} ({formatoNumero.format(l.assegnabili)})
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
