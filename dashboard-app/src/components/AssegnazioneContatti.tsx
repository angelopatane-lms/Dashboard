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
/**
 * I suffissi che fanno di un nome la variante di un'altra campagna.
 *
 * NON SONO UN'INVENZIONE DI QUESTA PAGINA: sono gli stessi che il resto della
 * Dashboard tratta come varianti quando unifica le campagne. Qui servono a
 * raggrupparle nel menu - una voce invece di tre - senza accorciare mai i nomi
 * salvati, che devono restare interi perche' l'assegnatore li confronta esatti.
 */
const SUFFISSI_VARIANTE = ["_test_instant", "_richiesta_informazioni"];

function baseCampagna(nome: string): string {
  let base = nome;
  let cambiato = true;
  while (cambiato) {
    cambiato = false;
    for (const s of SUFFISSI_VARIANTE) {
      if (base.toLowerCase().endsWith(s)) {
        base = base.slice(0, -s.length);
        cambiato = true;
      }
    }
  }
  return base;
}

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
/**
 * Un rifiuto regolare e un rifiuto che segnala un guasto non sono la stessa
 * cosa, e si leggono di colore diverso.
 *
 * AMBRA E' LA NORMALITA'. "Sei richieste raggiunte" e' il sistema che funziona
 * come deve; "pool vuoto" e' una condizione del serbatoio; "arretrato" e' la
 * regola che chiede di smaltire prima di ricevere ancora. Nessuno deve fare
 * niente: domani ricomincia.
 *
 * ROSSO E' QUALCOSA DA SISTEMARE, e nessun altro lo segnala. L'assegnazione
 * spenta per una persona e' una configurazione che qualcuno ha cambiato e
 * forse ha dimenticato; un utente sconosciuto e' l'anagrafica che non torna;
 * un arretrato illeggibile e' un controllo che non siamo riusciti a fare, e
 * quel rifiuto potrebbe essere immeritato.
 *
 * PERCHE' NON TUTTO ROSSO, che era la versione di prima: il rosso usato per la
 * normalita' si consuma, e il giorno che serve davvero nessuno lo guarda piu'.
 * E' la stessa ragione per cui la banda di confronto qui sopra e' ambra.
 */
function gravitaMotivo(testo: string): "guasto" | "regola" {
  const m = testo.trim();
  if (/assegnazione lead disattivata/i.test(m)) return "guasto";
  if (/utente non trovato/i.test(m)) return "guasto";
  if (/non riesco a verificare/i.test(m)) return "guasto";
  if (/non è attivo|non e' attivo/i.test(m)) return "guasto";
  return "regola";
}

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
type Quantita = { role: string; serie_a: number; serie_b: number; totale: number };

/**
 * Quanti lead per richiesta, e come si dividono fra i due serbatoi.
 *
 * DUE NUMERI E NON UNA PERCENTUALE. L'assegnatore ragiona in totale piu'
 * percentuale di serie A; chi guarda questa pagina ragiona in "quanti ne do di
 * qua e quanti di la'". La traduzione la fa il server, una volta sola: qui si
 * scrivono due quantita' e si legge quello che e' stato scritto davvero,
 * perche' la percentuale e' un arrotondamento e puo' spostare un lead.
 *
 * SETTER E ADVISOR SEPARATI, perche' sono due mestieri con due serbatoi
 * diversi: cambiare i Setter non deve toccare gli Advisor.
 *
 * E' UN TETTO, NON UNA PROMESSA: chi ha molti lead arretrati ma oggi ha gia'
 * fissato appuntamenti ne riceve la meta'. La regola esisteva prima di questa
 * manopola e non la contraddice - dice solo che il numero scritto qui e' il
 * massimo, non il minimo.
 */
function QuantitaPerRuolo({ bloccato }: { bloccato: boolean }) {
  const [righe, setRighe] = useState<Quantita[] | null>(null);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/assegnazione-lead/quantita")
      .then((r) => r.json())
      .then((d: { ruoli?: Quantita[]; error?: string }) => {
        if (d.error) setErrore(d.error);
        setRighe(d.ruoli ?? []);
      })
      .catch(() => setErrore("l'app di assegnazione non risponde"));
  }, []);

  const salva = async (role: string, serie_a: number, serie_b: number) => {
    // SI MOSTRA SUBITO QUELLO CHE HAI SCRITTO, poi si corregge con quello che
    // il server ha scritto davvero. Il giro completo - browser, Dashboard, app
    // sul server, database - dura abbastanza da far sembrare il campo lento, e
    // un numero che resta fermo mentre aspetti sembra un comando che non ha
    // funzionato. Se i due valori differiscono, la correzione si vede: e' il
    // motivo per cui non ci si ferma all'ottimismo.
    setRighe((p) =>
      (p ?? []).map((x) =>
        x.role === role ? { ...x, serie_a, serie_b, totale: serie_a + serie_b } : x
      )
    );
    setInCorso(role);
    setErrore(null);
    try {
      const r = await fetch("/api/assegnazione-lead/quantita", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, serie_a, serie_b })
      });
      const d = (await r.json()) as Quantita & { error?: string };
      if (d.error) {
        setErrore(d.error);
        // IL RIFIUTO RIMETTE I VALORI VERI: se il server non ha scritto, la
        // pagina non deve restare con il numero ottimista addosso.
        const r2 = await fetch("/api/assegnazione-lead/quantita").then((x) => x.json());
        if (r2?.ruoli) setRighe(r2.ruoli);
        return;
      }
      // SI RIMETTE QUELLO CHE IL SERVER HA SCRITTO, non quello che si e'
      // digitato: se l'arrotondamento ha spostato un lead si vede subito.
      setRighe((p) => (p ?? []).map((x) => (x.role === role ? { ...x, ...d } : x)));
    } catch {
      setErrore("salvataggio non riuscito");
    } finally {
      setInCorso(null);
    }
  };

  if (!righe) return <span className="text-xs text-slate-400">caricamento…</span>;

  // LE INTESTAZIONI UNA VOLTA SOLA, I RUOLI UNO SOTTO L'ALTRO.
  //
  // Prima "A" e "B" comparivano accanto a ogni campo - otto volte in due righe
  // - e i due ruoli stavano affiancati, cosi' per sapere se avevano la stessa
  // divisione bisognava leggerli e confrontarli a mente. Incolonnati si vede
  // da soli. E' lo stesso modo in cui la Dashboard scrive tutte le sue
  // tabelle: titoli piccoli in alto, numeri allineati a destra.
  return (
    <div className="flex flex-col items-end gap-1">
      <table className="text-xs">
        <thead>
          <tr className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            <th className="w-16" />
            <th className="px-1.5 pb-1 text-center font-semibold">Serie A</th>
            <th className="w-4" />
            <th className="px-1.5 pb-1 text-center font-semibold">Serie B</th>
            <th className="px-2 pb-1 text-right font-semibold">Totale</th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r.role}>
              <td className="py-0.5 pr-2 text-right font-medium whitespace-nowrap text-slate-600">
                {r.role}
              </td>
              <td className="px-1.5 py-0.5">
                <CampoQuantita
                  valore={r.serie_a}
                  disabilitato={bloccato || inCorso === r.role}
                  onConferma={(v) => salva(r.role, v, r.serie_b)}
                />
              </td>
              <td className="text-center text-slate-300">+</td>
              <td className="px-1.5 py-0.5">
                <CampoQuantita
                  valore={r.serie_b}
                  disabilitato={bloccato || inCorso === r.role}
                  onConferma={(v) => salva(r.role, r.serie_a, v)}
                />
              </td>
              <td className="py-0.5 pl-2 text-right whitespace-nowrap">
                <span className="font-semibold tabular-nums text-slate-700">{r.totale}</span>
                {/* LA PERCENTUALE E' LA STESSA COSA DETTA IN UN ALTRO MODO, ed
                    e' il modo in cui la chiede chi decide ("quanto diamo di
                    serie A?"). Scritta accanto al totale, le due letture non
                    si possono piu' contraddire. */}
                <span className="ml-2 text-[10px] tabular-nums text-slate-400">
                  {r.totale > 0 ? `${Math.round((r.serie_a / r.totale) * 100)}% A` : ""}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {errore ? <span className="text-xs text-rose-600">{errore}</span> : null}
    </div>
  );
}

/**
 * Un numero che si salva quando lo lasci, non a ogni tasto.
 *
 * SALVARE A OGNI CIFRA avrebbe scritto 5 mentre si digita 50, e per un istante
 * l'app avrebbe distribuito cinque lead a richiesta. Si conferma uscendo dal
 * campo o con Invio; con Esc si torna al valore di prima.
 */
function CampoQuantita({
  valore,
  disabilitato,
  onConferma
}: {
  valore: number;
  disabilitato: boolean;
  onConferma: (v: number) => void;
}) {
  const [testo, setTesto] = useState(String(valore));
  useEffect(() => setTesto(String(valore)), [valore]);

  const conferma = () => {
    const n = Number(testo);
    if (!Number.isFinite(n) || n < 0) {
      setTesto(String(valore));
      return;
    }
    if (n !== valore) onConferma(Math.round(n));
  };

  return (
    <label className="block">
      <input
        type="number"
        min={0}
        max={200}
        value={testo}
        disabled={disabilitato}
        onChange={(e) => setTesto(e.target.value)}
        onBlur={conferma}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setTesto(String(valore));
        }}
        /* NIENTE FRECCINE DEL BROWSER: su un campo largo tre caratteri
           occupano un terzo dello spazio, cambiano aspetto da un browser
           all'altro e invitano a cliccare uno alla volta per arrivare da 20 a
           50. Le frecce della tastiera continuano a funzionare, che e' il modo
           in cui si fanno le correzioni piccole. */
        className="w-16 appearance-none rounded-md border border-slate-300 bg-white px-2 py-1 text-center text-sm font-semibold tabular-nums text-slate-800 shadow-sm outline-none transition hover:border-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

type FamigliaCampagna = { base: string; nomi: string[]; assegnabili: number };

/**
 * Si scrive e compaiono le corrispondenze, invece di scorrere un menu.
 *
 * PERCHE' NON UN MENU. Le campagne del serbatoio sono una trentina e i nomi
 * si somigliano tutti - `lms_div_coach_ew_...` per otto voci di fila - quindi
 * trovarne una vuol dire leggerle quasi tutte. Scrivendo tre lettere ne
 * restano due o tre.
 *
 * SI CERCA DENTRO IL NOME, non solo all'inizio: nessuno ricorda il prefisso,
 * tutti ricordano "mamma" o "aste".
 */
function CercaCampagna({
  famiglie,
  escluse,
  disabilitato,
  onScegli
}: {
  famiglie: FamigliaCampagna[];
  escluse: string[];
  disabilitato: boolean;
  onScegli: (f: FamigliaCampagna) => void;
}) {
  const [testo, setTesto] = useState("");
  const [aperto, setAperto] = useState(false);

  const parole = testo.toLowerCase().split(/\s+/).filter(Boolean);
  const trovate = famiglie
    .filter((f) => f.nomi.some((n) => !escluse.includes(n)))
    .filter((f) => parole.every((p) => f.base.toLowerCase().includes(p)));
  // NIENTE TAGLIO: l'elenco parte completo e si restringe mentre si scrive.
  // Mostrarne solo le prime otto farebbe sparire campagne senza dirlo, e chi
  // non trova la sua penserebbe che non c'e'. Scorrono dentro il riquadro.

  const scegli = (f: FamigliaCampagna) => {
    onScegli(f);
    setTesto("");
    setAperto(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={testo}
        disabled={disabilitato}
        placeholder={famiglie.length ? `cerca fra ${famiglie.length} campagne` : "lettura del serbatoio…"}
        onChange={(e) => {
          setTesto(e.target.value);
          setAperto(true);
        }}
        onFocus={() => setAperto(true)}
        // SI CHIUDE DOPO IL CLIC, non prima: senza il ritardo il menu sparisce
        // mentre il dito e' ancora a mezz'aria e la scelta non arriva mai.
        onBlur={() => setTimeout(() => setAperto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && trovate.length) scegli(trovate[0]);
          if (e.key === "Escape") {
            setTesto("");
            setAperto(false);
          }
        }}
        className="w-64 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 outline-none transition hover:border-slate-400 focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {aperto && !disabilitato ? (
        <ul className="absolute right-0 z-20 mt-1 max-h-72 w-96 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {trovate.length ? (
            trovate.map((f) => (
              <li key={f.base}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => scegli(f)}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-slate-100"
                >
                  <span className="min-w-0 flex-1 truncate text-slate-700">{f.base}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">{f.assegnabili}</span>
                  {f.nomi.length > 1 ? (
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {f.nomi.length} varianti
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-xs text-slate-400">
              {testo ? "nessuna campagna del serbatoio contiene queste parole" : "nessuna campagna"}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

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

/**
 * La conferma prima di toccare l'interruttore del Sistema.
 *
 * PERCHE' UNA FINESTRA E NON confirm(). Prima qui c'era un confirm() del
 * browser, e solo in accensione: una riga di testo di sistema, che si chiude
 * con Invio senza leggerla. Questo interruttore comanda la distribuzione dei
 * contatti su un'altra applicazione - spento resta spento, e le richieste
 * arrivate nel frattempo non si recuperano: il 27 settembre 2026 e' rimasto
 * giu' per nove giorni senza che nessuno se ne accorgesse.
 *
 * IN TUTTE E DUE LE DIREZIONI, non solo in accensione. Spegnere e' il verso
 * che fa piu' danno, ed era quello senza conferma.
 *
 * IL FUOCO PARTE SU "Annulla", di proposito: chi preme Invio per riflesso
 * annulla invece di procedere. Vale anche Esc e il clic fuori, che sono i due
 * modi in cui si esce da una finestra senza volerla.
 */
function ConfermaAdmin({
  verso,
  onConferma,
  onAnnulla
}: {
  verso: boolean;
  onConferma: () => void;
  onAnnulla: () => void;
}) {
  const annulla = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    annulla.current?.focus();
    const tasto = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnnulla();
    };
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  }, [onAnnulla]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={onAnnulla} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conferma-admin-titolo"
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex gap-4 px-6 pt-6">
          {/* Triangolo rosso pieno con il punto esclamativo in bianco:
              ritagliato nel triangolo con evenodd, cosi' resta bianco su
              qualunque sfondo invece di dipendere da un secondo colore. */}
          <svg
            viewBox="0 0 24 24"
            className="h-10 w-10 shrink-0 text-red-600"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M10.9 2.6a1.3 1.3 0 0 1 2.2 0l9.7 17a1.3 1.3 0 0 1-1.1 1.9H2.3a1.3 1.3 0 0 1-1.1-1.9l9.7-17ZM12 7.6a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0v-5a1 1 0 0 0-1-1Zm0 8.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"
            />
          </svg>
          <div className="min-w-0">
            <h2 id="conferma-admin-titolo" className="text-base font-semibold text-slate-900">
              Attenzione!
            </h2>
            {/* IL VERSO E' NELLA FRASE, non solo nell'interruttore: chi apre
                questa finestra per sbaglio deve leggere cosa sta per fare,
                non dedurlo da dov'era il cursore. */}
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Stai per {verso ? "accendere" : "spegnere"} la Riassegnazione Automatica!
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Solo un Admin dispone delle autorizzazioni necessarie per questa operazione, se non
              lo sei premi annulla.
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 px-6 py-3">
          <button
            type="button"
            ref={annulla}
            onClick={onAnnulla}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={onConferma}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Procedi, sono Admin
          </button>
        </div>
      </div>
    </>
  );
}

export default function AssegnazioneContatti() {
  const [stato, setStato] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  /** Il verso che l'interruttore prenderebbe, in attesa di conferma. null =
   *  finestra chiusa. Si tiene il verso e non un semplice "aperta" perche' il
   *  testo cambia fra accensione e spegnimento. */
  const [confermaSistema, setConfermaSistema] = useState<boolean | null>(null);
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

  /**
   * Le campagne che il serbatoio contiene DAVVERO, con quanti contatti hanno.
   *
   * PRIMA ERANO LE LIVE: 119 su 5.206 in archivio. Dentro c'erano campagne da
   * cui non arriva piu' un lead, e fuori restavano le 485 evergreen - che
   * quindi non si potevano escludere, pur essendo fra quelle che producono.
   * Escludere una campagna vuota non serve a niente; non poter escludere
   * quella piena era il problema vero.
   *
   * Si legge il serbatoio, che e' lo stesso giro che alimenta le Categorie:
   * nessuna lettura in piu' a HubSpot.
   */
  const [campagne, setCampagne] = useState<Array<{ nome: string; assegnabili: number }>>([]);
  const [campagneCaricate, setCampagneCaricate] = useState(false);
  useEffect(() => {
    fetch("/api/campagne-serbatoio", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCampagne(d.campagne ?? []))
      .catch(() => setCampagne([]))
      .finally(() => setCampagneCaricate(true));
  }, []);

  /**
   * Le campagne del serbatoio raggruppate per base: `..._test_instant` e
   * `..._richiesta_informazioni` stanno sotto la campagna da cui nascono.
   *
   * UNA VOCE INVECE DI TRE, e il numero accanto e' la somma: chi sceglie
   * decide su quanti contatti sta togliendo davvero, non su un terzo di essi.
   * I nomi salvati restano interi, uno per variante.
   */
  const famiglieSerbatoio = (() => {
    const per = new Map<string, { nomi: string[]; assegnabili: number }>();
    for (const c of campagne) {
      const base = baseCampagna(c.nome);
      const g = per.get(base) ?? { nomi: [], assegnabili: 0 };
      g.nomi.push(c.nome);
      g.assegnabili += c.assegnabili;
      per.set(base, g);
    }
    // IN ORDINE ALFABETICO, non per quantita': i nomi si somigliano tutti e
    // l'alfabeto e' l'unico ordine che chi cerca conosce gia'. Quanti contatti
    // ha ciascuna si legge accanto al nome, dove serve a decidere - non a
    // trovare.
    return [...per.entries()]
      .map(([base, g]) => ({ base, ...g }))
      .sort((a, b) => a.base.localeCompare(b.base));
  })();

  /**
   * Le campagne in cui il blocco del webinar non vale.
   *
   * IL BLOCCO: chi ha un webinar non ancora finito - o finito da meno di sette
   * giorni - non viene assegnato, perche' in quella finestra lo lavora il
   * flusso del webinar. Qui si elencano le eccezioni, e l'elenco vuoto vuol
   * dire "blocco pieno", cioe' il comportamento di sempre.
   */
  const [webinarEccezioni, setWebinarEccezioni] = useState<string[]>([]);
  const [webinarAttivo, setWebinarAttivo] = useState(false);
  /**
   * IL SECONDO INTERRUTTORE DELLA STESSA RIGA: nelle campagne elencate qui
   * sopra si assegnano solo i contatti che hanno partecipato al webinar, cioe'
   * quelli con Si' in "Partecipazione Webinar Diventa Coach Intelligenza
   * Spirituale" (`coach_spir_presenza`).
   *
   * STESSO ELENCO, NON UN SECONDO MENU. Le campagne su cui ha senso guardare
   * la presenza sono esattamente quelle in cui il blocco del webinar fa
   * eccezione: due elenchi da tenere allineati a mano si scollano, e il giorno
   * in cui qualcuno aggiunge una campagna a uno solo dei due la regola agisce
   * dove non deve senza dirlo.
   */
  const [soloPartecipanti, setSoloPartecipanti] = useState(false);
  const [webinarErrore, setWebinarErrore] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/assegnazione-lead/webinar", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setWebinarEccezioni(d.campagne ?? []);
        setWebinarAttivo(Boolean(d.attivo));
        setSoloPartecipanti(Boolean(d.solo_partecipanti));
      })
      .catch(() => setWebinarEccezioni([]));
  }, []);
  const salvaWebinar = async (
    elenco: string[],
    attivo = webinarAttivo,
    solo = soloPartecipanti
  ) => {
    setWebinarEccezioni(elenco);
    setWebinarAttivo(attivo);
    setSoloPartecipanti(solo);
    try {
      const r = await fetch("/api/assegnazione-lead/webinar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campagne: elenco, attivo, solo_partecipanti: solo })
      });
      const d = await r.json().catch(() => null);
      // IL SALVATAGGIO FALLITO SI DICE, e si rimettono i valori veri.
      //
      // Tenersi il valore ottimista dopo un errore e' il guasto peggiore che
      // ci sia: la pagina mostra una configurazione che non esiste, e chi
      // l'ha scritta se ne accorge settimane dopo dai numeri. Successo il 15
      // ottobre 2026, con la rotta ancora non pubblicata sul server: quattro
      // campagne sembravano salvate e non erano mai arrivate.
      if (!r.ok || !d || d.error) {
        setWebinarErrore(d?.error || `non salvato (HTTP ${r.status})`);
        const vero = await fetch("/api/assegnazione-lead/webinar", { cache: "no-store" })
          .then((x) => x.json())
          .catch(() => null);
        setWebinarEccezioni(vero?.campagne ?? []);
        setWebinarAttivo(Boolean(vero?.attivo));
        setSoloPartecipanti(Boolean(vero?.solo_partecipanti));
        return;
      }
      setWebinarErrore(null);
      if (d.campagne) setWebinarEccezioni(d.campagne);
      if (typeof d.attivo === "boolean") setWebinarAttivo(d.attivo);
      // UN SERVER PIU' VECCHIO DELLA PAGINA SI VEDE DA QUI. La rotta dell'app
      // di assegnazione risponde 200 anche quando non conosce
      // `solo_partecipanti`: ignora il campo e torna gli altri due. Senza
      // questo controllo l'interruttore resterebbe acceso mostrando una regola
      // che sul server non esiste - esattamente il guasto del 15 ottobre 2026,
      // quando quattro campagne sembravano salvate e non erano mai arrivate.
      if (typeof d.solo_partecipanti === "boolean") {
        setSoloPartecipanti(d.solo_partecipanti);
      } else if (solo) {
        setSoloPartecipanti(false);
        setWebinarErrore("il server non conosce ancora Solo partecipanti");
        return;
      }
    } catch (e) {
      setWebinarErrore(e instanceof Error ? e.message : "salvataggio non riuscito");
    }
  };

  /**
   * LE CAMPAGNE CHE ENTRANO ANCHE SENZA `dispatch_outcome` E COL COUNTDOWN.
   *
   * La ricerca dell'assegnatore chiede quattro cose insieme: niente
   * proprietario, niente countdown, un telefono, e `dispatch_outcome` uguale a
   * serie_a o serie_b. Misurato il 15 ottobre 2026 su
   * lms_div_coach_intelligenza_spirituale_webinar: dei 2.062 contatti liberi,
   * 1.567 hanno `dispatch_outcome` VUOTO e 71 ce l'hanno a "proprietario".
   * Sono persone libere e raggiungibili che per l'assegnatore non esistono -
   * non escluse da qualcuno, semplicemente mai marcate.
   *
   * NON SI CORREGGE HUBSPOT, SI ALLARGA LA PESCA, e solo dove viene chiesto.
   */
  const [ingressoForzato, setIngressoForzato] = useState<string[]>([]);
  const [ingressoAttivo, setIngressoAttivo] = useState(false);
  const [ingressoErrore, setIngressoErrore] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/assegnazione-lead/ingresso", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setIngressoForzato(d.campagne ?? []);
        setIngressoAttivo(Boolean(d.attivo));
      })
      .catch(() => setIngressoForzato([]));
  }, []);
  const salvaIngresso = async (elenco: string[], attivo = ingressoAttivo) => {
    setIngressoForzato(elenco);
    setIngressoAttivo(attivo);
    try {
      const r = await fetch("/api/assegnazione-lead/ingresso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campagne: elenco, attivo })
      });
      const d = await r.json().catch(() => null);
      // IL SALVATAGGIO FALLITO SI DICE, come nelle altre righe: tenersi il
      // valore ottimista dopo un errore mostra una configurazione che non
      // esiste, e chi l'ha scritta se ne accorge settimane dopo dai numeri.
      if (!r.ok || !d || d.error) {
        setIngressoErrore(d?.error || `non salvato (HTTP ${r.status})`);
        const vero = await fetch("/api/assegnazione-lead/ingresso", { cache: "no-store" })
          .then((x) => x.json())
          .catch(() => null);
        setIngressoForzato(vero?.campagne ?? []);
        setIngressoAttivo(Boolean(vero?.attivo));
        return;
      }
      setIngressoErrore(null);
      if (d.campagne) setIngressoForzato(d.campagne);
      if (typeof d.attivo === "boolean") setIngressoAttivo(d.attivo);
    } catch (e) {
      setIngressoErrore(e instanceof Error ? e.message : "salvataggio non riuscito");
    }
  };

  const ingressoRaggruppate = (() => {
    const gruppi = new Map<string, string[]>();
    for (const nome of ingressoForzato) {
      const chiave = baseCampagna(nome);
      gruppi.set(chiave, [...(gruppi.get(chiave) ?? []), nome]);
    }
    return [...gruppi.entries()].map(([base, nomi]) => ({ base, nomi }));
  })();

  /**
   * Le eccezioni raggruppate come le campagne escluse: una targhetta per
   * famiglia, i nomi interi nel suggerimento del mouse.
   */
  const webinarRaggruppate = (() => {
    const gruppi = new Map<string, string[]>();
    for (const nome of webinarEccezioni) {
      const chiave = baseCampagna(nome);
      gruppi.set(chiave, [...(gruppi.get(chiave) ?? []), nome]);
    }
    return [...gruppi.entries()].map(([base, nomi]) => ({ base, nomi }));
  })();

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
    // La famiglia e' il nome piu' corto fra le scelte che fa da prefisso agli
    // altri: le varianti si raggruppano da sole, senza bisogno dell'elenco
    // delle campagne - che adesso contiene solo quelle del serbatoio e
    // potrebbe non avere la base di una variante gia' scelta.
    const gruppi = new Map<string, string[]>();
    for (const nome of scelte) {
      const chiave = baseCampagna(nome);
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
              // LA CONFERMA VALE IN TUTTE E DUE LE DIREZIONI, e anche in Dry
              // Run. Prima era solo in accensione e solo in LIVE: ma spegnere
              // e' il verso che fa piu' danno - resta spento, e le richieste
              // arrivate nel frattempo non si recuperano - ed era proprio
              // quello senza nessun avviso.
              onChange={(v) => setConfermaSistema(v)}
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

          <Riga
            nome="Quantità"
            aiuto="Quanti lead arrivano a ogni richiesta, e come si dividono fra serie A e serie B. Setter e Advisor si impostano separatamente. E' un tetto: chi ha molti lead arretrati ma oggi ha gia' fissato appuntamenti ne riceve la meta'."
            stato="Lead per richiesta"
          >
            <QuantitaPerRuolo bloccato={bloccato} />
          </Riga>

          <div>
            <Riga
              nome="Campagne"
              aiuto="I contatti di queste campagne non vengono assegnati, finche' il filtro resta attivo. Il menu offre solo le campagne che il serbatoio contiene davvero, con quanti contatti assegnabili hanno in questo momento: escludere una campagna vuota non cambierebbe niente. Il confronto e' sul nome intero."
              stato="Escluse dall'assegnazione"
            >
              <CercaCampagna
                famiglie={famiglieSerbatoio}
                escluse={scelte}
                disabilitato={bloccato}
                onScegli={(f) =>
                  salvaScelte([...scelte, ...f.nomi.filter((n) => !scelte.includes(n))])
                }
              />
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

          {/* IL BLOCCO DEL WEBINAR, con le sue eccezioni. Sta sotto le
              campagne escluse perche' e' la stessa domanda - chi non si
              assegna - posta da un'altra parte: li' per campagna, qui per
              quello che la persona sta gia' ricevendo. */}
          <div>
            <Riga
              nome="Webinar"
              aiuto="Chi ha un webinar non ancora finito, o finito da meno di sette giorni, non viene assegnato: in quella finestra lo lavora il flusso del webinar. Le campagne elencate qui fanno eccezione, cioe' i loro contatti si assegnano lo stesso - ma solo finche' l'interruttore On/Off in fondo alla riga resta acceso. Spento, il blocco vale ovunque. SOLO PARTECIPANTI, l'interruttore accanto: di queste stesse campagne si assegnano soltanto i contatti che hanno Si' in Partecipazione Webinar Diventa Coach Intelligenza Spirituale. Non tocca le altre campagne del serbatoio, e vale anche a webinar finito da tempo - quando il blocco qui sopra non c'entra piu'. Attenzione: quella proprieta' il No non lo scrive mai, quindi vuoto vuol dire sia non e' venuto sia non ancora registrato, e questi ultimi restano fuori."
              stato={
                soloPartecipanti
                  ? "Eccezioni al blocco \u00b7 solo chi ha partecipato"
                  : "Eccezioni al blocco"
              }
            >
              {/* LA REGOLA IN PIU', sullo stesso elenco: solo chi ha
                  partecipato. Ha l'etichetta scritta e non On/Off perche' nella
                  stessa riga ci sono due interruttori, e due On/Off affiancati
                  non si distinguono.

                  APRE LA RIGA, prima del menu: e' una condizione su COME si
                  assegnano le campagne elencate, quindi si legge prima di
                  elencarle. L'On/Off resta in fondo, dove sta in tutte le altre
                  righe - spostarlo romperebbe l'incolonnamento. */}
              <Interruttore
                acceso={soloPartecipanti}
                etichetta="Solo partecipanti"
                disabilitato={bloccato}
                onChange={(v) => salvaWebinar(webinarEccezioni, webinarAttivo, v)}
              />
              <CercaCampagna
                famiglie={famiglieSerbatoio}
                escluse={webinarEccezioni}
                disabilitato={bloccato}
                onScegli={(f) =>
                  salvaWebinar([
                    ...webinarEccezioni,
                    ...f.nomi.filter((n) => !webinarEccezioni.includes(n))
                  ])
                }
              />
              {webinarErrore ? (
                <span className="text-xs text-rose-600" title={webinarErrore}>
                  non salvato
                </span>
              ) : null}
              {/* IL FILTRO DELLA RIGA, come in Campagne: acceso, le
                  eccezioni valgono. */}
              <Interruttore
                acceso={webinarAttivo}
                etichetta={webinarAttivo ? "On" : "Off"}
                disabilitato={bloccato}
                onChange={(v) => salvaWebinar(webinarEccezioni, v)}
              />
            </Riga>

            {/* Le targhette come quelle delle campagne escluse: stesso posto,
                stesso modo di accorparsi, stessi nomi interi sotto il mouse.
                Spente quando l'interruttore e' spento, perche' in quel caso
                l'elenco c'e' ma non sta facendo niente. */}
            {webinarRaggruppate.length ? (
              <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3">
                {webinarRaggruppate.map((g) => (
                  <span
                    key={g.base}
                    title={g.nomi.join(", ")}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                      webinarAttivo
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
                      onClick={() =>
                        salvaWebinar(webinarEccezioni.filter((x) => !g.nomi.includes(x)))
                      }
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

          {/* L'INGRESSO FORZATO, sotto il blocco del webinar. Le righe qui
              sopra dicono CHI NON SI ASSEGNA; questa dice chi si assegna LO
              STESSO, nonostante due condizioni della ricerca. Sta per ultima
              perche' e' l'unica che allarga invece di stringere. */}
          <div>
            <Riga
              nome="Ingresso"
              aiuto="L'assegnatore pesca solo i contatti che hanno dispatch_outcome uguale a serie_a o serie_b e nessun countdown. Nelle campagne elencate qui queste due condizioni non si applicano: entrano anche i contatti che quella proprieta' non ce l'ha mai avuta, e quelli fermi su un countdown che nessuno sta consumando perche' proprietario non ne hanno. Misurato il 15 ottobre 2026 sulla campagna intelligenza spirituale: 1.567 contatti liberi con dispatch_outcome vuoto e 249 bloccati dal countdown. Tutto il resto resta in piedi - storico ICMD, No Show, numero errato, chi ha gia' comprato, i venti giorni di freschezza, le campagne sospese e il blocco del webinar. Non scrive niente su HubSpot: allarga soltanto la ricerca."
              stato="Entrano anche senza dispatch_outcome"
            >
              <CercaCampagna
                famiglie={famiglieSerbatoio}
                escluse={ingressoForzato}
                disabilitato={bloccato}
                onScegli={(f) =>
                  salvaIngresso([
                    ...ingressoForzato,
                    ...f.nomi.filter((n) => !ingressoForzato.includes(n))
                  ])
                }
              />
              {ingressoErrore ? (
                <span className="text-xs text-rose-600" title={ingressoErrore}>
                  non salvato
                </span>
              ) : null}
              <Interruttore
                acceso={ingressoAttivo}
                etichetta={ingressoAttivo ? "On" : "Off"}
                disabilitato={bloccato}
                onChange={(v) => salvaIngresso(ingressoForzato, v)}
              />
            </Riga>

            {ingressoRaggruppate.length ? (
              <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3">
                {ingressoRaggruppate.map((g) => (
                  <span
                    key={g.base}
                    title={g.nomi.join(", ")}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                      ingressoAttivo
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
                      onClick={() =>
                        salvaIngresso(ingressoForzato.filter((x) => !g.nomi.includes(x)))
                      }
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
              Cronologia delle richieste
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
              ) : dettaglio.righe.length === 0 &&
                !dettaglio.richieste?.some((r) => r.esito === "assegnato") ? (
                // ZERO E "MAI CALCOLATO" NON SONO LA STESSA COSA, e qui si vede:
                // una giornata senza assegnazioni ha comunque un istante di
                // calcolo, un giorno mai fotografato no.
                //
                // E L'ARCHIVIO DA SOLO NON PUO' DIRE CHE NON C'E' NIENTE.
                // Questa colonna elenca le richieste servite, che arrivano dal
                // registro dell'app e non dalla ricostruzione HubSpot. Fino al
                // 27 ottobre 2026 stava dentro il controllo sull'archivio: le
                // 27 richieste servite di lunedì erano arrivate al browser e
                // non venivano disegnate, perché l'archivio di lunedì non
                // esiste - si scrive solo aprendo questa riga in giornata, e
                // sàbato e lunedì nessuno l'ha aperta. Si guarda quindi anche
                // il registro, e il vuoto si annuncia solo quando sono vuoti
                // tutti e due.
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
                        ? // LE PERSONE SI CONTANO DALL'ARCHIVIO QUANDO C'E',
                          // ALTRIMENTI DAI NOMI DEL REGISTRO: senza archivio
                          // diceva "0 persone" accanto a un elenco di venti
                          // righe piene.
                          `${
                            dettaglio.righe.length ||
                            new Set(
                              dettaglio.richieste
                                .filter((r) => r.esito === "assegnato")
                                .map((r) => r.nome)
                            ).size
                          } persone`
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
                            {/* IL COLORE E' IL SEGNALE, e non occupa spazio
                                in una colonna stretta: ambra quando il sistema
                                ha solo applicato una regola, rosso quando c'e'
                                qualcosa da sistemare. Vedi gravitaMotivo. */}
                            <span
                              className={`truncate text-xs ${
                                r.motivo && gravitaMotivo(r.motivo) === "guasto"
                                  ? "font-medium text-rose-600"
                                  : "text-amber-700"
                              }`}
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

      {confermaSistema !== null ? (
        <ConfermaAdmin
          verso={confermaSistema}
          onAnnulla={() => setConfermaSistema(null)}
          onConferma={() => {
            comanda({ sistema: confermaSistema });
            setConfermaSistema(null);
          }}
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
