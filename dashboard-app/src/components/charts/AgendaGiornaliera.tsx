"use client";

import { useEffect, useMemo, useState } from "react";
import type { EventoAgenda, TipoEvento } from "@/app/api/advisor-agenda/route";
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
  interno: { fondo: "#fcd34d", testo: "#78350f", secondario: "#92400e" },
  annullato: { fondo: "#cbd5e1", testo: "#475569", secondario: "#64748b" }
};

const LEGENDA: Array<{ tipo: TipoEvento; label: string }> = [
  { tipo: "appuntamento", label: "Fissato" },
  { tipo: "svolta", label: "Svolto" },
  { tipo: "annullato", label: "Annullato o no show" },
  { tipo: "interno", label: "Riunione interna" }
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
          cos'e', e una riga in meno e' una riga di agenda in piu'. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
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
                onClick={() => onGiorno(v.valore)}
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
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {LEGENDA.map((v) => (
            <div key={v.tipo} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: COLORI[v.tipo].fondo }} />
              <span className="text-xs font-medium text-slate-700">{v.label}</span>
            </div>
          ))}
          {lineaOra !== null ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-[18px]" style={{ background: "#e11d48" }} />
              <span className="text-xs font-medium text-slate-700">ora corrente</span>
            </div>
          ) : null}
        </div>
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
                    return (
                      <div
                        key={`${e.titolo}-${e.inizioMin}-${i}`}
                        className="absolute overflow-hidden rounded"
                        title={`${e.inizio}${e.fine ? ` – ${e.fine}` : ""} · ${e.titolo}`}
                        style={{
                          top: y(e.inizioMin),
                          left: 3 + e.corsia * largo,
                          width: largo - 1,
                          height: alto,
                          background: colore.fondo,
                          padding: "2px 6px",
                          boxSizing: "border-box"
                        }}
                      >
                        <div
                          className="truncate text-xs font-semibold leading-[14px]"
                          style={{
                            color: colore.testo,
                            textDecoration: e.tipo === "annullato" ? "line-through" : undefined
                          }}
                        >
                          {e.titolo}
                        </div>
                        {alto >= 30 ? (
                          <div className="text-[11px] leading-[14px]" style={{ color: colore.secondario }}>
                            {e.inizio}
                            {e.fine ? ` – ${e.fine}` : ""}
                          </div>
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

      {!caricamento && !errore && eventi.length === 0 ? (
        <div className="mt-3 text-sm text-slate-500">Nessun appuntamento in agenda per questo giorno.</div>
      ) : null}
    </div>
  );
}
