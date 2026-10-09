"use client";

import { useEffect, useMemo, useState } from "react";
import { chiaveNome } from "@/lib/nomi";

/**
 * I team di una persona, aperti cliccando il suo nome.
 *
 * DUE MENU E NIENTE ALTRO. Scegliere un sotto-team sostituisce quello di prima:
 * non c'e' niente da togliere a mano, perche' una persona ne ha uno solo.
 * I sotto-team offerti dipendono dal principale scelto - la regola arriva dalla
 * rotta, non e' scritta qui - e cambiando principale un sotto-team che non gli
 * appartiene cade da se'.
 *
 * CAMBIARE IL PRINCIPALE NON E' UN'ETICHETTA: `hubspot_team_id` di tutti i
 * contatti e le trattative della persona si riscrive, su TUTTI, anche su quelli
 * di mesi fa. Per questo quel menu chiede conferma e l'altro no.
 *
 * DA QUANDO. La lista dei movimenti e' la ragione per cui questa finestra
 * esiste invece di aprire HubSpot: il portale dice solo com'e' adesso, e dopo
 * uno spostamento i mesi passati si rileggono come se la persona fosse sempre
 * stata nella squadra nuova.
 */

type Voce = { id: string; nome: string | null };

type Persona = {
  userId: string;
  nome: string | null;
  chiave: string | null;
  email: string | null;
  principale: Voce | null;
  sottoTeam: Voce[];
};

type Evento = {
  quando: string;
  nome: string | null;
  azione: string;
  genere: string | null;
  team: string | null;
};

type Dati = {
  sottoPerPrincipale: Record<string, string[]>;
  team: Array<{ id: string; nome: string; principale: boolean }>;
  persone: Persona[];
  storia: Evento[];
};

const SENZA = "__nessuno__";

function quando(iso: string) {
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

export default function FinestraTeam({ nome, onChiudi }: { nome: string; onChiudi: () => void }) {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [avviso, setAvviso] = useState<string | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onChiudi();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onChiudi]);

  const carica = async (aggiorna = false) => {
    setErrore(null);
    try {
      const r = await fetch(`/api/utenti/team${aggiorna ? "?aggiorna=1" : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `errore ${r.status}`);
      setDati(d as Dati);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "non si riesce a leggere i team");
    }
  };

  useEffect(() => {
    void carica();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L'AGGANCIO E' SUL NOME NORMALIZZATO: il foglio Operatori e l'anagrafica
  // HubSpot scrivono la stessa persona in modi diversi - maiuscole, spazi
  // doppi, l'apostrofo tipografico - e confrontarli tali e quali fallisce
  // proprio su chi ha un apostrofo nel cognome.
  const persona = useMemo(() => {
    if (!dati) return null;
    const k = chiaveNome(nome);
    return dati.persone.find((p) => p.chiave === k) ?? null;
  }, [dati, nome]);

  const nomiTeam = useMemo(
    () => new Map((dati?.team ?? []).map((t) => [t.id, t.nome])),
    [dati]
  );

  const principali = useMemo(() => (dati?.team ?? []).filter((t) => t.principale), [dati]);

  const sottoAmmessi = useMemo(() => {
    if (!dati || !persona?.principale) return [];
    return (dati.sottoPerPrincipale[persona.principale.id] ?? []).map((id) => ({
      id,
      nome: nomiTeam.get(id) ?? id
    }));
  }, [dati, persona, nomiTeam]);

  const storiaSua = useMemo(() => {
    if (!dati || !persona) return [];
    return dati.storia.filter((e) => e.nome && chiaveNome(e.nome) === persona.chiave);
  }, [dati, persona]);

  const manda = async (corpo: Record<string, string | null>) => {
    if (!persona) return;
    setInCorso(true);
    setAvviso(null);
    try {
      const r = await fetch("/api/utenti/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: persona.userId, ...corpo })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `errore ${r.status}`);
      await carica();
      if (!d.cambiato) setAvviso("Era già così.");
    } catch (e) {
      setAvviso(e instanceof Error ? e.message : "modifica non riuscita");
    } finally {
      setInCorso(false);
    }
  };

  // IL PRINCIPALE CHIEDE CONFERMA e il sotto-team no: l'uno riscrive il team su
  // tutti i contatti e le trattative della persona, l'altro no.
  const cambiaPrincipale = (id: string) => {
    const vecchio = persona?.principale?.nome ?? "nessun team";
    const nuovo = nomiTeam.get(id) ?? id;
    const ok = window.confirm(
      `Spostare ${persona?.nome ?? nome} da ${vecchio} a ${nuovo}?\n\n` +
        "Il team viene riscritto su tutti i suoi contatti e tutte le sue trattative, " +
        "anche quelli di mesi fa, e i record entrano o escono dai filtri per team dei flussi."
    );
    if (ok) void manda({ principale: id });
  };

  const menu =
    "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={onChiudi} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Team di ${nome}`}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900">
              {persona?.nome ?? nome}
            </div>
            {persona?.email ? (
              <div className="mt-0.5 truncate text-xs text-slate-500">{persona.email}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onChiudi}
            className="-mr-1 -mt-0.5 rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {errore ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {errore}
            </div>
          ) : !dati ? (
            <div className="py-6 text-center text-sm text-slate-400">Lettura dei team…</div>
          ) : !persona ? (
            // SI DICE CHE NON SI E' TROVATA, invece di mostrare menu vuoti: un
            // nome del foglio senza utente HubSpot e' una cosa da sapere.
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Nessun utente HubSpot con questo nome.
            </div>
          ) : (
            <>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Team
              </label>
              <select
                value={persona.principale?.id ?? ""}
                onChange={(e) => cambiaPrincipale(e.target.value)}
                disabled={inCorso}
                className={`${menu} mb-4`}
              >
                {persona.principale ? null : <option value="">nessuno</option>}
                {principali.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>

              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Sotto-team
              </label>
              <select
                value={persona.sottoTeam[0]?.id ?? SENZA}
                onChange={(e) => void manda({ sottoTeam: e.target.value === SENZA ? null : e.target.value })}
                disabled={inCorso || !sottoAmmessi.length}
                className={menu}
              >
                <option value={SENZA}>nessuno</option>
                {sottoAmmessi.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>

              {avviso ? (
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {avviso}
                </div>
              ) : null}

              <div className="mt-5 border-t border-slate-100 pt-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Movimenti
                  </span>
                  <button
                    type="button"
                    onClick={() => void carica(true)}
                    className="text-[11px] text-slate-400 hover:text-slate-600"
                  >
                    ↻
                  </button>
                </div>
                {storiaSua.length ? (
                  <ul className="divide-y divide-slate-100">
                    {storiaSua.map((e, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
                        <span className="min-w-0 truncate text-slate-700">
                          <span className={e.azione === "tolto" ? "text-rose-600" : "text-emerald-700"}>
                            {e.azione === "tolto" ? "−" : "+"}
                          </span>{" "}
                          {e.team ?? "—"}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-400">{quando(e.quando)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="py-1 text-xs text-slate-400">nessuno</div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
