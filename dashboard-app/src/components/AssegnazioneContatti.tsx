"use client";

import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import CampagnePersona from "@/components/CampagnePersona";
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

/**
 * Fin dove si puo' tornare indietro.
 *
 * Non e' un limite dei dati - l'archivio li tiene tutti - ma delle frecce: per
 * arrivare a un mese fa servirebbero trenta clic, e a quel punto serve un
 * calendario, non una freccia. Trenta e' dove le frecce smettono di avere
 * senso.
 */
const GIORNI_INDIETRO = 30;

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
  /**
   * Quanti lead sono davvero assegnabili, non quanti ce ne sono.
   *
   * `pool_a` e `pool_b` contano tutti i contatti senza proprietario; questi
   * tolgono quelli che nessuna richiesta potrebbe mai ricevere, a partire dai
   * troppo vecchi. L'8 ottobre 2026 erano 525 su 38.299.
   *
   * Assenti quando HubSpot non ha risposto: si mostra il grezzo e basta,
   * invece di uno zero che si leggerebbe come serbatoio esaurito.
   */
  assegnabili_a?: number | null;
  assegnabili_b?: number | null;
};

/**
 * Chi ha ricevuto lead oggi, dalla rotta che lo ricostruisce da HubSpot.
 *
 * L'app dice QUANTI e a QUANTE persone, mai a chi: il suo database sta sul suo
 * server e da qui non si raggiunge. Il dettaglio arriva dalla cronologia del
 * proprietario su HubSpot, filtrata sull'integrazione che assegna.
 */
type Dettaglio = {
  giorno: string;
  righe: Array<{
    proprietarioId: string;
    nome: string;
    lead: number;
    prima: string | null;
    ultima: string | null;
  }>;
  totale: number;
  persone: number;
  /** Il totale che dichiara l'app, per confronto. null quando non ha risposto. */
  atteso: number | null;
  aggiornatoAt: string;
  dallArchivio: boolean;
  /**
   * Le richieste della giornata, servite e no, come le racconta l'app.
   *
   * Non si ricavano da HubSpot: un rifiuto non tocca nessun contatto, quindi
   * li' non esiste. null quando la lettura e' fallita - diverso da un elenco
   * vuoto, che vuol dire "nessuno ha chiesto".
   */
  richieste?: Array<{
    id: string;
    chiestoAt: string;
    nome: string | null;
    ruolo: string | null;
    esito: string;
    motivo: string | null;
    lead: number;
    serie: string | null;
    richiestaN: number | null;
    pendenti: number | null;
    appuntamenti: number | null;
  }> | null;
  error?: string;
};

/** L'ora di una marca temporale, come la si legge a colpo d'occhio. */
/**
 * Per quanto si riusa la ricostruzione del dettaglio, in minuti.
 *
 * E' lo stesso valore di FRESCHEZZA_MINUTI in src/lib/assegnazioni/giorno.ts,
 * dove la ricostruzione viene davvero riusata. Qui serve solo a distinguere
 * "elenco in ritardo" da "elenco incompleto": se di la' si cambia, qui si
 * sbaglia la distinzione, non il dato.
 */
const FRESCHEZZA_DETTAGLIO_MINUTI = 5;

function ora(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Cosa dice la colonna di mezzo di ogni riga.
 *
/**
 * La finestra per esteso, scritta come la si direbbe a voce.
 *
 * Gli interruttori dicono QUALI giorni; questa dice la finestra che ne esce,
 * orari compresi - che e' l'unica cosa che guardandoli non si ricava.
 */
const GIORNI_ETICHETTA: Record<string, string> = {
  nessuno: "Nessuna",
  feriali: "da LUN a VEN dalle 7:00 alle 20:00",
  weekend: "da SAB a DOM dalle 7:00 alle 20:00",
  entrambi: "da LUN a DOM dalle 7:00 alle 20:00"
};

/**
 * Un numero della striscia in alto.
 *
 * NIENTE RIQUADRO PROPRIO: i riquadri dentro il riquadro erano la cosa che
 * faceva sembrare ammassata la sezione.
 *
 * E NIENTE NUMERI PIU' GRANDI, che e' la tentazione naturale guardando una
 * fascia che sembra vuota. Subito sotto questa sezione c'e' il numero dei
 * contatti di marketing, che e' quello che se sale costa soldi: se questi
 * pesassero uguale, l'occhio non saprebbe piu' dove andare per primo. Questi
 * sono valori di STATO - c'e' materiale? oggi e' partito qualcosa? - e si
 * leggono di sfuggita. Il problema non era la dimensione ma lo spazio attorno,
 * e si risolve stringendo.
 *
 * LO ZERO E' SMORZATO perche' "niente" non deve attirare l'occhio quanto un
 * numero vero: a parita' di nero, `0 assegnati oggi` gridava come `31.753`.
 */
function Numero({
  valore,
  etichetta,
  nota
}: {
  valore: string;
  etichetta: string;
  /** Una riga piccola sotto il numero: serve a dire da cosa e' ricavato. */
  nota?: string;
}) {
  const vuoto = valore === "0" || valore === "–";
  return (
    // LA STESSA CARTA DI STATO CONTATTI DI MARKETING, misura per misura:
    // stesso bordo, stesso fondo, stesse tre righe. Prima questi numeri erano
    // una striscia dentro il riquadro dei comandi, separati solo da un filo:
    // dato e comando sullo stesso bianco, senza gerarchia. Staccati si legge
    // al volo cosa si guarda e cosa si usa - ed e' la forma che la pagina usa
    // gia' poco piu' in basso.
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {etichetta}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          vuoto ? "text-slate-300" : "text-slate-900"
        }`}
      >
        {valore}
      </div>
      {nota ? <div className="mt-0.5 text-xs text-slate-500">{nota}</div> : null}
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
      <span className="w-44 shrink-0 cursor-help text-sm font-medium text-slate-800" title={aiuto}>
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

  /**
   * Il dettaglio per persona.
   *
   * NON SI RILEGGE OGNI MINUTO come il resto della sezione. Ricostruirlo costa
   * una trentina di chiamate a HubSpot - va letta la cronologia di tutti i
   * contatti che hanno cambiato proprietario oggi - su un token condiviso con
   * decine di flussi Zapier che ha un tetto di 19 chiamate al secondo. La rotta
   * tiene il risultato per cinque minuti, ma anche solo chiederglielo in
   * continuazione sarebbe spendere il budget di tutti per un riquadro.
   *
   * SI RILEGGE QUANDO IL TOTALE SI MUOVE, che e' l'unico momento in cui il
   * dettaglio puo' essere cambiato: `assegnati_oggi` arriva dal giro leggero
   * ogni minuto e costa una chiamata sola.
   */
  const [dettaglio, setDettaglio] = useState<Dettaglio | null>(null);
  const [dettaglioInCorso, setDettaglioInCorso] = useState(false);
  const totaleVisto = useRef<number | null>(null);

  /**
   * Quale giornata si sta guardando. Scostamento in giorni: 0 oggi, 1 ieri.
   *
   * I GIORNI PASSATI VENGONO DALL'ARCHIVIO e non si ricalcolano mai, quindi
   * compaiono subito e non costano una chiamata a HubSpot. Non e' una scelta
   * di comodo: `hubspot_owner_assigneddate` conserva solo l'ULTIMA
   * assegnazione, percio' un contatto riassegnato domani sparirebbe da oggi e
   * un giorno ricalcolato tornerebbe piu' povero del vero, senza dirlo. Quel
   * che e' stato fotografato e' tutto quello che avremo.
   */
  const [indietro, setIndietro] = useState(0);

  /** Se l'elenco e' aperto. Chiuso finche' qualcuno non lo chiede. */
  const [aperto, setAperto] = useState(false);

  const giornoIso = useCallback((scostamento: number) => {
    const d = new Date();
    d.setDate(d.getDate() - scostamento);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const leggiDettaglio = useCallback(
    (scostamento = 0) => {
      setDettaglioInCorso(true);
      const q = scostamento === 0 ? "" : `?giorno=${giornoIso(scostamento)}`;
      fetch(`/api/assegnazione-lead/dettaglio${q}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: Dettaglio) => setDettaglio(d))
        .catch((e) => setDettaglio({ error: String(e) } as Dettaglio))
        .finally(() => setDettaglioInCorso(false));
    },
    [giornoIso]
  );

  useEffect(() => {
    // SOLO A ELENCO APERTO: chiuso, quelle trenta chiamate pagherebbero un
    // riquadro che nessuno sta guardando.
    if (!aperto) return;
    // E solo mentre si guarda oggi: su una giornata passata il totale corrente
    // non c'entra niente, e rileggerla la riporterebbe a oggi sotto le mani.
    if (indietro !== 0) return;
    const totale = stato?.assegnati_oggi;
    if (totale == null) return;
    if (totaleVisto.current === totale) return;
    totaleVisto.current = totale;
    leggiDettaglio(0);
  }, [stato?.assegnati_oggi, leggiDettaglio, indietro, aperto]);

  const vaiA = useCallback(
    (scostamento: number) => {
      if (scostamento < 0) return;
      // Cambiare giorno a elenco chiuso non mostrerebbe niente: il gesto dice
      // gia' che si vuole guardare.
      setAperto(true);
      setIndietro(scostamento);
      leggiDettaglio(scostamento);
    },
    [leggiDettaglio]
  );

  /** "oggi", "ieri", oppure la data per esteso. */
  const etichettaGiorno = (scostamento: number): string => {
    if (scostamento === 0) return "oggi";
    if (scostamento === 1) return "ieri";
    const d = new Date();
    d.setDate(d.getDate() - scostamento);
    return d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "long" });
  };

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

      {/* I NUMERI FUORI DAL RIQUADRO DEI COMANDI. Sono due cose diverse - i
          numeri si leggono di sfuggita, i comandi si usano - e stando sullo
          stesso bianco separati da un filo non lo sembravano. Staccati sono
          la stessa forma di Stato Contatti di Marketing, poco piu' in basso
          nella stessa pagina. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* L'ASSEGNABILE DAVANTI, IL GREZZO SOTTO. Il numero grande e' quello
              su cui si decide: il serbatoio grezzo diceva decine di migliaia
              mentre le richieste tornavano con quattro lead. Quando il
              conteggio non arriva si mostra il grezzo come prima, perche' un
              trattino al posto di un numero che c'e' sarebbe un passo
              indietro. */}
          <Numero
            valore={
              stato?.assegnabili_a != null
                ? formatInt(stato.assegnabili_a)
                : stato?.pool_a != null
                  ? formatInt(stato.pool_a)
                  : "–"
            }
            etichetta="Pool serie A"
            nota={
              stato?.assegnabili_a != null && stato?.pool_a != null
                ? `assegnabili, su ${formatInt(stato.pool_a)}`
                : undefined
            }
          />
          <Numero
            valore={
              stato?.assegnabili_b != null
                ? formatInt(stato.assegnabili_b)
                : stato?.pool_b != null
                  ? formatInt(stato.pool_b)
                  : "–"
            }
            etichetta="Pool serie B"
            nota={
              stato?.assegnabili_b != null && stato?.pool_b != null
                ? `assegnabili, su ${formatInt(stato.pool_b)}`
                : undefined
            }
          />
          <Numero valore={stato ? formatInt(stato.assegnati_oggi) : "–"} etichetta="Assegnati oggi" />
          <Numero valore={stato ? formatInt(stato.persone_oggi) : "–"} etichetta="Persone oggi" />
      </div>

      {/* UN RIQUADRO SOLO PER I COMANDI, diviso da righe sottili. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">

        {/* L'ORDINE DICE A COSA SERVE LA SEZIONE: prima i numeri, che si
            leggono di sfuggita per sapere se c'e' materiale e se oggi e'
            partito qualcosa; poi i comandi, che e' quello che si viene a
            fare; in fondo l'elenco di chi ha ricevuto, che si consulta
            quando serve e non deve mettersi in mezzo. */}
        <div className="divide-y divide-slate-100 border-b border-slate-100">
          <Riga
            nome="Stato del Sistema"
            aiuto="Se spento, le richieste su Slack vengono ignorate e non si recuperano alla riaccensione."
            stato={
              stato ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span>{stato.sistema_acceso ? "Acceso" : "Spento"}</span>
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
              etichetta={stato?.sistema_acceso ? "On" : "Off"}
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
            nome="Finestra di Operatività"
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
              nome="Campagne da Escludere"
              aiuto="I contatti di queste campagne non vengono assegnati, finche' il filtro resta attivo. Si scelgono fra le campagne Live: una campagna e le sue varianti si aggiungono insieme e restano salvate con i nomi interi."
              stato="Workshop"
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
                  {famiglie.length ? "seleziona campagne" : "elenco non disponibile"}
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

          {/* CHI RICEVE COSA, sotto CHE COSA NON SI ASSEGNA. Le due righe
              parlano della stessa materia - le campagne - e l'ordine conta:
              prima quello che non esce per nessuno, poi a chi esce per primo
              quello che resta. */}
          <CampagnePersona bloccato={bloccato} />
        </div>

        {/* CHI HA RICEVUTO, che e' l'unica cosa che i due numeri qui sopra non
            dicono. Sta subito sotto di loro perche' ne e' la scomposizione: il
            totale e la somma di questa colonna sono lo stesso numero. */}
        <div>
          {/* TRE COSE SULLA STESSA RIGA: il giorno a sinistra, l'apertura al
              centro, l'aggiornamento a destra. Il titolo fisso "Chi ha
              ricevuto oggi" e' diventato il comando che apre: diceva quello
              che l'elenco dice da se', e adesso almeno serve a qualcosa. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pt-3">
            {/* LE FRECCE INVECE DI UN CALENDARIO: quasi sempre si vuole ieri,
                e con un calendario ieri costa tre clic invece di uno.
                Compaiono con l'elenco: a lista chiusa il giorno non si vede,
                quindi cambiarlo non mostrerebbe niente. */}
            <div className={`flex items-center gap-1 justify-self-start ${aperto ? "" : "invisible"}`}>
              <button
                type="button"
                aria-label="Giorno precedente"
                onClick={() => vaiA(indietro + 1)}
                disabled={dettaglioInCorso || indietro >= GIORNI_INDIETRO}
                className="rounded px-1.5 py-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                ‹
              </button>
              <span className="min-w-[7rem] text-center text-[11px] uppercase tracking-wide text-slate-500">
                {etichettaGiorno(indietro)}
              </span>
              <button
                type="button"
                aria-label="Giorno successivo"
                onClick={() => vaiA(indietro - 1)}
                disabled={dettaglioInCorso || indietro === 0}
                className="rounded px-1.5 py-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                ›
              </button>
            </div>

            {/* IL COMANDO CHE APRE L'ELENCO.
                Chiuso di partenza, e non per ordine: ricostruire il dettaglio
                costa una trentina di chiamate a HubSpot su un token condiviso
                con decine di flussi Zapier. Chi apre la sezione quasi sempre
                viene per gli interruttori; cosi' quelle chiamate si spendono
                solo quando qualcuno vuole davvero vedere l'elenco. */}
            <button
              type="button"
              onClick={() => setAperto((v) => !v)}
              aria-expanded={aperto}
              className="flex items-center gap-1.5 justify-self-center text-[11px] uppercase tracking-wide text-slate-500 transition hover:text-slate-900"
            >
              Dettaglio assegnazioni
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`h-3 w-3 transition-transform ${aperto ? "rotate-180" : ""}`}
              >
                <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* AGGIORNA SOLO SU OGGI. Una giornata passata non si ricalcola -
                HubSpot non la sa piu' - quindi un bottone che promette di
                rinfrescarla direbbe una bugia. */}
            {!aperto ? null : indietro === 0 ? (
              <button
                type="button"
                aria-label="Aggiorna"
                title="Aggiorna"
                onClick={() => {
                  setAperto(true);
                  leggiDettaglio(0);
                }}
                disabled={dettaglioInCorso}
                className="justify-self-end rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {/* GIRA MENTRE LEGGE, invece di cambiare la scritta in
                    "Leggo…": il movimento si nota con la coda dell'occhio,
                    una parola va letta. E la lettura dura una ventina di
                    secondi, abbastanza da far pensare che non sia partito
                    niente. */}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className={`h-3.5 w-3.5 ${dettaglioInCorso ? "animate-spin" : ""}`}
                >
                  <path d="M17 10a7 7 0 1 1-2.1-5" strokeLinecap="round" />
                  <path d="M14.9 1.6v3.6h-3.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="justify-self-end text-xs text-slate-300">dall&apos;archivio</span>
            )}
          </div>

          {/* NIENTE DA MOSTRARE FINCHE' E' CHIUSO: non e' solo questione
              di spazio: a elenco chiuso il dettaglio non viene nemmeno
              chiesto, e quelle chiamate a HubSpot non si spendono. */}
          {aperto ? (
            <>
            {/* LE DUE FONTI A CONFRONTO, E IL RITARDO DISTINTO DAL GUASTO.
                Il totale lo sa l'app e arriva fresco ogni minuto; il dettaglio
                lo ricostruiamo da HubSpot e si riusa per cinque minuti, perche'
                rifarlo costa una trentina di chiamate. Quindi appena qualcuno
                riceve lead i due numeri DEVONO discordare, per qualche minuto,
                e non c'e' niente che non va.

                Fino al 10 ottobre 2026 qui si leggeva sempre "il dettaglio e'
                incompleto": misurato quel giorno, l'app ne dichiarava 80 e il
                dettaglio 60 - una richiesta intera - e cinque minuti dopo i
                due numeri coincidevano da soli. Un messaggio che grida al
                guasto per una cosa che si sistema aspettando insegna a non
                leggerlo, e il giorno che il guasto c'e' davvero nessuno lo
                guarda piu'.

                Il guasto vero esiste e resta segnalato: quando la
                ricostruzione e' fresca e i conti comunque non tornano. Il caso
                tipico e' un contatto riassegnato a mano dopo, perche' HubSpot
                tiene solo l'ultima assegnazione. */}
            {dettaglio && !dettaglio.error && dettaglio.atteso != null &&
            dettaglio.atteso !== dettaglio.totale ? (
              (() => {
                const minuti = Math.floor(
                  (Date.now() - new Date(dettaglio.aggiornatoAt).getTime()) / 60_000
                );
                const inRitardo = minuti < FRESCHEZZA_DETTAGLIO_MINUTI;
                return (
                  <div
                    className={`mx-4 mt-2 rounded border px-2.5 py-1.5 text-xs ${
                      inRitardo
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                  >
                    L&apos;app ne dichiara {formatInt(dettaglio.atteso)}, qui se ne contano{" "}
                    {formatInt(dettaglio.totale)}:{" "}
                    {inRitardo ? (
                      <>
                        l&apos;elenco è di {minuti === 0 ? "meno di un minuto" : `${minuti} minuti`}{" "}
                        fa e si rifà da sé entro cinque, oppure aggiornalo adesso.
                      </>
                    ) : (
                      <>il dettaglio qui sotto è incompleto.</>
                    )}
                  </div>
                );
              })()
            ) : null}

            {/* LE DUE META' DELLA GIORNATA, AFFIANCATE. Chi ha ricevuto e chi
                ha chiesto senza ricevere erano due elenchi impilati, ciascuno
                largo tutta la sezione per dire un nome e due numeri: a schermo
                intero ogni riga era vuota per oltre meta' della sua larghezza,
                e per confrontare le due meta' bisognava scorrere. Affiancate,
                la larghezza serve a qualcosa e il confronto si fa guardando. */}
            <div className="grid gap-x-8 lg:grid-cols-2">
            <div className="px-4 pb-3 pt-2">
              {dettaglio?.error ? (
                <div className="py-2 text-sm text-slate-400">
                  Il dettaglio non è disponibile: {dettaglio.error}
                </div>
              ) : !dettaglio ? (
                <div className="py-2 text-sm text-slate-300">
                  {dettaglioInCorso ? "Leggo da HubSpot…" : "—"}
                </div>
              ) : dettaglio.righe.length === 0 ? (
                // ZERO E "MAI CALCOLATO" NON SONO LA STESSA COSA, e qui si vede:
                // una giornata senza assegnazioni ha comunque un istante di
                // calcolo, un giorno mai fotografato no.
                <div className="py-2 text-sm text-slate-400">
                  {dettaglio.aggiornatoAt
                    ? "Oggi non è ancora stato assegnato nessun lead."
                    : "Questa giornata non è ancora stata fotografata."}
                </div>
              ) : (
                // L'ELENCO NON CRESCE ALL'INFINITO. Le persone servite in un
                // giorno sono una decina, ma in una giornata piena diventano
                // trenta e la sezione spingerebbe fuori schermo tutto quello che
                // viene dopo. Oltre l'altezza, scorre dentro di se'.
                // VENTI RIGHE INTERE, POI SCORRE. L'altezza e' misurata e non
                // stimata: la prima riga e' alta 32px, le successive 33 per il
                // bordo che le separa, quindi 32 + 19 x 33 = 659. Con meno di
                // venti persone la barra non compare affatto - oggi erano
                // tredici - e la sezione resta della sua altezza naturale.
                //
                // LO SPAZIO A DESTRA E' PER LA BARRA. Senza, appoggia sui numeri
                // e sembra tagliarli.
                <>
                  <div className="mb-1 flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Serviti
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {dettaglio.righe.length}
                    </span>
                  </div>
                  <ul className="max-h-[420px] overflow-y-auto pr-3">
                  {dettaglio.righe.map((r) => (
                    <li
                      key={r.proprietarioId}
                      className="flex items-center justify-between gap-3 rounded px-2 py-1.5 odd:bg-slate-50/70"
                    >
                      <span className="truncate text-sm text-slate-900">{r.nome}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        {/* SOLO L'ULTIMA RICHIESTA, non l'intervallo.
                            Prima qui si leggeva "dalle 10:21 alle 13:31": due
                            orari per riga, su venti righe, erano quaranta
                            numeri da scorrere per rispondere all'unica domanda
                            che si fa guardando questo elenco - a che punto e'
                            questa persona adesso. Il primo orario non serviva
                            a deciderlo.

                            SCRITTO A PAROLE e non secco, perche' "13:31" da
                            solo accanto a un numero di lead si legge come un
                            secondo numero. */}
                        <span className="text-xs tabular-nums text-slate-400">
                          {`alle ${ora(r.ultima ?? r.prima)}`}
                        </span>
                        <span className="w-12 text-right text-sm font-semibold tabular-nums text-slate-900">
                          {formatInt(r.lead)}
                        </span>
                      </span>
                    </li>
                  ))}
                  </ul>
                </>
              )}
            </div>

            {/* CHI HA CHIESTO E NON HA RICEVUTO.
                Sta qui accanto e non in una pagina sua: le due meta' sono la
                stessa giornata. Il 6 ottobre 2026, su sedici richieste, nove
                non sono state servite - e per saperne il motivo e' servito
                aprire il database dell'app a mano.
                Un rifiuto non tocca nessun contatto, quindi su HubSpot non
                esiste: questi arrivano dall'app, che li dichiara. */}
            {dettaglio && !dettaglio.error && dettaglio.richieste !== undefined ? (
              <div className="px-4 pb-3 pt-2">
                {dettaglio.richieste === null ? (
                  <div className="text-sm text-slate-400">
                    Le richieste non si sono potute leggere.
                  </div>
                ) : dettaglio.richieste.length === 0 ? (
                  <div className="text-[11px] uppercase tracking-wide text-slate-300">
                    Nessuna richiesta registrata per questa giornata
                  </div>
                ) : (
                  <>
                    {/* STESSA INTESTAZIONE DELLA COLONNA ACCANTO, cosi' le
                        due meta' si leggono come due meta' e non come due
                        riquadri diversi. Il totale delle richieste sta nel
                        suggerimento: in testa serve il numero di questa
                        colonna, non quello di tutte e due. */}
                    <div
                      className="mb-1 flex cursor-help items-baseline gap-2 border-b border-slate-200 pb-1.5"
                      title={`${dettaglio.richieste.length} richieste in tutto, ${dettaglio.richieste.filter((r) => r.esito === "assegnato").length} servite`}
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Non serviti
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-400">
                        {dettaglio.richieste.filter((r) => r.esito !== "assegnato").length}
                      </span>
                    </div>
                    {/* SOLO I "NO" IN ELENCO. Le richieste servite sono gia'
                        raccontate dalla colonna qui sopra, con i numeri; qui
                        servirebbero solo a far scorrere di piu'. */}
                    <ul className="max-h-[420px] overflow-y-auto pr-3">
                      {dettaglio.richieste
                        .filter((r) => r.esito !== "assegnato")
                        .map((r) => (
                          <li
                            key={r.id}
                            className="flex items-center gap-3 rounded px-2 py-1.5 odd:bg-slate-50/70"
                          >
                            <span className="w-10 shrink-0 text-xs tabular-nums text-slate-400">
                              {ora(r.chiestoAt)}
                            </span>
                            <span className="w-40 shrink-0 truncate text-sm text-slate-900">
                              {r.nome ?? "—"}
                            </span>
                            <span className="truncate text-xs text-slate-500" title={r.motivo ?? ""}>
                              {r.motivo ?? "senza motivo registrato"}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
            </div>
            </>
          ) : null}
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
