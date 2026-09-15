"use client";

import { useMemo, useState } from "react";
import type { OperatorSummary } from "@/lib/analytics";
import { formatInt, formatPct, formatEur } from "@/lib/format";
import {
  BLOCCATA,
  INTESTAZIONE_ANGOLO,
  INTESTAZIONE_FERMA,
  larghezzaColonnaNumeri,
  larghezzaColonnaTesto,
  LINEA_DESTRA,
  LINEA_SOTTO
} from "@/lib/tabelle";

function heatBg(value: number, max: number): string {
  if (max === 0 || value === 0) return "";
  const pct = Math.min(value / max, 1);
  return `rgba(14, 165, 233, ${(0.08 + pct * 0.35).toFixed(2)})`;
}

function rateBg(rate: number | null): string {
  if (rate === null || rate === 0) return "";
  const pct = Math.min(rate, 1);
  return `rgba(245, 158, 11, ${(0.1 + pct * 0.45).toFixed(2)})`;
}

function tassoPresa(appt: number, conn: number): number | null {
  return conn > 0 ? appt / conn : null;
}

function tassoChiusura(chius: number, cons: number): number | null {
  return cons > 0 ? chius / cons : null;
}

/**
 * Quanto dura una consulenza, in minuti.
 *
 * MISURATO, NON DECISO: 76 call registrate negli ultimi 21 giorni danno media
 * 45 minuti e mediana 46. La distribuzione e' larga - deviazione standard 26
 * minuti, il 26% sotto i venti e il 17% sopra i settanta - quindi questo numero
 * descrive bene il totale di un periodo e male la singola consulenza. Per una
 * colonna che confronta persone su decine di consulenze e' il totale che conta.
 *
 * PERCHE' NON LA DURATA DELLO SLOT PRENOTATO, che sembra il dato ovvio ed e'
 * quello che questa colonna usava fino a stamattina: gli slot non dicono quanto
 * e' durata la call. Uno slot da 30 minuti produce call di 48 minuti in media,
 * uno da 60 ne produce di 44 - cioe' la consulenza dura tre quarti d'ora
 * qualunque cosa dica il calendario. Contare gli slot sottostimava del 59% le
 * ore di chi prenota mezz'ora e le sovrastimava del 27% per chi prenota un'ora,
 * e quella distorsione cadeva esattamente lungo il confronto fra advisor che la
 * colonna esiste per fare.
 *
 * QUANDO LE REGISTRAZIONI COPRIRANNO TUTTI GLI ADVISOR questa costante va
 * sostituita dalla durata vera, che nel frattempo viene gia' salvata in
 * presenza_call.durata_min: sara' un cambio di denominatore, non di colonna.
 */
const MINUTI_PER_CONSULENZA = 45;

/**
 * Quanto incassa un advisor per ogni ora di consulenza.
 *
 * Le ore sono stimate dal numero di consulenze, non misurate una per una: vedi
 * MINUTI_PER_CONSULENZA per il perche' e per la misura che lo giustifica.
 */
function resaOraria(incasso: number, consulenze: number): number | null {
  const ore = (consulenze * MINUTI_PER_CONSULENZA) / 60;
  return ore > 0 ? incasso / ore : null;
}

/** Come si legge in cella: "1.240 €/h". L'unita' sta qui e non
 *  nell'intestazione, cosi' il titolo resta una parola sola. */
const formatResa = (v: number): string => `${Math.round(v).toLocaleString("it-IT")} €/h`;

// Serve solo a dare la larghezza alle colonne, che e' quella dell'intestazione
// piu' lunga. I titoli veri, con il campo su cui ordinano, si costruiscono
// dentro il componente: due di loro cambiano fra Advisor e Setter.
const INTESTAZIONI_NUMERI = [
  "Assegnati",
  "Chiamate",
  "Connessioni",
  "Appuntamenti",
  "% Appuntamento",
  "Consulenze",
  "Chiusure",
  "% Chiusura",
  "Boom",
  "Obiettivo",
  "Resa"
];
const LARGHEZZA_NUMERI = larghezzaColonnaNumeri(INTESTAZIONI_NUMERI);

export default function OperatorStatsTable({
  data,
  hubspotOverrides,
  noShowOverrides,
  svolteOverrides,
  trattativeOverrides,
  precomputedTotals,
  hubspotLoading,
  trattativeLoading,
  operatorLabel = "Advisor",
  obiettivi
}: {
  data: OperatorSummary[];
  hubspotOverrides?: Record<string, { chiusure: number; boom: number; incassoChiusure: number }>;
  /**
   * Gli appuntamenti disertati per setter, dal database.
   *
   * Sostituisce la colonna "No Show" del foglio Operatori, che e' ferma a zero
   * dal 19 agosto 2026: lo script di Apps Script che la riempiva cerca un
   * valore HubSpot rinominato nel frattempo. Il foglio perde anche giorni
   * interi quando il trigger giornaliero non parte, e non li recupera mai.
   *
   * Chiave: nome del setter minuscolo e con gli spazi normalizzati, la stessa
   * di hubspotOverrides.
   */
  noShowOverrides?: Record<string, number>;
  /**
   * Le consulenze svolte nate dagli appuntamenti di quel setter, dal database.
   *
   * Serve al denominatore di "% Chiusura" sulla pagina Setter. La colonna
   * Consulenze del foglio Operatori non va bene: attribuisce la consulenza
   * all'Advisor che la tiene, quindi per chi fa solo il setter vale zero -
   * misurato a settembre, otto persone con appuntamenti e zero consulenze, fra
   * cui chi ne aveva fissati 102 - e la percentuale diventava un trattino.
   */
  svolteOverrides?: Record<string, number>;
  trattativeOverrides?: Record<string, number>;
  precomputedTotals?: { chiusure: number; boom: number };
  hubspotLoading?: boolean;
  trattativeLoading?: boolean;
  operatorLabel?: string;
  /** L'obiettivo di Boom del mese, per persona, con la stessa chiave di nome
   *  degli altri valori che arrivano da fuori.
   *
   *  Oggi non lo alimenta nessuno e la colonna mostra trattini: si riempira'
   *  da un modulo, e l'obiettivo si fissa a inizio mese e resta fermo fino al
   *  mese dopo. Il trattino e' voluto: uno zero si leggerebbe come "obiettivo
   *  zero", che e' un'altra cosa da "non ancora fissato". */
  obiettivi?: Record<string, number>;
}) {
  const isSetterView = operatorLabel === "Setter";
  const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  // Il foglio resta il ripiego: se il database non risponde la colonna mostra
  // il vecchio numero invece di azzerarsi, e per i mesi in cui il foglio era
  // ancora buono i due valori sono confrontabili.
  const effNoShow = (r: OperatorSummary) => noShowOverrides?.[normKey(r.operatore)] ?? r.noShow;
  // Sulla pagina Setter il denominatore sono le consulenze che i SUOI
  // appuntamenti hanno prodotto; su quella Advisor restano le sue, dal foglio.
  const effConsulenzeChiusura = (r: OperatorSummary) =>
    isSetterView ? svolteOverrides?.[normKey(r.operatore)] ?? 0 : r.consulenze;
  const effChiusure = (r: OperatorSummary) => hubspotOverrides?.[normKey(r.operatore)]?.chiusure ?? 0;
  const effBoom = (r: OperatorSummary) => hubspotOverrides?.[normKey(r.operatore)]?.boom ?? 0;
  /**
   * L-incasso delle sole CHIUSURE, che e il numeratore della Resa.
   *
   * Non si usa Boom perche quello comprende rate e upgrade: denaro che arriva
   * su una vendita conclusa mesi prima, spesso da una consulenza tenuta da un
   * altro advisor. Dividerlo per le ore di questo mese accosterebbe un ricavo a
   * un lavoro che non lo ha prodotto. Misurato su settembre: le rate sono il
   * 20% dell-incassato, e su una persona sola valevano 9.250 EUR su 21.750.
   */
  const effIncassoChiusure = (r: OperatorSummary) =>
    hubspotOverrides?.[normKey(r.operatore)]?.incassoChiusure ?? 0;
  const effAppuntamenti = (r: OperatorSummary) => trattativeOverrides?.[normKey(r.operatore)] ?? 0;
  const effObiettivo = (r: OperatorSummary): number | null =>
    obiettivi?.[normKey(r.operatore)] ?? null;

  const totals = useMemo(() => {
    const base = data.reduce(
      (acc, r) => ({
        assegnati: acc.assegnati + r.assegnati,
        chiamate: acc.chiamate + r.chiamate,
        connessioni: acc.connessioni + r.connessioni,
        appuntamenti: acc.appuntamenti + effAppuntamenti(r),
        consulenze: acc.consulenze + (isSetterView ? effNoShow(r) : r.consulenze),
        svolte: acc.svolte + effConsulenzeChiusura(r),
        chiusure: acc.chiusure + effChiusure(r),
        boom: acc.boom + effBoom(r),
        obiettivo: acc.obiettivo + (effObiettivo(r) ?? 0)
      }),
      { assegnati: 0, chiamate: 0, connessioni: 0, appuntamenti: 0, consulenze: 0, svolte: 0, chiusure: 0, boom: 0, obiettivo: 0 }
    );
    return {
      ...base,
      // Null quando nessuno ha un obiettivo: sommare zeri e scrivere "0 EUR"
      // direbbe che l'obiettivo del mese e' zero.
      obiettivo: data.some((r) => effObiettivo(r) !== null) ? base.obiettivo : null,
      chiusure: precomputedTotals?.chiusure ?? base.chiusure,
      boom: precomputedTotals?.boom ?? base.boom
    };
  }, [data, hubspotOverrides, trattativeOverrides, noShowOverrides, svolteOverrides, precomputedTotals, obiettivi]);

  const maxValues = useMemo(
    () => ({
      assegnati: Math.max(...data.map((r) => r.assegnati), 1),
      chiamate: Math.max(...data.map((r) => r.chiamate), 1),
      connessioni: Math.max(...data.map((r) => r.connessioni), 1),
      appuntamenti: Math.max(...data.map((r) => effAppuntamenti(r)), 1),
      consulenze: Math.max(...data.map((r) => isSetterView ? effNoShow(r) : r.consulenze), 1),
      svolte: Math.max(...data.map((r) => effConsulenzeChiusura(r)), 1),
      chiusure: Math.max(...data.map((r) => effChiusure(r)), 1),
      boom: Math.max(...data.map((r) => effBoom(r)), 1),
      resa: Math.max(...data.map((r) => resaOraria(effIncassoChiusure(r), r.consulenze) ?? 0), 1)
    }),
    [data, hubspotOverrides, trattativeOverrides, noShowOverrides, svolteOverrides]
  );


  const sorted = useMemo(
    () => [...data].sort((a, b) => effBoom(b) - effBoom(a) || effAppuntamenti(b) - effAppuntamenti(a)),
    [data, hubspotOverrides, trattativeOverrides, noShowOverrides, svolteOverrides]
  );

  /**
   * Le nove colonne dei numeri: titolo e valore su cui ordina il suo click.
   *
   * Stanno qui e non fuori dal componente perche' i valori dipendono da quello
   * che arriva da HubSpot - appuntamenti e chiusure sostituiti riga per riga -
   * e perche' una colonna cambia nome fra Advisor e Setter.
   */
  const colonne: Array<{ label: string; valore: (r: OperatorSummary) => number | null }> = [
    { label: "Assegnati", valore: (r) => r.assegnati },
    { label: "Chiamate", valore: (r) => r.chiamate },
    { label: "Connessioni", valore: (r) => r.connessioni },
    { label: "Appuntamenti", valore: (r) => effAppuntamenti(r) },
    { label: "% Appuntamento", valore: (r) => tassoPresa(effAppuntamenti(r), r.connessioni) },
    {
      label: isSetterView ? "No Show" : "Consulenze",
      valore: (r) => (isSetterView ? effNoShow(r) : r.consulenze)
    },
    // LE CONSULENZE DEL SETTER, e quante ne ha prodotte ogni appuntamento.
    //
    // Solo qui: sulla pagina Advisor la colonna Consulenze c'e' gia' - e' la
    // sesta, quella che cambia nome - e sono le sue, dal foglio. Queste sono le
    // consulenze tenute dagli Advisor sugli appuntamenti che LUI ha procurato,
    // e stanno fra No Show e Chiusure perche' e' l'ordine in cui si legge
    // l'imbuto: fissati, disertati, svolti, chiusi.
    ...(isSetterView
      ? [
          { label: "Consulenze", valore: (r: OperatorSummary) => effConsulenzeChiusura(r) },
          {
            label: "% Consulenza",
            // Degli appuntamenti che ha fissato, quanti si sono tenuti. E' il
            // suo tasso di presentazione, la misura di quanto qualifica bene.
            valore: (r: OperatorSummary) => tassoPresa(effConsulenzeChiusura(r), effAppuntamenti(r))
          }
        ]
      : []),
    { label: "Chiusure", valore: (r) => effChiusure(r) },
    { label: "% Chiusura", valore: (r) => tassoChiusura(effChiusure(r), effConsulenzeChiusura(r)) },
    { label: "Boom", valore: (r) => effBoom(r) }
  ];

  // L'OBIETTIVO E' SOLO DEGLI ADVISOR. E' il traguardo di Boom del mese, che si
  // fissa il primo giorno e resta fermo: sui setter, che il Boom lo portano ma
  // non lo chiudono, non e' stato chiesto.
  if (!isSetterView) {
    colonne.push({ label: "Obiettivo", valore: (r) => effObiettivo(r) });
    colonne.push({ label: "Resa", valore: (r) => resaOraria(effIncassoChiusure(r), r.consulenze) });
  }

  // La colonna su cui si sta ordinando. Vuota vuol dire ordine di partenza -
  // per Boom, poi per appuntamenti - e non viene ricordata da nessuna parte,
  // quindi ogni ricaricamento riporta la tabella li'.
  const [ordina, setOrdina] = useState<string | null>(null);
  const colonnaOrdinata = colonne.find((c) => c.label === ordina);
  // Le celle vuote - una percentuale senza denominatore - vanno in fondo:
  // trattarle come zero le metterebbe in mezzo ai valori bassi veri.
  const righe = colonnaOrdinata
    ? [...sorted].sort(
        (a, b) => (colonnaOrdinata.valore(b) ?? -Infinity) - (colonnaOrdinata.valore(a) ?? -Infinity)
      )
    : sorted;

  const totalTp = tassoPresa(totals.appuntamenti, totals.connessioni);
  // Sulla vista Setter il totale era soppresso perche' il denominatore era
  // zero. Ora c'e': sono le consulenze svolte, la stessa somma che la colonna
  // Consulenze mostra in fondo.
  const totalTc = tassoChiusura(totals.chiusure, isSetterView ? totals.svolte : totals.consulenze);
  // Come le altre percentuali del totale: il rapporto fra le somme, non la
  // media dei rapporti, che darebbe lo stesso peso a chi ha fissato due
  // appuntamenti e a chi ne ha fissati cento.
  const totalPc = tassoPresa(totals.svolte, totals.appuntamenti);
  const resaTotale = resaOraria(
    sorted.reduce((s, r) => s + effIncassoChiusure(r), 0),
    totals.consulenze
  );

  if (!data.length) return null;

  // Stessa griglia della tabella Campagne, e stesse ragioni: le nove colonne dei
  // numeri hanno tutte la stessa larghezza, ricavata dall'intestazione piu'
  // lunga, e la colonna del nome si dimensiona sul nome piu' lungo presente.
  //
  // Le misure sono in pixel e non in percentuale perche' su un telefono una
  // tabella a percentuali schiaccerebbe dieci colonne dentro 375 pixel,
  // rendendole illeggibili. Cosi' invece la tabella scorre - ed e' il motivo per
  // cui la prima colonna e' bloccata: scorrendo verso Boom si continua a vedere
  // di chi sono i numeri che si stanno leggendo.
  const larghezzaNome = larghezzaColonnaTesto(
    [operatorLabel, ...sorted.map((r) => r.operatore)],
    120,
    320,
    14
  );
  const larghezzaTotale = larghezzaNome + colonne.length * LARGHEZZA_NUMERI;

  return (
    // Il tetto d'altezza serve alla riga delle intestazioni per restare ferma:
    // vedi INTESTAZIONE_FERMA. Qui le righe sono poche e quasi sempre ci stanno
    // tutte, quindi il piu' delle volte non si vede nemmeno la barra.
    <div className="max-h-[75vh] overflow-auto">
      {/* width al 100% con un minimo: su schermo largo le colonne crescono in
          proporzione restando uguali fra loro, su schermo stretto si scorre. */}
      <table
        className="table-fixed border-collapse text-sm"
        style={{ width: "100%", minWidth: larghezzaTotale }}
      >
        <colgroup>
          <col style={{ width: larghezzaNome }} />
          {colonne.map((_, i) => (
            <col key={i} style={{ width: LARGHEZZA_NUMERI }} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th
              className={`${INTESTAZIONE_ANGOLO} ${LINEA_SOTTO} bg-white py-2 pr-4 pl-0 text-left`}
              style={{ left: 0 }}
            >
              {operatorLabel}
            </th>
            {colonne.map((c) => {
              const attiva = ordina === c.label;
              return (
                <th
                  key={c.label}
                  onClick={() => setOrdina((prima) => (prima === c.label ? null : c.label))}
                  title={
                    attiva ? "Torna all'ordine di partenza" : `Ordina per ${c.label}, dal piu' grande`
                  }
                  // La colonna su cui si ordina si riconosce dal fondo grigio e
                  // dal testo nero. Niente frecce: le colonne sono larghe
                  // quanto la loro intestazione, e una freccia in piu' le
                  // avrebbe allargate tutte per servirne una.
                  className={`${INTESTAZIONE_FERMA} ${LINEA_SOTTO} cursor-pointer select-none px-2 py-2 leading-tight transition hover:text-black ${
                    attiva ? "bg-neutral-100 text-black" : "bg-white"
                  }`}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {righe.map((r) => {
            const tp = tassoPresa(effAppuntamenti(r), r.connessioni);
            const tc = tassoChiusura(effChiusure(r), effConsulenzeChiusura(r));
            // Quanti dei suoi appuntamenti si sono tenuti. Il denominatore sono
            // gli appuntamenti, quindi dipende dal caricamento delle trattative
            // e non da quello degli incassi.
            const pc = tassoPresa(effConsulenzeChiusura(r), effAppuntamenti(r));
            return (
              <tr key={r.operatore} className="group hover:bg-slate-50/70 transition-colors">
                <td
                  className={`${BLOCCATA} ${LINEA_DESTRA} bg-white py-1.5 pr-4 pl-0 font-medium text-slate-800 whitespace-nowrap group-hover:bg-slate-50`}
                  style={{ left: 0 }}
                >
                  {r.operatore}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.assegnati, maxValues.assegnati) }}
                >
                  {formatInt(r.assegnati)}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.chiamate, maxValues.chiamate) }}
                >
                  {formatInt(r.chiamate)}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(r.connessioni, maxValues.connessioni) }}
                >
                  {formatInt(r.connessioni)}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: trattativeLoading ? undefined : heatBg(effAppuntamenti(r), maxValues.appuntamenti) }}
                >
                  {trattativeLoading ? <span className="text-slate-400">–</span> : formatInt(effAppuntamenti(r))}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: rateBg(tp) }}
                >
                  {tp !== null ? formatPct(tp, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(isSetterView ? effNoShow(r) : r.consulenze, maxValues.consulenze) }}
                >
                  {formatInt(isSetterView ? effNoShow(r) : r.consulenze)}
                </td>
                {isSetterView ? (
                  <>
                    <td
                      className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                      style={{ background: heatBg(effConsulenzeChiusura(r), maxValues.svolte) }}
                    >
                      {formatInt(effConsulenzeChiusura(r))}
                    </td>
                    <td
                      className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums"
                      style={{ background: trattativeLoading ? undefined : rateBg(pc) }}
                    >
                      {trattativeLoading ? (
                        <span className="text-slate-400">–</span>
                      ) : pc !== null ? (
                        formatPct(pc, 2)
                      ) : (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                  </>
                ) : null}
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: hubspotLoading ? undefined : heatBg(effChiusure(r), maxValues.chiusure) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : formatInt(effChiusure(r))}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: hubspotLoading ? undefined : rateBg(tc) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : tc !== null ? formatPct(tc, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: hubspotLoading ? undefined : heatBg(effBoom(r), maxValues.boom) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : formatEur(effBoom(r))}
                </td>
                {isSetterView ? null : (
                  <td className="border-r border-white px-2 py-1.5 text-right tabular-nums">
                    {effObiettivo(r) !== null ? (
                      formatEur(effObiettivo(r) as number)
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                )}
                {isSetterView ? null : (
                  <td
                    className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                    style={{
                      background: hubspotLoading
                        ? undefined
                        : heatBg(resaOraria(effIncassoChiusure(r), r.consulenze) ?? 0, maxValues.resa)
                    }}
                  >
                    {hubspotLoading ? (
                      <span className="text-slate-400">–</span>
                    ) : resaOraria(effIncassoChiusure(r), r.consulenze) !== null ? (
                      formatResa(resaOraria(effIncassoChiusure(r), r.consulenze) as number)
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
            <td
              className={`${BLOCCATA} bg-slate-50 py-2 pr-4 pl-0 text-sm whitespace-nowrap`}
              style={{ left: 0 }}
            >
              Totale complessivo
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{formatInt(totals.assegnati)}</td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{formatInt(totals.chiamate)}</td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{formatInt(totals.connessioni)}</td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{trattativeLoading ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.appuntamenti)}</td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {trattativeLoading ? <span className="font-normal text-slate-400">–</span> : totalTp !== null ? formatPct(totalTp, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{formatInt(totals.consulenze)}</td>  {/* consulenze or noShow */}
            {isSetterView ? (
              <>
                <td className="border-r border-white px-2 py-2 text-right tabular-nums">{formatInt(totals.svolte)}</td>
                <td className="border-r border-white px-2 py-2 text-right tabular-nums">
                  {trattativeLoading ? <span className="font-normal text-slate-400">–</span> : totalPc !== null ? formatPct(totalPc, 2) : <span className="font-normal text-slate-400">–</span>}
                </td>
              </>
            ) : null}
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{hubspotLoading ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.chiusure)}</td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {hubspotLoading ? <span className="font-normal text-slate-400">–</span> : totalTc !== null ? formatPct(totalTc, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{hubspotLoading ? <span className="font-normal text-slate-400">–</span> : formatEur(totals.boom)}</td>
            {isSetterView ? null : (
              <td className="border-r border-white px-2 py-2 text-right tabular-nums">
                {totals.obiettivo !== null ? (
                  formatEur(totals.obiettivo)
                ) : (
                  <span className="font-normal text-slate-400">–</span>
                )}
              </td>
            )}
            {isSetterView ? null : (
              <td className="border-r border-white px-2 py-2 text-right tabular-nums">
                {/* La resa del totale NON e' la media delle rese: e' l'incasso
                    di tutti diviso le ore di tutti. La media delle righe darebbe
                    lo stesso peso a chi ha fatto due consulenze e a chi ne ha
                    fatte quaranta. */}
                {hubspotLoading || resaTotale === null ? (
                  <span className="font-normal text-slate-400">–</span>
                ) : (
                  formatResa(resaTotale)
                )}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
