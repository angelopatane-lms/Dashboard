"use client";

import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import SectionTitle from "@/components/ui/SectionTitle";
import { formatInt } from "@/lib/format";

/**
 * Stato e comandi della riassegnazione automatica, dall'app Employee Manager.
 *
 * UNO STATO SOLO, DUE POSTI DA CUI GUARDARLO. Qui non si tiene una copia di
 * niente: gli interruttori leggono e scrivono le stesse righe di `app_settings`
 * che muove la pagina dell'app. Due pannelli che comandano la stessa cosa
 * possono divergere in un modo solo - mostrando un valore vecchio - e a quello
 * servono le tre regole qui sotto:
 *
 *   1. dopo un comando si usa lo stato che RISPONDE l'app, non quello che ci si
 *      aspettava: se nel frattempo qualcuno ha cambiato altro, si vede subito;
 *   2. si rilegge quando la scheda torna in primo piano, che e' il momento in
 *      cui si torna qui dopo essere stati di la';
 *   3. si rilegge ogni minuto mentre la sezione e' visibile.
 *
 * Anche le parole sono le stesse dell'app - Sistema, Giorni, Feriali, Week End -
 * perche' due nomi diversi per la stessa cosa sono il modo piu' rapido di non
 * capirci piu' niente.
 *
 * PERCHE' NON L'APP DENTRO UN RIQUADRO, che era la richiesta iniziale: provato
 * il 5 ottobre 2026, dentro compare il login. Il suo cookie di sessione non e'
 * marcato `SameSite=None`, quindi il browser non lo manda quando la pagina sta
 * su un altro indirizzo, e non si aggira accedendo li' dentro. Marcarlo si
 * poteva, ma quell'app non ha protezione CSRF e il SameSite e' l'unica difesa
 * che ha oggi.
 */

const APP_ASSEGNAZIONI = "https://lms.217.154.117.118.nip.io/admin/lead-assignment";

type Stato = {
  sistema_acceso: boolean;
  modalita_live: boolean;
  giorni: "nessuno" | "feriali" | "weekend" | "entrambi" | string;
  /** null quando HubSpot non ha risposto: diverso da zero, e si mostra diverso. */
  pool_a: number | null;
  pool_b: number | null;
  riserva: number;
  riserva_max: number;
  assegnati_oggi: number;
  persone_oggi: number;
  ultima_assegnazione: string | null;
  /** Le sigle separate da virgola, anche quando il filtro e' spento: spegnere
   *  non deve far perdere quello che si e' scelto. */
  campagne_sospese: string;
  campagne_sospese_attivo: boolean;
};

const GIORNI_ETICHETTA: Record<string, string> = {
  // Vuota di proposito: senza giorni scelti non c'e' nessuna finestra da
  // descrivere, e gli interruttori tutti spenti lo dicono gia'.
  nessuno: "",
  feriali: "Lun–Ven, 07:00–20:00",
  weekend: "Sab–Dom, 07:00–20:00",
  entrambi: "tutti i giorni, 07:00–20:00"
};

/** Un numero della striscia in alto. Senza riquadro proprio: i riquadri dentro
 *  il riquadro erano la cosa che faceva sembrare ammassata la sezione. */
function Numero({ valore, etichetta }: { valore: string; etichetta: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-xl font-semibold tabular-nums text-slate-900">{valore}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">{etichetta}</div>
    </div>
  );
}

/** Una riga di comando: nome a sinistra, stato in mezzo, interruttori a destra.
 *  La colonna del nome ha larghezza fissa, cosi' le tre righe si incolonnano. */
function Riga({
  nome,
  stato,
  aiuto,
  children
}: {
  nome: string;
  stato?: React.ReactNode;
  aiuto?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="w-32 shrink-0 cursor-help text-sm font-medium text-slate-800" title={aiuto}>
        {nome}
      </span>
      <span className="min-w-0 flex-1 text-xs text-slate-500">{stato}</span>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div>
    </div>
  );
}

function Interruttore({
  acceso,
  etichetta,
  disabilitato,
  onChange
}: {
  acceso: boolean;
  etichetta: string;
  disabilitato: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 text-sm text-slate-700 ${
        disabilitato ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      {etichetta}
      <span
        className={`relative inline-block h-5 w-9 rounded-full transition ${
          acceso ? "bg-slate-900" : "bg-slate-300"
        }`}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={acceso}
          disabled={disabilitato}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            acceso ? "left-[1.125rem]" : "left-0.5"
          }`}
        />
      </span>
    </label>
  );
}

export default function AssegnazioneContatti() {
  const [stato, setStato] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  // Evita che una risposta lenta arrivata dopo una piu' recente la sovrascriva:
  // succede toccando un interruttore mentre parte il giro automatico.
  const richiesta = useRef(0);

  const applica = useCallback((dati: Stato & { error?: string }, mio: number) => {
    if (mio !== richiesta.current) return;
    if (dati?.error) setErrore(dati.error);
    else {
      setStato(dati);
      setErrore(null);
    }
  }, []);

  const leggi = useCallback(() => {
    const mio = ++richiesta.current;
    fetch("/api/assegnazione-lead", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => applica(d, mio))
      .catch((e) => mio === richiesta.current && setErrore(String(e)));
  }, [applica]);

  useEffect(() => {
    leggi();
    const ogniMinuto = setInterval(() => {
      if (document.visibilityState === "visible") leggi();
    }, 60_000);
    const alRitorno = () => document.visibilityState === "visible" && leggi();
    document.addEventListener("visibilitychange", alRitorno);
    window.addEventListener("focus", alRitorno);
    return () => {
      clearInterval(ogniMinuto);
      document.removeEventListener("visibilitychange", alRitorno);
      window.removeEventListener("focus", alRitorno);
    };
  }, [leggi]);

  const comanda = useCallback(
    (comando: Record<string, boolean | string>) => {
      const mio = ++richiesta.current;
      setInCorso(true);
      fetch("/api/assegnazione-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comando)
      })
        .then((r) => r.json())
        .then((d) => applica(d, mio))
        .catch((e) => mio === richiesta.current && setErrore(String(e)))
        .finally(() => setInCorso(false));
    },
    [applica]
  );

  // Le campagne Live raggruppate per famiglia: una campagna e le sue varianti
  // sono una voce sola nel menu, ma si salvano con i nomi interi. Si legge una
  // volta: cambia quando nasce una campagna, non durante la giornata.
  const [famiglie, setFamiglie] = useState<Array<{ base: string; nomi: string[] }>>([]);
  useEffect(() => {
    fetch("/api/campagne-live", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setFamiglie(d.campagne ?? []))
      .catch(() => setFamiglie([]));
  }, []);

  const scelte = (stato?.campagne_sospese ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const salvaScelte = (elenco: string[]) => comanda({ campagne_sospese: elenco.join(",") });

  /**
   * Le campagne scelte, raggruppate come nel menu: una targhetta per famiglia
   * invece di una per nome. Sei nomi lunghissimi su tre righe erano il grosso
   * dell'ingombro, e ripetevano tre volte lo stesso prefisso.
   *
   * I nomi interi restano quelli salvati e si leggono passando col mouse: la
   * targhetta e' un modo di mostrarli, non un modo di accorciarli.
   */
  const scelteRaggruppate = (() => {
    const gruppi = new Map<string, string[]>();
    for (const nome of scelte) {
      const chiave = famiglie.find((f) => f.nomi.includes(nome))?.base ?? nome;
      gruppi.set(chiave, [...(gruppi.get(chiave) ?? []), nome]);
    }
    return [...gruppi.entries()].map(([base, nomi]) => ({ base, nomi }));
  })();

  const feriali = stato?.giorni === "feriali" || stato?.giorni === "entrambi";
  const weekend = stato?.giorni === "weekend" || stato?.giorni === "entrambi";
  const bloccato = inCorso || !stato;

  return (
    <section>
      {/* Il collegamento all'app sta sulla riga del titolo: la fascia che aveva
          prima spiegava a parole cose che i comandi qui sotto dicono da soli. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionTitle className="mb-0">Riassegnazione Automatica</SectionTitle>
        <a
          href={APP_ASSEGNAZIONI}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
        >
          Apri l&apos;app
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-3.5 w-3.5"
          >
            <path d="M7 4h9v9M16 4L7 13" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 11v5H4V7h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>

      {/* UN RIQUADRO SOLO, diviso da righe sottili. Prima erano cinque riquadri
          dentro un sesto: il bordo ripetuto faceva sembrare ammassato un
          contenuto che ammassato non e'. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-5 sm:divide-y-0">
          <Numero valore={stato?.pool_a != null ? formatInt(stato.pool_a) : "–"} etichetta="Pool serie A" />
          <Numero valore={stato?.pool_b != null ? formatInt(stato.pool_b) : "–"} etichetta="Pool serie B" />
          <Numero valore={stato ? `${stato.riserva}/${stato.riserva_max}` : "–"} etichetta="Riserva A oggi" />
          <Numero valore={stato ? formatInt(stato.assegnati_oggi) : "–"} etichetta="Assegnati oggi" />
          <Numero valore={stato ? formatInt(stato.persone_oggi) : "–"} etichetta="Persone oggi" />
        </div>

        {/* Le spiegazioni lunghe sono diventate suggerimenti sul nome del
            comando: occupavano piu' spazio dei comandi stessi, e chi le ha
            lette una volta non ha bisogno di rileggerle ogni giorno. */}
        <div className="divide-y divide-slate-100">
          <Riga
            nome="Sistema"
            aiuto="Se spento, le richieste su Slack vengono ignorate e non si recuperano alla riaccensione."
            stato={
              stato ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      stato.sistema_acceso
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {stato.sistema_acceso ? "Attivo" : "Spento"}
                  </span>
                  {stato.modalita_live === false ? (
                    <span
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                      title="Le assegnazioni vengono simulate, non scritte su HubSpot."
                    >
                      Dry Run
                    </span>
                  ) : null}
                </span>
              ) : null
            }
          >
            <Interruttore
              acceso={Boolean(stato?.sistema_acceso)}
              etichetta="Attivo"
              disabilitato={bloccato}
              onChange={(v) => {
                // La conferma c'e' solo in accensione, e solo quando assegna
                // davvero: da qui si fa partire la distribuzione dei contatti
                // su un'altra applicazione, e un clic di troppo non deve farlo.
                if (
                  v &&
                  stato?.modalita_live &&
                  !confirm("Le assegnazioni ripartono subito, su HubSpot. Procedo?")
                ) {
                  return;
                }
                comanda({ sistema: v });
              }}
            />
          </Riga>

          <Riga
            nome="Giorni"
            aiuto="Nei giorni scelti il Sistema si accende da solo alle 07:00 e si spegne alle 20:00. Senza nessun giorno non si muove da solo: resta dove lo metti tu."
            stato={stato ? GIORNI_ETICHETTA[stato.giorni] ?? stato.giorni : null}
          >
            <Interruttore
              acceso={feriali}
              etichetta="Feriali"
              disabilitato={bloccato}
              onChange={(v) => comanda({ feriali: v, weekend })}
            />
            <Interruttore
              acceso={weekend}
              etichetta="Week End"
              disabilitato={bloccato}
              onChange={(v) => comanda({ feriali, weekend: v })}
            />
            <Interruttore
              acceso={feriali && weekend}
              etichetta="Tutti"
              disabilitato={bloccato}
              onChange={(v) => comanda({ feriali: v, weekend: v })}
            />
          </Riga>

          <div>
            <Riga
              nome="Campagne"
              aiuto="I contatti di queste campagne non vengono assegnati, finche' il filtro resta attivo. Si scelgono fra le campagne Live: una campagna e le sue varianti si aggiungono insieme e restano salvate con i nomi interi."
              stato={
                stato && scelte.length
                  ? `${scelte.length} ${scelte.length === 1 ? "campagna esclusa" : "campagne escluse"}${
                      stato.campagne_sospese_attivo ? "" : ", filtro spento"
                    }`
                  : null
              }
            >
              <select
                value=""
                disabled={bloccato || famiglie.length === 0}
                onChange={(e) => {
                  const scelta = famiglie.find((f) => f.base === e.target.value);
                  // Si aggiungono TUTTI i nomi della famiglia, interi: la voce
                  // del menu e' un raggruppamento, non un nome accorciato.
                  if (scelta) {
                    salvaScelte([...scelte, ...scelta.nomi.filter((n) => !scelte.includes(n))]);
                  }
                }}
                className="max-w-[16rem] rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 outline-none transition hover:border-slate-400 focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {famiglie.length ? "escludi campagna" : "elenco non disponibile"}
                </option>
                {famiglie
                  .filter((f) => f.nomi.some((n) => !scelte.includes(n)))
                  .map((f) => (
                    <option key={f.base} value={f.base}>
                      {f.base}
                      {f.nomi.length > 1 ? `  (${f.nomi.length} varianti)` : ""}
                    </option>
                  ))}
              </select>
              <Interruttore
                acceso={Boolean(stato?.campagne_sospese_attivo)}
                etichetta={stato?.campagne_sospese_attivo ? "On" : "Off"}
                disabilitato={bloccato}
                onChange={(v) => comanda({ campagne_sospese_attivo: v })}
              />
            </Riga>

            {/* Le targhette stanno SOTTO IL MENU, allineate a destra come lui:
                sono quello che il menu ha prodotto, e messe a sinistra
                sembravano una cosa a se'. Compaiono solo quando ce n'e'
                almeno una: una riga vuota era spazio speso per niente. */}
            {scelteRaggruppate.length ? (
              <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3">
                {scelteRaggruppate.map((g) => (
                  <span
                    key={g.base}
                    title={g.nomi.join(", ")}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                      stato?.campagne_sospese_attivo
                        ? "border-slate-200 bg-slate-50 text-slate-700"
                        : "border-slate-200 bg-white text-slate-400"
                    }`}
                  >
                    <span className="truncate font-mono">{g.base}</span>
                    {g.nomi.length > 1 ? (
                      <span className="shrink-0 text-slate-400">+{g.nomi.length - 1}</span>
                    ) : null}
                    <button
                      type="button"
                      disabled={bloccato}
                      onClick={() => salvaScelte(scelte.filter((x) => !g.nomi.includes(x)))}
                      className="shrink-0 text-slate-300 transition hover:text-rose-600 disabled:cursor-not-allowed"
                      title={`Togli ${g.base}${g.nomi.length > 1 ? " e le sue varianti" : ""}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {errore ? (
          <div className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
            {errore}
          </div>
        ) : null}
      </div>
    </section>
  );
}
