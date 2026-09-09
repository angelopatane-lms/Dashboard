"use client";

import { useEffect, useMemo, useState } from "react";
import type { EventoAgenda, TipoEvento } from "@/app/api/advisor-agenda/route";
import { chiaveNome } from "@/lib/nomi";

// Un'ora alta 44 pixel: dalle 8 alle 20 fa 528, che sta in mezza schermata e
// lascia leggere un appuntamento da mezz'ora senza schiacciarlo.
const ALTEZZA_ORA = 44;
const LARGHEZZA_COLONNA = 120;
const LARGHEZZA_ORE = 64;

/**
 * IL COLORE DICE IL TIPO, NON LA PERSONA.
 *
 * Su Google il colore lo sceglie ognuno per il proprio calendario, quindi non
 * significa niente: qui invece dice a che punto e' l'appuntamento, e lo
 * decidono i dati - e' l'esito che HubSpot tiene sul meeting.
 */
/**
 * Tinte piene e testo bianco, senza bordo.
 *
 * SONO TUTTE ALLO STESSO LIVELLO DI LUMINOSITA', scelto perche' il bianco sopra
 * si legga davvero: a 10 pixel un contrasto sotto il 4,5 a 1 si perde, e i toni
 * piu' chiari di questi - il ciano a meta' scala, il verde smeraldo - stanno
 * fra il 3,8 e il 4,1. Questi quattro stanno fra 4,7 e 5,9.
 *
 * Il secondario e' bianco trasparente e non un grigio: cambiando fondo, un
 * grigio fisso funzionerebbe su una tinta e sparirebbe sulle altre.
 */
const COLORI: Record<TipoEvento, { fondo: string }> = {
  appuntamento: { fondo: "#0369a1" },
  svolta: { fondo: "#047857" },
  interno: { fondo: "#b45309" },
  annullato: { fondo: "#64748b" }
};

const TESTO = "#ffffff";
const TESTO_SECONDARIO = "rgba(255,255,255,0.78)";

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

function etichettaGiorno(giorno: string): string {
  const d = new Date(`${giorno}T12:00:00Z`);
  return d.toLocaleDateString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
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
  errore,
  aggiornato
}: {
  giorno: string;
  onGiorno: (giorno: string) => void;
  eventi: EventoAgenda[];
  /** Le persone della tabella, nel suo stesso ordine. */
  operatori: string[];
  caricamento: boolean;
  errore: boolean;
  /** "14:32", l'ora dell'ultima lettura. */
  aggiornato: string;
}) {
  // L'ora corrente si aggiorna da sola: una linea ferma a quando si e' aperta
  // la pagina sarebbe peggio che non averla.
  const [adesso, setAdesso] = useState<number | null>(null);
  useEffect(() => {
    setAdesso(minutiOra());
    const t = setInterval(() => setAdesso(minutiOra()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const { colonne, senzaNulla } = useMemo(() => {
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

    const tutte = nomi.map((nome) => {
      const suoi = perChiave.get(chiaveNome(nome)) ?? [];
      return {
        nome,
        ...inCorsie(suoi),
        totale: suoi.length,
        // Si contano gli appuntamenti con un cliente: le riunioni interne e gli
        // annullati non sono lavoro fatto ne' da fare.
        quanti: suoi.filter((e) => e.tipo === "appuntamento" || e.tipo === "svolta").length
      };
    });

    // Chi oggi non ha niente non prende una colonna: sono centoventi pixel a
    // testa che spingono fuori schermo chi invece lavora. Il loro nome resta
    // scritto sotto la griglia, che e' l'informazione vera - "oggi questi non
    // hanno appuntamenti" - senza costare mezza tabella.
    return {
      colonne: tutte.filter((c) => c.totale > 0),
      senzaNulla: tutte.filter((c) => c.totale === 0).map((c) => c.nome)
    };
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

  const ore = ultimaOra - primaOra;
  const altezza = ore * ALTEZZA_ORA;
  const y = (minuti: number) => ((minuti - primaOra * 60) / 60) * ALTEZZA_ORA;

  const oggi = giornoRoma();
  const lineaOra = adesso !== null && giorno === oggi ? y(adesso) : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
        <div>
          <div className="text-sm font-semibold text-gray-900">Agenda del giorno</div>
          <div className="mt-1 text-xs text-slate-500">
            Gli appuntamenti presi su HubSpot. Gli impegni che ognuno si segna sul proprio calendario -
            pranzi, blocchi, formazione - non passano di qui e non compaiono.
          </div>
        </div>

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
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-700">{etichettaGiorno(giorno)}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {caricamento ? "lettura in corso..." : `aggiornato alle ${aggiornato}`}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-5">
        {LEGENDA.map((v) => (
          <div key={v.tipo} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: COLORI[v.tipo].fondo }} />
            <span className="text-xs text-slate-600">{v.label}</span>
          </div>
        ))}
        {lineaOra !== null ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="inline-block h-0.5 w-[18px]" style={{ background: "#e11d48" }} />
            <span className="text-xs text-slate-600">ora corrente</span>
          </div>
        ) : null}
      </div>

      {errore ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Agenda non disponibile.</strong> HubSpot non ha risposto: la giornata qui sotto e&apos; vuota
          perche&apos; non l&apos;abbiamo potuta leggere, non perche&apos; non ci siano appuntamenti.
        </div>
      ) : null}

      <div className="mt-4 overflow-auto rounded-md">
        <div style={{ minWidth: LARGHEZZA_ORE + colonne.length * LARGHEZZA_COLONNA }}>
          {/* intestazione: i nomi restano in alto mentre si scorre, come nelle tabelle */}
          <div className="sticky top-0 z-20 flex bg-white shadow-[inset_0_-2px_0_0_#e2e8f0]">
            <div
              className="sticky left-0 z-30 flex-shrink-0 bg-white shadow-[inset_-1px_0_0_0_#cbd5e1]"
              style={{ width: LARGHEZZA_ORE }}
            />
            {colonne.map((c) => (
              <div key={c.nome} className="flex-shrink-0 px-2 pb-2.5 pt-2" style={{ width: LARGHEZZA_COLONNA }}>
                <div className="truncate text-xs font-semibold text-slate-800" title={c.nome}>
                  {c.nome}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {c.quanti === 1 ? "1 appuntamento" : `${c.quanti} appuntamenti`}
                </div>
              </div>
            ))}
          </div>

          <div className="relative flex">
            {/* colonna delle ore, ferma a sinistra */}
            <div
              className="sticky left-0 z-10 flex-shrink-0 bg-white shadow-[inset_-1px_0_0_0_#cbd5e1]"
              style={{ width: LARGHEZZA_ORE, height: altezza, position: "relative" }}
            >
              {Array.from({ length: ore + 1 }, (_, i) => primaOra + i).map((h, i) => (
                <div
                  key={h}
                  className="absolute right-2.5 text-[11px] tabular-nums text-slate-400"
                  style={{ top: i * ALTEZZA_ORA - 7 }}
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
                  style={{ width: LARGHEZZA_COLONNA }}
                >
                  {c.eventi.map((e, i) => {
                    const colore = COLORI[e.tipo];
                    const largo = (LARGHEZZA_COLONNA - 6) / c.corsie;
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
                          className="truncate text-[11px] font-semibold leading-[13px]"
                          style={{
                            color: TESTO,
                            textDecoration: e.tipo === "annullato" ? "line-through" : undefined
                          }}
                        >
                          {e.titolo}
                        </div>
                        {alto >= 30 ? (
                          <div className="text-[10px] leading-[13px]" style={{ color: TESTO_SECONDARIO }}>
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
        </div>
      </div>

      {!caricamento && !errore && eventi.length === 0 ? (
        <div className="mt-3 text-sm text-slate-500">Nessun appuntamento in agenda per questo giorno.</div>
      ) : null}

      {senzaNulla.length > 0 ? (
        <div className="mt-3 text-xs text-slate-500">
          <span className="font-medium text-slate-600">
            {senzaNulla.length === 1 ? "Senza appuntamenti oggi:" : `Senza appuntamenti oggi (${senzaNulla.length}):`}
          </span>{" "}
          {senzaNulla.join(", ")}.
        </div>
      ) : null}
    </div>
  );
}
