"use client";

import { useEffect } from "react";
import { formatInt } from "@/lib/format";

/**
 * Quanto ha ricevuto una persona in una giornata, richiesta per richiesta.
 *
 * NASCE DAL CLIC SUL NOME nell'elenco delle assegnazioni, che da quando mostra
 * una riga per richiesta non dice piu' il totale di nessuno: chi ha chiesto tre
 * volte compare tre volte, ed era proprio il numero che prima si leggeva a
 * colpo d'occhio. Qui torna, con accanto il perche' di ogni pezzo.
 *
 * LE DUE FONTI A CONFRONTO, ed e' la ragione principale per cui questa
 * finestra esiste. Il totale DICHIARATO lo somma il registro dell'app; quello
 * CONFERMATO lo ricostruiamo da HubSpot guardando chi e' diventato
 * proprietario. Finche' coincidono non c'e' niente da dire; quando non
 * coincidono, la differenza e' l'unica cosa che conta - il 10 ottobre 2026
 * l'app ne dichiarava 80 e HubSpot ne confermava 60, e quella volta aveva
 * ragione l'app, ma la prossima potrebbe non essere cosi'.
 */

export type RichiestaPersona = {
  id: string;
  chiestoAt: string;
  lead: number;
  serie: string | null;
  richiestaN: number | null;
  pendenti: number | null;
  appuntamenti: number | null;
};

function ora(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function FinestraRichieste({
  nome,
  ruolo,
  giorno,
  richieste,
  confermati,
  onChiudi
}: {
  nome: string;
  ruolo: string | null;
  /** Come si chiama la giornata che si sta guardando: "oggi", "ieri", una data. */
  giorno: string;
  richieste: RichiestaPersona[];
  /**
   * Quanti lead HubSpot conferma per questa persona in questa giornata.
   * null quando la ricostruzione non c'e': diverso da zero, e si scrive
   * diverso.
   */
  confermati: number | null;
  onChiudi: () => void;
}) {
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (e.key === "Escape") onChiudi();
    };
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  }, [onChiudi]);

  const dichiarati = richieste.reduce((somma, r) => somma + r.lead, 0);
  const discordano = confermati !== null && confermati !== dichiarati;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={onChiudi} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Richieste di ${nome}`}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900">{nome}</div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {ruolo ? `${ruolo} · ` : ""}
              {giorno}
            </div>
          </div>
          <button
            type="button"
            onClick={onChiudi}
            aria-label="Chiudi"
            className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
          >
            ×
          </button>
        </div>

        {/* I DUE TOTALI AFFIANCATI, sempre, non solo quando discordano: e'
            guardandoli uguali che si impara cosa vuol dire vederli diversi. */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-200">
          <div className="px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Dichiarati
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {formatInt(dichiarati)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">dal registro dell&apos;app</div>
          </div>
          <div className="px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Confermati
            </div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                confermati === null ? "text-slate-300" : discordano ? "text-amber-700" : "text-slate-900"
              }`}
            >
              {confermati === null ? "–" : formatInt(confermati)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {confermati === null ? "ricostruzione non disponibile" : "da HubSpot"}
            </div>
          </div>
        </div>

        {discordano ? (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
            I due numeri non coincidono. Il piu' frequente e&apos; un contatto
            riassegnato a mano dopo: HubSpot tiene solo l&apos;ultimo
            proprietario, quindi quel lead smette di risultare suo.
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="mb-1 flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Richieste
            </span>
            <span className="text-[11px] tabular-nums text-slate-400">{richieste.length}</span>
          </div>

          {/* Dalla prima all'ultima, come nell'elenco da cui si arriva. */}
          {[...richieste]
            .sort((a, b) => (a.chiestoAt < b.chiestoAt ? -1 : a.chiestoAt > b.chiestoAt ? 1 : 0))
            .map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded px-2 py-2 odd:bg-slate-50/70"
            >
              <span className="w-12 shrink-0 text-xs tabular-nums text-slate-400">
                {ora(r.chiestoAt)}
              </span>
              <span className="w-10 shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                {formatInt(r.lead)}
              </span>
              {/* IL CONTORNO DELLA RICHIESTA, che e' quello che spiega il
                  numero accanto: da quale serbatoio ha pescato, quanto
                  arretrato aveva addosso, quanti appuntamenti aveva gia'
                  preso - che e' il dato da cui dipende il giro in piu'. */}
              <span className="min-w-0 flex-1 text-xs text-slate-500">
                {[
                  // replaceAll e non replace: "serie_a 16 + serie_b 4" ha due
                  // trattini bassi, e sostituendone uno solo restava a meta'.
                  r.serie ? r.serie.replaceAll("_", " ") : null,
                  r.pendenti !== null ? `${formatInt(r.pendenti)} da chiamare` : null,
                  r.appuntamenti !== null
                    ? `${r.appuntamenti} ${r.appuntamenti === 1 ? "appuntamento" : "appuntamenti"}`
                    : null
                ]
                  .filter(Boolean)
                  .join("  |  ") || "nessun dettaglio registrato"}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
