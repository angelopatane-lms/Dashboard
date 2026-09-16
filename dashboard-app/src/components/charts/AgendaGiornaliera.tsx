"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import type { AnalisiCall, EventoAgenda, TipoEvento } from "@/app/api/advisor-agenda/route";
import { chiaveNome } from "@/lib/nomi";

// Un'ora alta 44 pixel: dalle 8 alle 20 fa 528, che sta in mezza schermata e
// lascia leggere un appuntamento da mezz'ora senza schiacciarlo.
const ALTEZZA_ORA = 44;
const LARGHEZZA_ORE = 64;

/**
 * Le colonne sono tutte della stessa larghezza, ricavata dal nome piu' lungo
 * invece che scelta a occhio.
 *
 * Il nome sta su UNA RIGA SOLA e non deve essere tagliato: "Roberta
 * Scicchita..." non e' un nome, e in un'agenda la prima cosa che si cerca e' di
 * chi e' la colonna. Le intestazioni sono a 14px in semigrassetto, come i nomi
 * delle altre tabelle, dove un carattere occupa circa 7,5 pixel; i 20 di
 * margine coprono il padding.
 *
 * Oggi il piu' lungo e' "Valentina Mandarino", 19 caratteri: 163 pixel. Se un
 * giorno entra qualcuno con un nome piu' lungo, la misura lo segue da sola.
 * Il minimo tiene le colonne leggibili anche in una giornata di soli nomi
 * corti; il massimo impedisce che un nome fuori scala renda la tabella
 * impraticabile - li' il nome intero resta nell'etichetta col mouse sopra.
 */
function larghezzaColonna(nomi: string[]): number {
  const piuLungo = nomi.reduce((acc, n) => Math.max(acc, n.length), 0);
  return Math.min(Math.max(Math.round(piuLungo * 7.5) + 20, 130), 260);
}

/**
 * IL COLORE DICE IL TIPO, NON LA PERSONA.
 *
 * Su Google il colore lo sceglie ognuno per il proprio calendario, quindi non
 * significa niente: qui invece dice a che punto e' l'appuntamento, e lo
 * decidono i dati - e' l'esito che HubSpot tiene sul meeting.
 */
/**
 * Tinte piene a meta' strada, senza bordo, con il testo scuro dello stesso
 * colore.
 *
 * IL TESTO E' SCURO PERCHE' IL TONO E' MEDIO, e le due cose non si possono
 * separare. Il bianco su questi fondi sta fra l'1,8 e il 2,4 a 1 di contrasto:
 * a dieci pixel il nome del contatto sparirebbe. Il bianco regge solo sui toni
 * scuri, dal settimo gradino in giu', che erano quelli di prima; il testo scuro
 * regge su tutto il resto. Qui il contrasto sta fra 7 e 10 a 1.
 *
 * Il secondario e' lo stesso colore un gradino piu' chiaro, non un grigio: con
 * quattro fondi diversi un grigio fisso funzionerebbe su una tinta e
 * sfarfallerebbe sulle altre.
 */
const COLORI: Record<TipoEvento, { fondo: string; testo: string; secondario: string }> = {
  appuntamento: { fondo: "#7dd3fc", testo: "#0c4a6e", secondario: "#075985" },
  svolta: { fondo: "#6ee7b7", testo: "#064e3b", secondario: "#065f46" },
  // Il grigio del no show e' il colore con cui lo si e' sempre letto in questa
  // agenda.
  no_show: { fondo: "#cbd5e1", testo: "#475569", secondario: "#64748b" }
};

/**
 * QUELLO CHE STA FUORI DAL PIANO, E QUELLO CHE SI E' SPOSTATO.
 *
 * Nessuna delle due casistiche ha un colore proprio: tengono le tre tinte dello
 * stato - verde se la consulenza si e' tenuta, grigia se il cliente non si e'
 * presentato - perche' e' quello che dicono davvero, e un quarto colore
 * cancellerebbe proprio quell'informazione.
 *
 *   ↷ 17/09   ripianificata: la card esiste anche piu' avanti
 *   ↶ 12/09   assente su CRM, card tratteggiata: qui non c'era niente in
 *             programma, l'appuntamento sta ancora il 12
 *
 * LE DUE FRECCE SONO L'UNA LO SPECULARE DELL'ALTRA perche' le due cose sono
 * opposte: li' la card va avanti, qui l'appuntamento sta indietro. Stessa
 * famiglia di simboli, stessa dimensione, verso contrario.
 *
 * A distinguerle non e' solo il verso della freccia, che a undici pixel si
 * coglie leggendo e non a colpo d'occhio: la ripianificata e' ordinaria
 * amministrazione e le basta quella, l'altra e' un buco nel CRM - una
 * consulenza tenuta in una fascia che il CRM non prevedeva - e il tratteggio
 * la fa vedere su tutta l'agenda senza dover leggere niente.
 */

/**
 * La media aziendale del voto complessivo dell'advisor, misurata su 600 analisi.
 *
 * Sta accanto al voto perche' un numero da solo non si interpreta: senza un
 * riferimento, chi legge un 6 pensa alla sufficienza scolastica e lo giudica
 * appena passabile. La media vera e' 5,8, quindi un 6 e' nella norma e un 7
 * e' un buon risultato - il contrario di quello che suggerisce l'istinto.
 */
const VOTO_MEDIO_ADVISOR = 5.8;

/**
 * Come e' andato l'advisor in quella call.
 *
 * I punteggi sono tutti sulla scala 0-10, scelti apposta: fra le proprieta'
 * dell'analisi ne convivono due, e alcune misurano la stessa cosa su scale
 * diverse. Mescolarle farebbe leggere un 2,5 su 5 come peggiore di un 5 su 10,
 * che e' lo stesso identico valore.
 */
function PrestazioneAdvisor({ dati }: { dati: NonNullable<AnalisiCall["advisor"]> }) {
  const sopra = dati.voto >= VOTO_MEDIO_ADVISOR;
  return (
    <section className="mb-5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Come e&apos; andato l&apos;advisor
      </h4>

      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {dati.voto.toLocaleString("it-IT")}
        </span>
        <span className="text-sm text-slate-500">/ 10</span>
        {/* Il confronto con la media sta qui e non in legenda: e' l'unica cosa
            che rende leggibile il voto, e a distanza non verrebbe collegata. */}
        <span className="ml-1 text-[11px] font-medium" style={{ color: sopra ? "#0d6b60" : "#a8491a" }}>
          {sopra ? "sopra" : "sotto"} la media ({VOTO_MEDIO_ADVISOR.toLocaleString("it-IT")})
        </span>
      </div>

      {dati.fasi.length ? (
        <div className="mb-3 flex flex-col gap-1.5">
          {dati.fasi.map((f) => (
            <div key={f.nome} className="flex items-center gap-2">
              <span className="w-[130px] flex-shrink-0 text-[11px] text-slate-600">{f.nome}</span>
              <div className="h-1.5 flex-1 rounded-sm bg-slate-100">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${Math.max(0, Math.min(100, f.punteggio * 10))}%`,
                    background: f.punteggio >= VOTO_MEDIO_ADVISOR ? COLORI.svolta.fondo : "#e2b7a2"
                  }}
                />
              </div>
              <span className="w-7 flex-shrink-0 text-right text-[11px] tabular-nums text-slate-700">
                {f.punteggio.toLocaleString("it-IT")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {dati.puntiDiForza ? (
        <p className="mb-2 text-sm leading-relaxed text-slate-700">
          <span className="font-medium text-slate-900">Punti di forza. </span>
          {dati.puntiDiForza}
        </p>
      ) : null}
      {dati.daMigliorare ? (
        <p className="text-sm leading-relaxed text-slate-700">
          <span className="font-medium text-slate-900">Da migliorare. </span>
          {dati.daMigliorare}
        </p>
      ) : null}
    </section>
  );
}

/** Il segno dell'overbooking: un appuntamento passato da un altro advisor. */
const COLORE_RICEVUTO = "#475569";

/**
 * Il segno dell'appuntamento creato a mano, sul lato opposto per non
 * confondersi con l'altro quando capitano insieme.
 *
 * NON E' PIU' IN LEGENDA, di proposito: ora che gli Advisor stanno passando
 * tutti a una stanza fissa la casistica si assottiglia, e non serve piu'
 * distinguerla per decidere qualcosa. Il segno resta sulla card perche' finche'
 * qualche riunione nasce ancora a mano e' comodo riconoscerla, e si spiega da
 * se' nel riepilogo che si apre cliccandola.
 */
const COLORE_MANUALE = "#b91c1c";

const LEGENDA: Array<{ tipo: TipoEvento; label: string }> = [
  { tipo: "appuntamento", label: "Fissato" },
  { tipo: "svolta", label: "Svolto" },
  { tipo: "no_show", label: "No Show" }
];

/** Ora di Roma adesso, in minuti dalla mezzanotte. */
function minutiOra(): number {
  const aRoma = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Rome" });
  const [h, m] = (aRoma.split(" ")[1] ?? "0:0").split(":").map(Number);
  return h * 60 + m;
}

function giornoRoma(scarto = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + scarto);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
}

type EventoInCorsia = EventoAgenda & { corsia: number };

/**
 * Due appuntamenti sovrapposti stanno affiancati dentro la colonna.
 *
 * Senza, il secondo coprirebbe il primo e la giornata sembrerebbe piu' vuota di
 * quello che e'. Le corsie si contano su tutta la colonna e non sul singolo
 * gruppo di sovrapposizioni: e' meno raffinato, ma la larghezza degli
 * appuntamenti resta la stessa per tutta la giornata invece di cambiare a ogni
 * incrocio, che a colpo d'occhio confonde piu' di quanto aiuti.
 */
function inCorsie(eventi: EventoAgenda[]): { eventi: EventoInCorsia[]; corsie: number } {
  const ordinati = [...eventi].sort((a, b) => a.inizioMin - b.inizioMin || a.fineMin - b.fineMin);
  const fineDiCorsia: number[] = [];
  const out: EventoInCorsia[] = [];

  for (const e of ordinati) {
    let i = fineDiCorsia.findIndex((fine) => fine <= e.inizioMin);
    if (i === -1) {
      fineDiCorsia.push(e.fineMin);
      i = fineDiCorsia.length - 1;
    } else {
      fineDiCorsia[i] = e.fineMin;
    }
    out.push({ ...e, corsia: i });
  }

  return { eventi: out, corsie: Math.max(1, fineDiCorsia.length) };
}

/**
 * QUATTORDICI PIXEL, non di piu'.
 *
 * Il pulsante che le contiene ha testo da dodici, che occupa una riga da
 * sedici: un'icona fino a quel limite si vede bene e non fa crescere il
 * pulsante di un pixel. Oltre, il pulsante si allarga e la fila si scompone.
 */
const LATO_ICONA = 14;

/** Il foglio scritto: "qui c'e' la trascrizione". Prima era la freccia del
 *  collegamento esterno, che diceva dove porta il click invece di dire cosa
 *  si trova. */
function IconaTrascrizione({ colore }: { colore: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={LATO_ICONA}
      height={LATO_ICONA}
      fill="none"
      stroke={colore}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* il foglio con l'angolo piegato */}
      <path d="M9.2 1.8H4.4a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V5.4z" />
      <path d="M9.2 1.8v3.6h3.6" />
      {/* le righe di testo, l'ultima piu' corta come in una pagina vera */}
      <path d="M5.6 8.2h4.8M5.6 10.6h4.8M5.6 13h2.8" />
    </svg>
  );
}

/** L'altoparlante con le onde: "questa call si puo' ascoltare". */
function IconaAudio({ colore }: { colore: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={LATO_ICONA}
      height={LATO_ICONA}
      fill="none"
      stroke={colore}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6.2h2.4L7.6 3.4v9.2L4.4 9.8H2z" />
      {/* due onde invece di una: si legge come suono anche in piccolo */}
      <path d="M10.2 6.1a2.7 2.7 0 0 1 0 3.8" />
      <path d="M12.2 4.3a5.2 5.2 0 0 1 0 7.4" />
    </svg>
  );
}

/** "crescita_fatturato" non e' una parola: qui torna a esserlo. */
const leggibile = (v: string): string => {
  const s = v.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

/**
 * LA SCHEDA DELL'APPUNTAMENTO.
 *
 * Mostra l'ULTIMO blocco e non tutti, perche' il campo ne contiene in media tre
 * - misurati: uno solo nel 25% dei casi, fino a quattordici - scritti in una
 * volta sola dall'integrazione. Messi in fila si contraddicono ("la call si
 * interrompe prima della presentazione" sopra, "il closer ha presentato in modo
 * esaustivo" sotto), e chi legge non ha modo di sapere quale vale.
 *
 * Che l'ultimo sia il piu' recente e' un'IPOTESI, non un fatto: lo storico di
 * HubSpot ha una sola versione per record, quindi l'ordine dipende da come li
 * accoda l'integrazione e va confermato con chi l'ha scritta. Finche' non lo
 * sappiamo gli altri blocchi non si buttano, si aprono con un tasto: se
 * l'ipotesi e' sbagliata il contenuto giusto resta comunque raggiungibile.
 */
function SchedaAnalisi({ evento, onChiudi }: { evento: EventoAgenda; onChiudi: () => void }) {
  // L'analisi puo' mancare: una card si apre anche quando c'e' solo la
  // trascrizione o l'audio, e in quel caso la finestra mostra i due pulsanti.
  const a: AnalisiCall | undefined = evento.analisi;
  const [tutte, setTutte] = useState(false);

  useEffect(() => {
    const tasto = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onChiudi();
    };
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  }, [onChiudi]);

  const etichette = [
    { titolo: "Obiezione", valore: a?.obiezione },
    { titolo: "Urgenza", valore: a?.urgenza },
    { titolo: "Problema", valore: a?.problema },
    { titolo: "Obiettivo", valore: a?.obiettivo }
  ].filter((x): x is { titolo: string; valore: string } => Boolean(x.valore));

  const riassunti = a ? (tutte ? a.riassunti : a.riassunti.slice(-1)) : [];
  const mismatch = a ? (tutte ? a.mismatch : a.mismatch.slice(-1)) : [];
  const altri = a ? Math.max(a.riassunti.length, a.mismatch.length) - 1 : 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={onChiudi} aria-hidden="true" />
      {/* UNA FINESTRA AL CENTRO, non una fascia a destra: il contenuto e' un
          testo da leggere, e al centro dello schermo la riga resta corta e
          l'occhio non deve attraversare tutta la pagina. L'altezza si ferma
          all'85% dello schermo e il corpo scorre da solo. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Dettaglio della consulenza"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900">{evento.titolo}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {evento.operatore}
              {" · "}
              {evento.inizio}
              {evento.fine ? " – " + evento.fine : ""}
              {/* La durata della CALL accanto all'orario dello slot: messe
                  vicine si legge da sole quando una consulenza e' durata
                  molto meno o molto piu' di quanto era prenotata. */}
              {evento.durataMin ? ` · call di ${evento.durataMin} min` : ""}
            </div>
            {evento.presenza && evento.presenza !== "non-si-sa" ? (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    background:
                      evento.presenza === "presentato"
                        ? COLORI.svolta.fondo
                        : COLORI.no_show.fondo
                  }}
                />
                {evento.presenza === "presentato"
                  ? "Dalla registrazione: il cliente era in call"
                  : "Dalla registrazione: ha parlato solo l'advisor"}
              </div>
            ) : null}
            {evento.prenotatoPer ? (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[2px]"
                  style={{ background: COLORE_RICEVUTO }}
                />
                Era prenotato per {evento.prenotatoPer}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onChiudi}
            aria-label="Chiudi"
            className="flex-shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-neutral-800 hover:text-black"
          >
            Chiudi
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* I due pulsanti usano le stesse tinte della legenda: il blu degli
              appuntamenti per la trascrizione, il verde degli svolti per
              l'audio. Colorati perche' sono l'azione principale della
              finestra, e stanno in alto perche' spesso e' l'unica cosa che si
              cerca aprendola. */}
          {evento.trascrizione || evento.audio ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {evento.trascrizione ? (
                <a
                  href={evento.trascrizione}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition hover:brightness-95"
                  style={{ background: COLORI.appuntamento.fondo, color: COLORI.appuntamento.testo }}
                >
                  <IconaTrascrizione colore={COLORI.appuntamento.testo} />
                  Apri la trascrizione
                </a>
              ) : null}
              {evento.audio ? (
                <a
                  href={evento.audio}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition hover:brightness-95"
                  style={{ background: COLORI.svolta.fondo, color: COLORI.svolta.testo }}
                >
                  <IconaAudio colore={COLORI.svolta.testo} />
                  Ascolta la call
                </a>
              ) : null}
            </div>
          ) : null}

          {etichette.length ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {etichette.map((x) => (
                <span
                  key={x.titolo}
                  className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700"
                >
                  <span className="text-slate-500">{x.titolo}: </span>
                  {leggibile(x.valore)}
                </span>
              ))}
            </div>
          ) : null}

          {a?.advisor ? <PrestazioneAdvisor dati={a.advisor} /> : null}

          {riassunti.length ? (
            <section className="mb-5">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Riassunto</h4>
              {riassunti.map((b, i) => (
                <p key={i} className="mb-2 text-sm leading-relaxed text-slate-700">
                  {b}
                </p>
              ))}
            </section>
          ) : null}

          {mismatch.length ? (
            <section className="mb-5">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Scarto con le aspettative
              </h4>
              {mismatch.map((b, i) => (
                <p key={i} className="mb-2 text-sm leading-relaxed text-slate-700">
                  {b}
                </p>
              ))}
            </section>
          ) : null}

          {altri > 0 ? (
            <button
              type="button"
              onClick={() => setTutte((v) => !v)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-neutral-800 hover:text-black"
            >
              {tutte ? "Mostra solo l'ultima analisi" : "Mostra anche le altre " + altri + " analisi"}
            </button>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export default function AgendaGiornaliera({
  giorno,
  onGiorno,
  eventi,
  operatori,
  caricamento,
  errore
}: {
  giorno: string;
  onGiorno: (giorno: string) => void;
  eventi: EventoAgenda[];
  /** Le persone della tabella, nel suo stesso ordine. */
  operatori: string[];
  caricamento: boolean;
  errore: boolean;
}) {
  // L'ora corrente si aggiorna da sola: una linea ferma a quando si e' aperta
  // la pagina sarebbe peggio che non averla.
  const [scheda, setScheda] = useState<EventoAgenda | null>(null);
  // Il selettore parte VUOTO, come gli altri filtri della dashboard partono
  // sulla loro voce predefinita: finche' si naviga con Ieri, Oggi e Domani non
  // e' lui a comandare, e mostrarlo pieno farebbe sembrare che ci sia un filtro
  // attivo quando non c'e'. Si riempie e diventa nero solo quando lo si usa.
  const [dataScelta, setDataScelta] = useState("");
  /** Il campo data nascosto sotto il pulsante: serve per aprirne il calendario. */
  const rifData = useRef<HTMLInputElement>(null);
  const [adesso, setAdesso] = useState<number | null>(null);
  useEffect(() => {
    setAdesso(minutiOra());
    const t = setInterval(() => setAdesso(minutiOra()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const colonne = useMemo(() => {
    // GLI EVENTI SI RAGGRUPPANO PER CHIAVE DEL NOME, non per il nome scritto.
    //
    // La stessa persona arriva scritta in due modi: il foglio degli utenti dice
    // "Sabina Noia", l'anagrafica HubSpot "sabina noia". Confrontando i nomi
    // com'erano, compariva due volte - una colonna vuota e una con i suoi
    // appuntamenti - e sembrava che fossero due advisor diversi.
    const perChiave = new Map<string, EventoAgenda[]>();
    const scrittoCome = new Map<string, string>();
    for (const e of eventi) {
      const k = chiaveNome(e.operatore);
      const lista = perChiave.get(k) ?? [];
      lista.push(e);
      perChiave.set(k, lista);
      if (!scrittoCome.has(k)) scrittoCome.set(k, e.operatore);
    }

    // Le colonne partono dalle persone della tabella - il loro nome e' quello
    // scritto meglio - e si aggiunge chi ha appuntamenti oggi senza comparirci.
    const nomi = [...operatori];
    const viste = new Set(nomi.map(chiaveNome));
    for (const k of Array.from(perChiave.keys()).sort()) {
      if (viste.has(k)) continue;
      viste.add(k);
      nomi.push(scrittoCome.get(k) ?? k);
    }

    return nomi
      .map((nome) => {
        const suoi = perChiave.get(chiaveNome(nome)) ?? [];
        return {
          nome,
          ...inCorsie(suoi),
          // Si contano gli appuntamenti con un cliente: le riunioni interne e
          // gli annullati non sono lavoro fatto ne' da fare.
          quanti: suoi.filter((e) => e.tipo === "appuntamento" || e.tipo === "svolta").length,
          quantoHa: suoi.length
        };
      })
      // IN AGENDA CI VA CHI HA QUALCOSA IN AGENDA.
      //
      // Una colonna vuota dice "questa persona oggi e' libera", che e' una
      // risposta - ma su venti advisor sono quasi sempre piu' della meta', e
      // spingono fuori schermo chi invece lavora. Chi e' libero lo si vede
      // dalla tabella qui sopra; qui si guarda la giornata di chi ce l'ha.
      //
      // "Qualcosa" comprende le riunioni interne: se qualcuno ha solo quelle,
      // nasconderlo toglierebbe dalla vista l'unica cosa che ha.
      .filter((c) => c.quantoHa > 0);
  }, [eventi, operatori]);

  // La griglia si adatta a quello che c'e': parte dalle 8 e finisce alle 20, ma
  // si allarga se qualcuno ha un appuntamento prima o dopo, invece di tagliarlo.
  const { primaOra, ultimaOra } = useMemo(() => {
    let prima = 8;
    let ultima = 20;
    for (const e of eventi) {
      prima = Math.min(prima, Math.floor(e.inizioMin / 60));
      ultima = Math.max(ultima, Math.ceil(e.fineMin / 60));
    }
    return { primaOra: prima, ultimaOra: Math.min(ultima, 24) };
  }, [eventi]);

  const larghezzaCol = useMemo(() => larghezzaColonna(colonne.map((c) => c.nome)), [colonne]);

  const ore = ultimaOra - primaOra;
  const altezza = ore * ALTEZZA_ORA;
  const y = (minuti: number) => ((minuti - primaOra * 60) / 60) * ALTEZZA_ORA;

  const oggi = giornoRoma();
  const lineaOra = adesso !== null && giorno === oggi ? y(adesso) : null;

  return (
    <div>
      {/* Legenda e comandi sulla stessa riga: il titolo della sezione dice gia'
          cos'e', e una riga in meno e' una riga di agenda in piu'.
          
          TRE COLONNE, quella di mezzo grande quanto serve e le due laterali
          uguali fra loro: e' il modo di avere la legenda al centro del riquadro
          e non al centro dello spazio rimasto dopo i tasti. La terza colonna e'
          vuota apposta, ed e' lei che tiene il centro dov'e'. Sotto i mille
          pixel le due parti si impilano, che e' meglio di una legenda
          schiacciata in mezzo schermo. */}
      <div className="grid grid-cols-1 items-center gap-x-6 gap-y-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-shrink-0 items-center gap-3">
          <div className="flex items-center gap-2">
            {[
              { label: "Ieri", valore: giornoRoma(-1) },
              { label: "Oggi", valore: oggi },
              { label: "Domani", valore: giornoRoma(1) }
            ].map((v) => (
              <button
                key={v.label}
                type="button"
                onClick={() => {
                  setDataScelta("");
                  onGiorno(v.valore);
                }}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium shadow-sm transition ${
                  giorno === v.valore
                    ? "border-neutral-700 bg-black text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-neutral-800 hover:text-black"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Il selettore serve a guardare indietro oltre ieri: le trascrizioni
              e gli audio compaiono solo sulle giornate in cui qualcuno ha
              registrato, e non sono necessariamente le ultime due. Il tasto
              Oggi resta il modo rapido di tornare al presente. */}
          {/* UN PULSANTE, NON UN CAMPO DI SISTEMA. Accanto a Ieri, Oggi e
              Domani un campo data nudo scriveva "gg/mm/aaaa", che e' il
              segnaposto del browser e non dice a cosa serve. Il pulsante porta
              l'etichetta vera e prende l'aspetto degli altri tre; il campo
              resta sotto, invisibile ma raggiungibile da tastiera, e apre il
              calendario di sistema. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                const campo = rifData.current;
                if (!campo) return;
                // showPicker apre il calendario dovunque si prema, invece di
                // pretendere il click sull'iconcina. Dove non c'e', il ripiego
                // e' dare il fuoco al campo, che resta utilizzabile.
                const conPicker = campo as HTMLInputElement & { showPicker?: () => void };
                try {
                  if (conPicker.showPicker) conPicker.showPicker();
                  else campo.focus();
                } catch {
                  campo.focus();
                }
              }}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition ${
                dataScelta
                  ? "border-neutral-700 bg-black text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-neutral-800 hover:text-black"
              }`}
            >
              {dataScelta
                ? `${dataScelta.slice(8, 10)}/${dataScelta.slice(5, 7)}/${dataScelta.slice(0, 4)}`
                : "Data Specifica"}
            </button>
            <input
              ref={rifData}
              type="date"
              value={dataScelta}
              max={giornoRoma(1)}
              onChange={(e) => {
                setDataScelta(e.target.value);
                if (e.target.value) onGiorno(e.target.value);
              }}
              aria-label="Scegli il giorno"
              // TRASPARENTE AI CLIC. Sovrapposto al pulsante se li intercettava
              // lui, e Chrome dal corpo di un campo data il calendario non lo
              // apre - solo dall'iconcina - quindi il clic finiva nel vuoto e
              // sembrava che il pulsante non rispondesse. Cosi' il gesto arriva
              // al pulsante, che chiama showPicker(). Il campo resta nel flusso
              // dei tasti, dove si apre da solo.
              className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4">
          {LEGENDA.map((v) => (
            <div key={v.tipo} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: COLORI[v.tipo].fondo }} />
              <span className="text-xs font-medium text-slate-700">{v.label}</span>
            </div>
          ))}
          {/* Quadratini come per gli stati, perche' ora e' un colore pieno e non
              piu' un segno: la freccia resta sulla card, dove porta anche la
              data dell'altro giorno. */}
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 text-center text-xs font-semibold leading-3 text-slate-700">↷</span>
            <span className="text-xs font-medium text-slate-700">Ripianificato</span>
          </div>

          {/* LO SPECULARE ESATTO di quella di Ripianificato - stessa famiglia,
              stessa dimensione, verso opposto - perche' le due cose sono
              opposte: li' la card va avanti, qui l'appuntamento sta indietro.
              Una freccia di un altro disegno si sarebbe letta come un'altra
              cosa, e sarebbe stata piu' piccola. */}
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-[3px]"
              style={{ border: "1px dashed #64748b" }}
            />
            <span className="text-xs font-medium text-slate-700">Assente su CRM</span>
          </div>

          {/* Non e' un colore ma un segno: le tre tinte dicono lo stato
              dell'appuntamento, e una call ricevuta da un altro advisor resta
              comunque fissata o svolta. Dare a questa casistica un quinto
              colore cancellerebbe quell'informazione. */}
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-[3px] bg-slate-200"
              style={{ borderRight: `6px solid ${COLORE_RICEVUTO}` }}
            />
            <span className="text-xs font-medium text-slate-700">Overbooking</span>
          </div>

          {/* "CREATI MANUALMENTE" NON STA PIU' IN LEGENDA. Man mano che gli
              Advisor passano tutti a una stanza fissa la casistica si assottiglia,
              e distinguerla non serve piu' a decidere niente. Il bordo rosso sulla
              card resta - vedi COLORE_MANUALE piu' sotto - perche' finche' qualche
              riunione nasce ancora a mano e' comodo riconoscerla aprendola, ma in
              legenda occupava una voce per un caso che tende a zero. */}

          {lineaOra !== null ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-[18px]" style={{ background: "#e11d48" }} />
              <span className="text-xs font-medium text-slate-700">Ora Corrente</span>
            </div>
          ) : null}
        </div>

        <div aria-hidden="true" className="hidden lg:block" />
      </div>

      {errore ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Agenda non disponibile.</strong> HubSpot non ha risposto: la giornata qui sotto e&apos; vuota
          perche&apos; non l&apos;abbiamo potuta leggere, non perche&apos; non ci siano appuntamenti.
        </div>
      ) : null}

      {/* SOLO SCORRIMENTO ORIZZONTALE, dichiarato su tutti e due gli assi.
          Chiedendo soltanto overflow-x, il CSS mette l'altro asse ad "auto" per
          conto suo, e li' nasce la barra verticale: il riquadro e' alto quanto
          il suo contenuto, la barra orizzontale gli ruba quindici pixel
          d'altezza dall'interno, e quei quindici pixel diventano overflow
          verticale. Non era un problema di altezza, ed e' per questo che
          allargare il riquadro non l'avrebbe tolta.
          Lo spazio sopra e sotto resta perche' le etichette delle ore sono
          centrate sulla riga e sporgono di sette pixel da entrambe le parti:
          senza, ora che l'asse verticale e' nascosto, verrebbero tagliate. */}
      <div className="mt-4 overflow-x-auto overflow-y-hidden rounded-md py-2">
        <div style={{ minWidth: LARGHEZZA_ORE + colonne.length * larghezzaCol }}>
          {/* intestazione: i nomi restano in alto mentre si scorre, come nelle tabelle */}
          <div className="sticky top-0 z-20 flex bg-white shadow-[inset_0_-2px_0_0_#e2e8f0]">
            {/* Senza la linea verticale: si ferma sotto i nomi, come nelle
                altre tabelle, dove separa le colonne dei dati e non
                l'intestazione. */}
            <div className="sticky left-0 z-30 flex-shrink-0 bg-white" style={{ width: LARGHEZZA_ORE }} />
            {colonne.map((c) => (
              <div key={c.nome} className="flex-shrink-0 px-2 pb-2.5 pt-2" style={{ width: larghezzaCol }}>
                <div className="truncate text-sm font-semibold text-slate-900" title={c.nome}>
                  {c.nome}
                </div>
              </div>
            ))}
          </div>

          {/* Lo stacco dalla riga dei nomi non e' estetico: l'etichetta delle
              8:00 e' centrata sulla sua riga, quindi sporge di otto pixel verso
              l'alto, e senza questo spazio finiva sotto l'intestazione - che ha
              il fondo bianco e le sta sopra - e si leggeva a meta'. */}
          <div className="relative mt-2 flex">
            {/* colonna delle ore, ferma a sinistra */}
            {/* NIENTE position NELLO STILE INLINE. C'era "relative", per fare
                da riferimento alle etichette delle ore, e sovrascriveva la
                classe sticky: la colonna scorreva insieme al resto invece di
                restare ferma a sinistra. Sticky fa gia' da riferimento agli
                elementi in posizione assoluta, quindi relative non serviva. */}
            <div
              className="sticky left-0 z-10 flex-shrink-0 bg-white shadow-[inset_-1px_0_0_0_#cbd5e1]"
              style={{ width: LARGHEZZA_ORE, height: altezza }}
            >
              {Array.from({ length: ore + 1 }, (_, i) => primaOra + i).map((h, i) => (
                <div
                  key={h}
                  className="absolute right-2.5 text-xs font-medium tabular-nums text-slate-500"
                  style={{ top: i * ALTEZZA_ORA - 8 }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            <div
              className="relative flex"
              style={{
                height: altezza,
                backgroundImage: `repeating-linear-gradient(to bottom, #f1f5f9 0, #f1f5f9 1px, transparent 1px, transparent ${ALTEZZA_ORA}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${ALTEZZA_ORA / 2}px, #f8fafc ${ALTEZZA_ORA / 2}px, #f8fafc ${ALTEZZA_ORA / 2 + 1}px, transparent ${ALTEZZA_ORA / 2 + 1}px, transparent ${ALTEZZA_ORA}px)`
              }}
            >
              {colonne.map((c) => (
                <div
                  key={c.nome}
                  className="relative flex-shrink-0 shadow-[inset_-1px_0_0_0_#f1f5f9]"
                  style={{ width: larghezzaCol }}
                >
                  {c.eventi.map((e, i) => {
                    const colore = COLORI[e.tipo];
                    const largo = (larghezzaCol - 6) / c.corsie;
                    const alto = Math.max(y(e.fineMin) - y(e.inizioMin) - 2, 14);
                    // SI APRE SOLO QUELLO CHE HA DENTRO QUALCOSA. Una card che
                    // reagisce al click e poi mostra una scheda vuota insegna a
                    // non cliccare piu' nessuna card.
                    // Si apre se c'e' qualcosa da vedere: l'analisi, la
                    // trascrizione o l'audio.
                    const apribile = Boolean(e.analisi || e.trascrizione || e.audio);
                    return (
                      <div
                        key={`${e.titolo}-${e.inizioMin}-${i}`}
                        className={`absolute overflow-hidden rounded${apribile ? " cursor-pointer transition hover:brightness-95" : ""}`}
                        onClick={apribile ? () => setScheda(e) : undefined}
                        role={apribile ? "button" : undefined}
                        tabIndex={apribile ? 0 : undefined}
                        onKeyDown={
                          apribile
                            ? (ev) => {
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  setScheda(e);
                                }
                              }
                            : undefined
                        }
                        title={
                          `${e.inizio}${e.fine ? ` – ${e.fine}` : ""} · ${e.titolo}` +
                          `${e.prenotatoPer ? ` · prenotato per ${e.prenotatoPer}` : ""}` +
                          `${e.manuale ? " · creato a mano" : ""}` +
                          `${e.ripianificata ? ` · ripianificata al ${e.ripianificata}, la card c'e' anche li'` : ""}` +
                          `${e.appuntamentoDel ? ` · Sul CRM non c'era nessun appuntamento qui: quello del ${e.appuntamentoDel} non e' stato spostato` : ""}` +
                          `${apribile ? " · clicca per il dettaglio" : ""}`
                        }
                        style={{
                          top: y(e.inizioMin),
                          left: 3 + e.corsia * largo,
                          width: largo - 1,
                          height: alto,
                          background: colore.fondo,
                          // IL TRATTEGGIO DICE "QUESTA FASCIA NON E' NEL
                          // PIANO", e lo dice da lontano, senza bisogno della
                          // legenda: e' il modo in cui qualunque agenda
                          // distingue una cosa provvisoria da una prevista. Il
                          // colore resta quello dello stato, quindi verde e
                          // grigio continuano a significare svolta e no show.
                          // Sta PRIMA dei bordi laterali di overbooking e
                          // creazione manuale: quelli devono poterlo
                          // sovrascrivere sul loro lato, non il contrario.
                          ...(e.appuntamentoDel
                            ? { border: `1px dashed ${colore.secondario}` }
                            : {}),
                          padding: "2px 6px",
                          boxSizing: "border-box",
                          // La barra a destra dice che l'appuntamento era di un altro e
                          // l'ha preso questa persona. La card sta gia' nella
                          // colonna giusta, quindi il segno racconta da dove
                          // arriva, non dove dovrebbe stare.
                          // I due segni dicono da dove arriva la riunione,
                          // mentre il colore continua a dire lo stato. Stanno
                          // tutti e due a destra, ma quando capitano insieme
                          // sulla stessa card quello scuro si sposta a
                          // sinistra: altrimenti il secondo bordo
                          // sovrascriverebbe il primo e se ne vedrebbe uno solo.
                          ...(e.prenotatoPer
                            ? e.manuale
                              ? { borderLeft: `6px solid ${COLORE_RICEVUTO}` }
                              : { borderRight: `6px solid ${COLORE_RICEVUTO}` }
                            : {}),
                          ...(e.manuale ? { borderRight: `6px solid ${COLORE_MANUALE}` } : {})
                        }}
                      >
                        <div
                          className="truncate text-xs font-semibold leading-[14px]"
                          style={{
                            color: colore.testo,
                            textDecoration:
                              e.tipo === "no_show" ? "line-through" : undefined
                          }}
                        >
                          {e.titolo}
                        </div>
                        {alto >= 30 ? (
                          <div className="truncate text-[11px] leading-[14px]" style={{ color: colore.secondario }}>
                            {e.inizio}
                            {e.fine ? ` – ${e.fine}` : ""}
                            {/* LA FRECCIA E LA DATA, non un terzo bordo: i due
                                lati della card sono gia' presi da overbooking e
                                creazione manuale, e un terzo segno colorato si
                                sovrascriverebbe. Cosi' invece si legge anche
                                DOVE e' finita, che e' l'informazione utile. */}
                            {e.ripianificata ? ` · ↷ ${e.ripianificata}` : ""}
                            {e.appuntamentoDel ? ` · ↶ ${e.appuntamentoDel}` : ""}
                          </div>
                        ) : null}
                        {/* UN SOLO SEGNO: il punto nell'angolo dice che c'e'
                            qualcosa da vedere - l'analisi, la trascrizione,
                            l'audio - e si apre cliccando la card. Le azioni
                            stanno dentro la finestra, non sulla card: qui lo
                            spazio e' quello di un appuntamento da mezz'ora, e
                            il nome del contatto viene prima di tutto. */}
                        {apribile ? (
                          <span
                            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                            style={{ background: colore.secondario }}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}

              {lineaOra !== null ? (
                <>
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-[5]"
                    style={{ top: lineaOra, borderTop: "2px solid #e11d48" }}
                  />
                  <div
                    className="pointer-events-none absolute z-[6] h-2 w-2 rounded-full"
                    style={{ top: lineaOra - 4, left: -4, background: "#e11d48" }}
                  />
                </>
              ) : null}
            </div>
          </div>

          {/* IL CONTEGGIO IN FONDO, come la riga del totale delle tabelle.
              Sotto il nome rubava spazio all'intestazione e allontanava le
              colonne dalla prima ora; qui chiude la giornata, che e' il punto
              in cui uno tira le somme. La linea sopra e' quella marcata del
              totale, e la colonna delle ore resta bianca e senza riga: non e'
              un dato da sommare. */}
          <div className="mt-2 flex border-t-2 border-slate-200">
            <div className="sticky left-0 z-10 flex-shrink-0 bg-white" style={{ width: LARGHEZZA_ORE }} />
            {colonne.map((c) => (
              <div
                key={c.nome}
                className="flex-shrink-0 truncate px-2 py-2 text-xs font-medium text-slate-600"
                style={{ width: larghezzaCol }}
              >
                {c.quanti === 1 ? "1 appuntamento" : `${c.quanti} appuntamenti`}
              </div>
            ))}
          </div>
        </div>
      </div>

      {scheda ? <SchedaAnalisi evento={scheda} onChiudi={() => setScheda(null)} /> : null}

      {!caricamento && !errore && eventi.length === 0 ? (
        <div className="mt-3 text-sm text-slate-500">Nessun appuntamento in agenda per questo giorno.</div>
      ) : null}
    </div>
  );
}
