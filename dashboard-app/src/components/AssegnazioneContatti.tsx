"use client";

import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import CampagnePersonaRiga, { CampagnePersonaPannello } from "@/components/CampagnePersona";
import FinestraRichieste from "@/components/FinestraRichieste";
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

/**
 * Dalla prima richiesta della giornata all'ultima.
 *
 * L'app le manda dalla piu' recente, che e' l'ordine giusto per un canale
 * Slack - li' si guarda cos'e' appena successo. Qui si guarda una giornata
 * intera, e una giornata si legge da come e' cominciata: chi ha chiesto per
 * primo, quando si e' esaurito il serbatoio, a che ora sono arrivati i
 * rifiuti. Al contrario bisogna leggerla dal fondo.
 */
function perOra<T extends { chiestoAt: string }>(righe: T[]): T[] {
  return [...righe].sort((a, b) => (a.chiestoAt < b.chiestoAt ? -1 : a.chiestoAt > b.chiestoAt ? 1 : 0));
}

/**
 * Il nome ridotto a come si confronta.
 *
 * LE DUE FONTI SCRIVONO I NOMI DIVERSI. L'app dice "Mariarosaria Di Prisco",
 * HubSpot "Mariarosaria di Prisco": una maiuscola, e un confronto esatto
 * fallisce. Senza questa riduzione il totale confermato restava sempre un
 * trattino proprio per le persone che avevano un "di" o un "de" nel cognome -
 * cioe' il controllo incrociato si spegneva in silenzio, che e' il modo
 * peggiore in cui puo' spegnersi.
 */
function chiaveNome(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, " ");
}

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

/**
 * Il motivo del rifiuto, ridotto all'osso.
 *
 * I motivi li scrive l'app e sono frasi intere - "Non e' stato possibile
 * assegnarti altri Leads, ne hai ancora 12 da chiamare con stato NUOVO!" -
 * pensate per un messaggio su Slack, dove c'e' una riga tutta per loro. In una
 * colonna accanto a un nome e un orario non ci stanno, e tagliate a meta' non
 * dicono piu' niente.
 *
 * SI TIENE IL NUMERO, che e' l'unica parte che cambia da un rifiuto all'altro:
 * dodici lead arretrati e due sono la stessa frase ma non la stessa giornata.
 *
 * QUELLO CHE NON RICONOSCE PASSA INTERO. Un motivo nuovo - perche' l'app ne
 * aggiunge uno, o perche' cambia una parola - si vede com'e' invece di
 * sparire: meglio una riga lunga di una vuota. La frase intera resta comunque
 * nel suggerimento, sempre.
 */
function motivoBreve(testo: string): string {
  const m = testo.trim();

  const arretrato = m.match(/ne hai ancora (\d+) da chiamare/i);
  if (arretrato) return `arretrato: ${arretrato[1]}`;

  // GLI APPUNTAMENTI RESTANO, e non per completezza: con tre il bonus scatta
  // e la richiesta viene servita lo stesso. "limite 6 - 2 appunt." dice che a
  // quella persona ne mancava uno; senza quel numero il rifiuto sembra
  // definitivo quando non lo era.
  const limite = m.match(/limite giornaliero \((\d+)\) raggiunto(?: con (\d+) appuntament)?/i);
  if (limite) {
    if (!limite[2]) return `${limite[1]} Richieste`;
    const quanti = Number(limite[2]);
    return `${limite[1]} Richieste - ${quanti} ${quanti === 1 ? "Appuntamento" : "Appuntamenti"}`;
  }

  if (/nessun lead disponibile/i.test(m)) return "pool vuoto";
  if (/non riesco a verificare/i.test(m)) return "arretrato non leggibile";
  if (/assegnazione lead disattivata/i.test(m)) return "assegnazione spenta";
  if (/non è attivo|non e' attivo/i.test(m)) return "non attivo";
  if (/utente non trovato/i.test(m)) return "utente sconosciuto";

  return m;
}

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
  feriali: "LUN - VEN ore 7:00 - 20:00",
  weekend: "SAB - DOM ore 7:00 - 20:00",
  entrambi: "LUN - DOM ore 7:00 - 20:00"
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

  /**
   * Se la scheda delle campagne per persona e' aperta.
   *
   * STA QUI E NON DENTRO QUEL COMPONENTE perche' i suoi due pezzi finiscono in
   * due posti diversi: la riga fra i comandi, dentro il riquadro bianco, e il
   * pannello fuori, sul grigio della pagina. Due pezzi in due punti dell'albero
   * non possono condividere uno stato che vive in uno solo di loro.
   */
  const [campagneAperte, setCampagneAperte] = useState(false);

  /** Di chi e' aperta la finestra con tutte le sue richieste. */
  const [personaAperta, setPersonaAperta] = useState<string | null>(null);

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
  const tuttiIGiorni = feriali && weekend;
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
            nome="Sistema"
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
            nome="Operatività"
            aiuto="Nei giorni scelti il Sistema si accende da solo alle 07:00 e si spegne alle 20:00. Senza nessun giorno non si muove da solo: resta dove lo metti tu."
            stato={stato ? GIORNI_ETICHETTA[stato.giorni] ?? stato.giorni : null}
          >
            {/* QUANDO "TUTTI I GIORNI" E' ACCESO GLI ALTRI DUE RESTANO
                ACCESI MA FERMI.
                Spegnerli sarebbe stato piu' pulito da guardare e falso da
                leggere: il sistema in quei giorni lavora eccome, ed e' proprio
                cio' che "tutti i giorni" significa. Due interruttori spenti
                accanto a una finestra che dice "LUN - DOM" costringono chi
                guarda a capire quale dei due mente.
                Accesi e bloccati dicono invece la cosa giusta: questi due sono
                gia' compresi, e non li decidi separatamente finche' vale la
                scelta di sopra. Per tornare a sceglierli uno per uno si spegne
                "Tutti i Giorni". */}
            <Interruttore
              acceso={feriali}
              etichetta="Feriali"
              disabilitato={bloccato || tuttiIGiorni}
              onChange={(v) => comanda({ feriali: v, weekend })}
            />
            <Interruttore
              acceso={weekend}
              etichetta="Week End"
              disabilitato={bloccato || tuttiIGiorni}
              onChange={(v) => comanda({ feriali, weekend: v })}
            />
            <Interruttore
              acceso={tuttiIGiorni}
              etichetta="Tutti i Giorni"
              disabilitato={bloccato}
              onChange={(v) => comanda({ feriali: v, weekend: v })}
            />
          </Riga>

          <div>
            <Riga
              nome="Campagne"
              aiuto="I contatti di queste campagne non vengono assegnati, finche' il filtro resta attivo. Si scelgono fra le campagne Live: una campagna e le sue varianti si aggiungono insieme e restano salvate con i nomi interi."
              stato="Escluse dall'assegnazione"
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
          <CampagnePersonaRiga
            aperto={campagneAperte}
            onToggle={() => setCampagneAperte((v) => !v)}
          />

          {/* L'ELENCO DI CHI HA RICEVUTO, COME GLI ALTRI COMANDI.
              Prima era una scritta piccola centrata sotto il riquadro, in
              maiuscoletto: sembrava un piede di pagina invece di una delle
              cose che si vengono a fare qui. Adesso e' una riga come le altre,
              e si apre dallo stesso gesto.

              CHIUSO DI PARTENZA, e non per ordine: ricostruire il dettaglio
              costa una trentina di chiamate a HubSpot su un token condiviso
              con decine di flussi Zapier. Chi apre la sezione quasi sempre
              viene per gli interruttori. */}
          <button
            type="button"
            onClick={() => setAperto((v) => !v)}
            aria-expanded={aperto}
            className="flex w-full items-center gap-x-4 px-4 py-3 text-left transition hover:bg-slate-50"
          >
            <span
              className="w-44 shrink-0 cursor-help text-sm font-medium text-slate-800"
              title="Chi ha ricevuto lead oggi e chi li ha chiesti senza riceverli. L'elenco si ricostruisce da HubSpot, quindi si apre solo quando serve."
            >
              Assegnazioni
            </span>
            <span className="min-w-0 flex-1 text-xs text-slate-500">
              Dettaglio richieste
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
        </div>
      </div>

      {/* IL PANNELLO FUORI DAL RIQUADRO, sul grigio della pagina: cosi' i suoi
          riquadri si allineano a quelli in cima alla sezione invece di essere
          rientrati di sedici pixel, e sono carte bianche su grigio come
          quelle. Dentro il riquadro bianco sarebbero state carte bianche su
          bianco. */}
      {campagneAperte ? <CampagnePersonaPannello bloccato={bloccato} /> : null}

      {/* IL DETTAGLIO COMPARE SOLO DA APERTO: a elenco chiuso sarebbe stata
          una carta vuota sotto i comandi. */}
      {!aperto ? null : (
        <div>
          {/* IL GIORNO E L'AGGIORNAMENTO STANNO SULLO SFONDO, fuori dal
              riquadro. Non sono dati della giornata: sono i comandi che
              scelgono quale giornata guardare e quando rileggerla. Dentro la
              carta sembravano la sua prima riga; qui sopra si leggono per
              quello che sono, e la carta comincia dove comincia il contenuto.

              LE FRECCE INVECE DI UN CALENDARIO: quasi sempre si vuole ieri, e
              con un calendario ieri costa tre clic invece di uno. */}
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-1 pb-2">
            {/* LE FRECCE INVECE DI UN CALENDARIO: quasi sempre si vuole ieri,
                e con un calendario ieri costa tre clic invece di uno.
                Compaiono con l'elenco: a lista chiusa il giorno non si vede,
                quindi cambiarlo non mostrerebbe niente. */}
            <span />

            {/* IL GIORNO AL CENTRO, fra le due frecce: e' la prima cosa che
                si cerca aprendo l'elenco, e in un angolo la si cercava. */}
            <div className={`flex items-center gap-1 justify-self-center ${aperto ? "" : "invisible"}`}>
              <button
                type="button"
                aria-label="Giorno precedente"
                onClick={() => vaiA(indietro + 1)}
                disabled={dettaglioInCorso || indietro >= GIORNI_INDIETRO}
                className="rounded px-2 py-0.5 text-xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent"
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
                className="rounded px-2 py-0.5 text-xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                ›
              </button>
            </div>

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

          {/* IL RIQUADRO COMINCIA QUI, con il contenuto. */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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
            <div className="px-4 pb-3 pt-3">
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
                  {/* RICHIESTE ACCOLTE, NON PERSONE SERVITE. I due numeri
                      contavano cose diverse: qui le persone, nella colonna
                      accanto le richieste. Una persona puo' chiedere due volte
                      e ricevere due volte - oggi Mariarosaria ha 40 lead, cioe'
                      due richieste da 20 - e contarla una sola volta faceva
                      sembrare la giornata piu' corta di com'era.

                      SE LE RICHIESTE NON SI LEGGONO si ricade sulle persone,
                      che e' il numero che si ha: meglio un conteggio piu'
                      basso di un trattino. */}
                  <div
                    className="mb-1 flex items-baseline gap-2 border-b border-slate-200 pb-1.5"
                    title={
                      dettaglio.richieste
                        ? `${dettaglio.righe.length} persone`
                        : "le richieste non si sono lette: questo e' il numero di persone"
                    }
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Accolte
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {dettaglio.richieste
                        ? dettaglio.richieste.filter((r) => r.esito === "assegnato").length
                        : dettaglio.righe.length}
                    </span>
                  </div>
                  <ul className="max-h-[420px] overflow-y-auto pr-3">
                  {/* UNA RIGA PER RICHIESTA, non per persona.
                      Chi chiede due volte compare due volte: e' la stessa
                      unita' che conta il numero in testa, e raggruppando si
                      perdeva proprio il fatto che qualcuno era tornato.

                      ORARIO DAVANTI AL NOME come nella colonna accanto: le
                      due meta' si leggono di fianco, e due impaginazioni
                      diverse costringevano a riorientarsi ogni volta.

                      DAL REGISTRO DELL'APP e non dalla ricostruzione HubSpot:
                      solo il registro sa quante richieste sono state e quanti
                      lead ha portato ciascuna. La ricostruzione resta - serve
                      alla banda di confronto qui sopra e al totale confermato
                      nella finestra - ma raggruppa per persona e non puo'
                      dire questo. Se non si legge, si ricade su di lei. */}
                  {(dettaglio.richieste
                    ? perOra(dettaglio.richieste.filter((r) => r.esito === "assegnato"))
                    : perOra(dettaglio.righe.map((r) => ({
                        id: r.proprietarioId,
                        chiestoAt: r.ultima ?? r.prima ?? "",
                        nome: r.nome,
                        lead: r.lead
                      })))
                  ).map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 rounded px-2 py-1.5 odd:bg-slate-50/70"
                    >
                      <span className="w-10 shrink-0 text-xs tabular-nums text-slate-400">
                        {r.chiestoAt ? ora(r.chiestoAt) : "--:--"}
                      </span>
                      {/* IL NOME APRE IL TOTALE. Da quando le righe sono
                          richieste, nessuna riga dice piu' quanto ha preso una
                          persona in tutto: quel numero sta un clic piu' in la',
                          insieme al confronto con quello che HubSpot conferma. */}
                      <button
                        type="button"
                        onClick={() => setPersonaAperta(r.nome ?? "")}
                        disabled={!r.nome}
                        /* LO STESSO GESTO DELLA TABELLA ADVISOR: al
                           passaggio del mouse si scurisce lo sfondo e il
                           testo resta com'e'. Colorare il nome lo faceva
                           sembrare un collegamento a un'altra pagina, mentre
                           apre una finestra qui. */
                        className="-my-1.5 min-w-0 flex-1 cursor-pointer truncate rounded px-1.5 py-1.5 text-left text-sm text-slate-900 transition-colors hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-400 disabled:cursor-default disabled:hover:bg-transparent"
                        title={r.nome ? `Tutte le richieste di ${r.nome}` : undefined}
                      >
                        {r.nome ?? "—"}
                      </button>
                      <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {formatInt(r.lead)}
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
                        Rifiutate
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-400">
                        {dettaglio.richieste.filter((r) => r.esito !== "assegnato").length}
                      </span>
                    </div>
                    {/* SOLO I "NO" IN ELENCO. Le richieste servite sono gia'
                        raccontate dalla colonna qui sopra, con i numeri; qui
                        servirebbero solo a far scorrere di piu'. */}
                    <ul className="max-h-[420px] overflow-y-auto pr-3">
                      {perOra(dettaglio.richieste.filter((r) => r.esito !== "assegnato")).map(
                        (r) => (
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
                            {/* IL MOTIVO IN ROSSO, che e' il segnale che
                                prima dava il triangolo: un colore non occupa
                                spazio in una colonna stretta, e si vede con la
                                coda dell'occhio scorrendo l'elenco.
                                Sulla colonna accanto - le accolte - non c'e'
                                niente di rosso, quindi il contrasto fra le due
                                meta' si legge senza leggere. */}
                            <span
                              className="truncate text-xs text-rose-600"
                              title={r.motivo ?? "senza motivo registrato"}
                            >
                              {r.motivo ? motivoBreve(r.motivo) : "senza motivo"}
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
          </div>
        </div>
      )}

      {/* IL TOTALE DI UNA PERSONA, che da quando le righe sono richieste non
          lo dice piu' nessuna riga. Dentro c'e' anche il confronto fra quello
          che l'app dichiara e quello che HubSpot conferma: il controllo
          incrociato non sparisce, si sposta a portata di clic. */}
      {personaAperta && dettaglio?.richieste ? (
        <FinestraRichieste
          nome={personaAperta}
          ruolo={
            dettaglio.richieste.find((r) => r.nome && chiaveNome(r.nome) === chiaveNome(personaAperta))
              ?.ruolo ?? null
          }
          giorno={etichettaGiorno(indietro).toLowerCase()}
          richieste={dettaglio.richieste
            .filter(
              (r) =>
                r.nome && chiaveNome(r.nome) === chiaveNome(personaAperta) && r.esito === "assegnato"
            )
            .map((r) => ({
              id: r.id,
              chiestoAt: r.chiestoAt,
              lead: r.lead,
              serie: r.serie,
              richiestaN: r.richiestaN,
              pendenti: r.pendenti,
              appuntamenti: r.appuntamenti
            }))}
          confermati={
            dettaglio.righe.find((x) => chiaveNome(x.nome) === chiaveNome(personaAperta))?.lead ??
            null
          }
          onChiudi={() => setPersonaAperta(null)}
        />
      ) : null}

      {/* L'ERRORE FUORI DAL RIQUADRO DEL DETTAGLIO: riguarda i comandi, non
          l'elenco, e dentro quel riquadro sarebbe sparito ogni volta che
          l'elenco si chiude - cioe' quasi sempre. */}
      {errore ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
          {errore}
        </div>
      ) : null}
    </section>
  );
}
