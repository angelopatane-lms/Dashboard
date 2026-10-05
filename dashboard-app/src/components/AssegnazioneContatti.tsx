"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SectionTitle from "@/components/ui/SectionTitle";
import { formatInt } from "@/lib/format";

/**
 * Stato e comandi dell'assegnazione contatti, dall'app Employee Manager.
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
 * Anche le parole sono le stesse dell'app - Sistema, Giorni, Feriali, Week End,
 * Tutti i Giorni - perche' due nomi diversi per la stessa cosa sono il modo
 * piu' rapido di non capirci piu' niente.
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
};

const GIORNI_ETICHETTA: Record<string, string> = {
  nessuno: "Nessun automatismo — comanda solo il Sistema",
  feriali: "Lun–Ven, 07:00–20:00",
  weekend: "Sab–Dom, 07:00–20:00",
  entrambi: "Tutti i giorni, 07:00–20:00"
};

function Numero({ valore, etichetta }: { valore: string; etichetta: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-slate-900">{valore}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{etichetta}</div>
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
      className={`inline-flex items-center gap-2 text-sm ${
        disabilitato ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
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
      {etichetta}
    </label>
  );
}

export default function AssegnazioneContatti() {
  const [stato, setStato] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [letturaAlle, setLetturaAlle] = useState<string | null>(null);
  // Evita che una risposta lenta arrivata dopo una piu' recente la sovrascriva:
  // succede tenendo premuto un interruttore mentre parte il giro automatico.
  const richiesta = useRef(0);

  const applica = useCallback((dati: Stato & { error?: string }, mio: number) => {
    if (mio !== richiesta.current) return;
    if (dati?.error) setErrore(dati.error);
    else {
      setStato(dati);
      setErrore(null);
      setLetturaAlle(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
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
    (comando: Record<string, boolean>) => {
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

  const feriali = stato?.giorni === "feriali" || stato?.giorni === "entrambi";
  const weekend = stato?.giorni === "weekend" || stato?.giorni === "entrambi";
  const bloccato = inCorso || !stato;

  return (
    <section>
      <SectionTitle>Assegnazione Contatti</SectionTitle>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">
              Employee Manager — Assegnazione Lead
            </p>
            <p className="mt-1 text-sm text-slate-600">
              I contatti vengono assegnati su richiesta dal bot Slack. Gli stessi comandi
              dell&apos;app: quello che cambi qui si vede di là, e viceversa.
            </p>
          </div>
          <a
            href={APP_ASSEGNAZIONI}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Apri l&apos;app
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
              <path d="M7 4h9v9M16 4L7 13" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13 11v5H4V7h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        {errore ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {errore}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Numero valore={stato?.pool_a != null ? formatInt(stato.pool_a) : "–"} etichetta="Pool serie A" />
          <Numero valore={stato?.pool_b != null ? formatInt(stato.pool_b) : "–"} etichetta="Pool serie B" />
          <Numero
            valore={stato ? `${stato.riserva}/${stato.riserva_max}` : "–"}
            etichetta="Riserva A oggi"
          />
          <Numero valore={stato ? formatInt(stato.assegnati_oggi) : "–"} etichetta="Assegnati oggi" />
          <Numero valore={stato ? formatInt(stato.persone_oggi) : "–"} etichetta="Persone oggi" />
        </div>

        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold text-slate-800">Sistema</span>
              <span
                className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                  stato?.sistema_acceso ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                }`}
              >
                {stato ? (stato.sistema_acceso ? "Attivo" : "Spento") : "…"}
              </span>
              <span className="ml-2 text-xs text-slate-500">
                Se spento, le richieste su Slack vengono ignorate e non si recuperano.
              </span>
            </div>
            <Interruttore
              acceso={Boolean(stato?.sistema_acceso)}
              etichetta="Attivo"
              disabilitato={bloccato}
              onChange={(v) => {
                // La conferma c'e' solo in accensione, e solo quando assegna
                // davvero: da qui si fa partire la distribuzione dei contatti
                // su un'altra applicazione, e un clic di troppo non deve farlo.
                if (v && stato?.modalita_live && !confirm("Le assegnazioni ripartono subito, su HubSpot. Procedo?")) return;
                comanda({ sistema: v });
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold text-slate-800">Giorni</span>
              <span className="ml-2 text-xs text-slate-500">
                {stato ? GIORNI_ETICHETTA[stato.giorni] ?? stato.giorni : "…"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Interruttore
                acceso={feriali}
                etichetta="Giorni Feriali"
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
                etichetta="Tutti i Giorni"
                disabilitato={bloccato}
                onChange={(v) => comanda({ feriali: v, weekend: v })}
              />
            </div>
          </div>
        </div>

        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {stato?.modalita_live === false ? (
            <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
              Modalità Dry Run: le assegnazioni sono simulate
            </span>
          ) : null}
          {letturaAlle ? `Letto alle ${letturaAlle}, si aggiorna da solo ogni minuto.` : "Lettura in corso…"}
        </p>
      </div>
    </section>
  );
}
