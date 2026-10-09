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
  /** 'modifica' | 'osservato' | 'ricostruito'. */
  fonte: string | null;
  /** "18/20" sulle ricostruite: su quanti contatti si e' visto quel cambio. */
  prove: string | null;
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
  const candidati = useMemo(() => {
    if (!dati) return [];
    const k = chiaveNome(nome);
    return dati.persone.filter((p) => p.chiave === k);
  }, [dati, nome]);

  /**
   * QUANDO LO STESSO NOME HA DUE ACCOUNT si deve scegliere, non indovinare.
   *
   * Sul portale sono sei - Nora D'Ascanio ne ha uno con l'indirizzo aziendale e
   * uno con il gmail, e i team stanno solo sul primo. Cercando per nome si
   * prendeva quello che capitava, e cambiare i team avrebbe potuto modificare
   * l'account sbagliato senza che niente lo dicesse: quello vero sarebbe
   * rimasto dov'era e la Dashboard avrebbe continuato a mostrarlo li'.
   *
   * Si parte da quello che ha gia' un sotto-team, perche' e' quello che qualcuno
   * ha configurato; ma la scelta resta visibile e si puo' cambiare.
   */
  const [accountScelto, setAccountScelto] = useState<string | null>(null);
  const persona = useMemo(() => {
    if (!candidati.length) return null;
    if (accountScelto) return candidati.find((c) => c.userId === accountScelto) ?? candidati[0];
    return candidati.find((c) => c.sottoTeam.length) ?? candidati[0];
  }, [candidati, accountScelto]);

  const nomiTeam = useMemo(
    () => new Map((dati?.team ?? []).map((t) => [t.id, t.nome])),
    [dati]
  );

  /**
   * I team fra cui si puo' scegliere: quelli per cui la regola definisce dei
   * sotto-team, cioe' Advisor e Setter.
   *
   * SI RICAVA DALLA REGOLA invece di essere un secondo elenco: due liste da
   * tenere allineate a mano divergono alla prima aggiunta, e la differenza si
   * vedrebbe come un team che compare nel menu ma non offre nessun sotto-team.
   */
  const principali = useMemo(
    () => (dati?.team ?? []).filter((t) => t.principale && dati?.sottoPerPrincipale[t.id]),
    [dati]
  );

  // Se sta in un team che da qui non si sceglie - Customer Success, Coach LMS -
  // va comunque mostrato: il menu deve dire la verita' su dov'e' adesso, anche
  // quando non e' una destinazione possibile.
  const fuoriElenco =
    persona?.principale && !principali.some((t) => t.id === persona.principale!.id)
      ? persona.principale
      : null;

  /**
   * LA SCELTA IN SOSPESO: i menu scrivono qui, non su HubSpot.
   *
   * PERCHE' NON SI APPLICA AL CAMBIO. Un menu che agisce appena si sceglie fa
   * danno da solo: basta la rotella del mouse sopra il campo, o una freccia
   * della tastiera, e la persona e' stata spostata di squadra senza che nessuno
   * abbia deciso niente. E chi apre la finestra per guardare non ha modo di
   * sapere che quei menu non sono etichette.
   *
   * Cosi' invece scegliere non fa niente: compare un riquadro che dice cosa
   * sta per succedere e un pulsante da premere. Il riquadro e' anche la risposta
   * all'altro problema - adesso si vede che quei menu modificano qualcosa.
   */
  const [scelta, setScelta] = useState<{ principale?: string; sotto?: string }>({});
  const principaleScelto = scelta.principale ?? persona?.principale?.id ?? "";

  // I sotto-team seguono il principale SCELTO, non quello attuale: altrimenti
  // scegliendo Setter resterebbero in elenco Programmi ed Eventi, che a un
  // Setter non spettano.
  const sottoAmmessi = useMemo(() => {
    if (!dati || !principaleScelto) return [];
    return (dati.sottoPerPrincipale[principaleScelto] ?? []).map((id) => ({
      id,
      nome: nomiTeam.get(id) ?? id
    }));
  }, [dati, principaleScelto, nomiTeam]);

  const sottoScelto =
    scelta.sotto ??
    (sottoAmmessi.some((x) => x.id === persona?.sottoTeam[0]?.id) ? persona?.sottoTeam[0]?.id ?? "" : "");

  const cambiaPrincipale = principaleScelto !== (persona?.principale?.id ?? "");
  // Il sotto-team cade da se' quando non appartiene al principale scelto: va
  // detto, o sembrerebbe sparito per sbaglio.
  const sottoCade =
    cambiaPrincipale && Boolean(persona?.sottoTeam[0]) && !sottoScelto;
  const cambiaSotto = sottoScelto !== (persona?.sottoTeam[0]?.id ?? "") && !sottoCade;
  const inSospeso = cambiaPrincipale || cambiaSotto;

  /** Gli spostamenti in sospeso, da leggere come "da -> a". */
  const spostamenti: Array<{ da: string; a: string }> = [];
  if (cambiaPrincipale) {
    spostamenti.push({
      da: persona?.principale?.nome ?? "nessun team",
      a: nomiTeam.get(principaleScelto) ?? principaleScelto
    });
  }
  if (cambiaSotto) {
    spostamenti.push({
      da: persona?.sottoTeam[0]?.nome ?? "nessun sotto-team",
      a: nomiTeam.get(sottoScelto) ?? "nessun sotto-team"
    });
  }

  // Come per il principale: se sta in un sotto-team che la regola non prevede
  // per il suo team - Sabina Noia era Advisor + Telefonici, da prima che la
  // regola esistesse - va mostrato lo stesso, non selezionabile. Il menu deve
  // dire dov'e' adesso anche quando e' un posto in cui non si puo' mandare
  // nessuno; nasconderlo farebbe sembrare che non abbia nessun sotto-team.
  const sottoFuoriElenco =
    !cambiaPrincipale && persona?.sottoTeam[0] && !sottoAmmessi.some((t) => t.id === persona.sottoTeam[0].id)
      ? persona.sottoTeam[0]
      : null;

  const storiaSua = useMemo(() => {
    if (!dati || !persona) return [];
    return dati.storia.filter((e) => e.nome && chiaveNome(e.nome) === persona.chiave);
  }, [dati, persona]);

  /**
   * Applica quello che e' stato scelto, in una chiamata sola.
   *
   * IL SOTTO-TEAM SI MANDA SOLO SE E' STATO SCELTO: cambiando il principale,
   * quello vecchio cade da se' lato server - vedi impostaTeam - e mandarlo
   * esplicitamente darebbe un errore invece di una caduta.
   */
  const applica = async () => {
    if (!persona || !inSospeso) return;
    setInCorso(true);
    setAvviso(null);
    try {
      const corpo: Record<string, string | null> = { userId: persona.userId };
      if (cambiaPrincipale) corpo.principale = principaleScelto;
      if (cambiaSotto) corpo.sottoTeam = sottoScelto || null;
      const r = await fetch("/api/utenti/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `errore ${r.status}`);
      setScelta({});
      await carica();
      if (!d.cambiato) setAvviso("Era gia' cosi'.");
    } catch (e) {
      setAvviso(e instanceof Error ? e.message : "modifica non riuscita");
    } finally {
      setInCorso(false);
    }
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
              {candidati.length > 1 ? (
                <>
                  <label className="mb-1 block text-[11px] font-semibold tracking-wide text-amber-700 uppercase">
                    Due account con questo nome
                  </label>
                  <select
                    value={persona.userId}
                    onChange={(e) => setAccountScelto(e.target.value)}
                    disabled={inCorso}
                    className={`${menu} mb-4 border-amber-300`}
                  >
                    {candidati.map((c) => (
                      <option key={c.userId} value={c.userId}>
                        {c.email || c.userId}
                        {c.sottoTeam.length ? ` — ${c.sottoTeam[0].nome}` : ""}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}

              {/* IL VERBO STA SUL COMANDO. Chi apre la finestra per guardare
                  non aveva modo di capire che quei menu modificano qualcosa: lo
                  scopriva cambiandone uno. Scritto qui invece che in un titolo,
                  lo dice il comando stesso, nel momento in cui lo si guarda. */}
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Cambia team
              </label>
              <select
                value={principaleScelto}
                onChange={(e) => setScelta({ principale: e.target.value })}
                disabled={inCorso}
                className={`${menu} mb-4`}
              >
                {persona.principale ? null : (
                  <option value="" disabled>
                    —
                  </option>
                )}
                {fuoriElenco ? (
                  <option value={fuoriElenco.id} disabled>
                    {fuoriElenco.nome}
                  </option>
                ) : null}
                {principali.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>

              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Cambia sotto-team
              </label>
              {/* NIENTE "NESSUNO" FRA LE SCELTE: da qui si sposta, non si
                  svuota. Chi un sotto-team non ce l'ha vede un trattino che non
                  si puo' selezionare - lo stato vero si legge, ma indietro non
                  ci si torna per sbaglio. */}
              <select
                value={sottoScelto || SENZA}
                onChange={(e) => setScelta({ ...scelta, sotto: e.target.value })}
                disabled={inCorso || !sottoAmmessi.length}
                className={menu}
              >
                {persona.sottoTeam.length ? null : (
                  <option value={SENZA} disabled>
                    —
                  </option>
                )}
                {sottoFuoriElenco ? (
                  <option value={sottoFuoriElenco.id} disabled>
                    {sottoFuoriElenco.nome}
                  </option>
                ) : null}
                {sottoAmmessi.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>

              {/* IL RIQUADRO E IL PULSANTE. Finche' non si preme non succede
                  niente: e' la protezione contro il menu toccato per sbaglio,
                  ed e' anche cio' che fa capire che quei menu modificano. */}
              {inSospeso ? (
                <div className="mt-4 rounded border border-slate-300 bg-slate-50 p-3">
                  {/* LO SPOSTAMENTO E LA DOMANDA SULLA STESSA RIGA quando e'
                      uno solo: "Eventi → Programmi: Confermi lo spostamento?"
                      si legge in un colpo. Quando sono due, le righe restano
                      separate e la domanda si fa una volta sola in fondo,
                      invece di ripeterla due volte. */}
                  <div className="text-xs text-slate-800">
                    {spostamenti.map((s, i) => (
                      <div key={i}>
                        <strong>{s.da}</strong> → <strong>{s.a}</strong>
                        {spostamenti.length === 1 ? ": Confermi lo spostamento?" : null}
                      </div>
                    ))}
                    {spostamenti.length > 1 ? <div className="mt-0.5">Confermi lo spostamento?</div> : null}
                    {sottoCade ? (
                      <div className="mt-0.5 text-slate-600">
                        {persona.sottoTeam[0]?.nome} non appartiene a{" "}
                        {nomiTeam.get(principaleScelto) ?? principaleScelto}: viene tolto.
                      </div>
                    ) : null}
                  </div>

                  {/* L'AVVISO STA QUI E NON IN UNA FINESTRA DEL BROWSER: un
                      confirm si chiude per riflesso, questo si legge mentre si
                      guarda il pulsante che si sta per premere. */}
                  {cambiaPrincipale ? (
                    <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900">
                      Il team viene riscritto su <strong>tutti</strong> i suoi contatti e tutte le sue
                      trattative, anche quelli di mesi fa, e quei record entrano o escono dai filtri
                      per team dei flussi.
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void applica()}
                      disabled={inCorso}
                      /* ARANCIONE E NON ROSSO. Nella dashboard l'ambra e' gia' il
                         colore dell'attenzione - i riquadri d'avviso e d'errore
                         sono tutti cosi' - mentre il rosso vive solo sui "−"
                         delle uscite qui sotto, e su un pulsante si leggerebbe
                         come "elimina". */
                      className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:bg-amber-200"
                    >
                      {inCorso ? "…" : "Confermo"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setScelta({})}
                      disabled={inCorso}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:text-slate-400"
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              ) : null}

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
                          {/* RICOSTRUITO NON E' OSSERVATO. Queste righe sono
                              dedotte dalla cronologia dei contatti, e il numero
                              dice quanto reggono: 20/20 e' praticamente certo,
                              1/1 e' una persona con un contatto solo. */}
                          {e.fonte === "ricostruito" ? (
                            <span
                              className="ml-1.5 text-[10px] text-slate-400"
                              title={`Ricostruito dalla cronologia dei contatti${e.prove ? `, visto su ${e.prove}` : ""}`}
                            >
                              ~{e.prove ?? "ricostruito"}
                            </span>
                          ) : null}
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
