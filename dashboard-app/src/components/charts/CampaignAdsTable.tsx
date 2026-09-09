"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { CampaignSummary } from "@/lib/analytics";
import { formatInt, formatEur, formatPct, formatFloat } from "@/lib/format";
import { categoriaResidua, nomeSenzaCategoria } from "@/lib/campaignCategory";
import {
  BLOCCATA,
  INTESTAZIONE_ANGOLO,
  INTESTAZIONE_FERMA,
  larghezzaColonnaNumeri,
  larghezzaColonnaTesto,
  LINEA_SOTTO,
  LINEE_LATERALI
} from "@/lib/tabelle";

/**
 * Dati "Ads" per campagna e Categoria di raggruppamento.
 *
 * Fonti (tutte reali da settembre 2026):
 * - Spesa      -> foglio Google "Report_Storico_AAAA-MM", via /api/campaign-ads
 * - Lead       -> cronologia HubSpot id_campagna_refresh salvata su Postgres,
 *                 via /api/campaign-conversions
 * - Categoria  -> dedotta dal nome campagna (guessCategoria)
 * - Connessioni, Consulenze e No Show -> Postgres, dai sync di chiamate e
 *                 trattative
 * - Appuntamenti, Chiusure, Importo -> HubSpot in diretta, stesse fonti e
 *                 stesse regole della pagina Advisor
 *
 * Il foglio Operatori non alimenta piu' nulla di questa tabella: la sua colonna
 * "Campagna" contiene 9 categorie e non i nomi delle campagne, quindi l'aggancio
 * per nome falliva su ogni riga.
 */
export type CampaignAdsRow = {
  categoria: string;
  campagna: string;
  spesa: number;
  /** true quando la spesa non e' un dato ma una ripartizione: succede nelle
   *  viste Instant e Non Instant, dove il foglio Ads conosce la campagna intera
   *  e la quota del gruppo viene stimata in proporzione ai Lead Generati. */
  spesaStimata?: boolean;
  /** Persone distinte che hanno convertito su questa campagna nel periodo:
   *  due iscrizioni alla stessa campagna valgono 1, tre campagne diverse
   *  valgono 3. */
  leadGenerati: number;
  /** Lead NUOVI: persone la cui prima conversione in assoluto cade nel
   *  periodo. Prima non esistevano nel database. Valore stabile: rileggendo un
   *  mese passato si ottiene sempre lo stesso numero. */
  leadUnici: number;
};

type RawTotals = {
  spesa: number;
  leadGenerati: number;
  leadUnici: number;
  chiamate: number;
  risposte: number;
  fissati: number;
  processati: number;
  noShow: number;
  chiusure: number;
  importo: number;
};

type DerivedMetrics = RawTotals & {
  cplGenerati: number | null;
  cplUnici: number | null;
  pctAppuntamento: number | null;
  cpas: number | null;
  pctConsulenza: number | null;
  pctShowUp: number | null;
  crSales: number | null;
  cpa: number | null;
  roas: number | null;
};

const emptyRaw: RawTotals = {
  spesa: 0,
  leadGenerati: 0,
  leadUnici: 0,
  chiamate: 0,
  risposte: 0,
  fissati: 0,
  processati: 0,
  noShow: 0,
  chiusure: 0,
  importo: 0
};

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Appuntamenti, Chiusure e Importo di una campagna, da HubSpot. */
export type FunnelCampagna = {
  appuntamenti: number;
  chiusure: number;
  importo: number;
  /** Consulenze svolte: dal sync delle trattative su Postgres. */
  consulenze: number;
  /** Appuntamenti disertati nel periodo, dalla stessa fonte. */
  noShow: number;
  /** Telefonate fatte a contatti della campagna, dal sync delle chiamate. */
  chiamate: number;
  /** Di quelle, quelle con esito "Connesso". */
  connessioni: number;
};

function toRaw(ads: CampaignAdsRow, summary?: CampaignSummary, funnel?: FunnelCampagna): RawTotals {
  return {
    spesa: ads.spesa,
    leadGenerati: ads.leadGenerati,
    leadUnici: ads.leadUnici,
    // Connessioni: telefonate con esito "Connesso" a contatti della campagna,
    // dal sync delle chiamate. Il foglio Operatori non poteva servire allo
    // scopo perche' le tiene solo per CATEGORIA.
    // Telefonate fatte e, di quelle, quelle a cui la persona ha risposto.
    chiamate: funnel?.chiamate ?? 0,
    risposte: funnel?.connessioni ?? 0,
    processati: funnel?.consulenze ?? 0,
    noShow: funnel?.noShow ?? 0,
    // Questi tre vengono da HubSpot, aggregati per id_campagna_track: stesse
    // fonti e stesse regole della pagina Advisor.
    fissati: funnel?.appuntamenti ?? 0,
    chiusure: funnel?.chiusure ?? 0,
    importo: funnel?.importo ?? 0
  };
}

function addRaw(a: RawTotals, b: RawTotals): RawTotals {
  return {
    spesa: a.spesa + b.spesa,
    leadGenerati: a.leadGenerati + b.leadGenerati,
    leadUnici: a.leadUnici + b.leadUnici,
    chiamate: a.chiamate + b.chiamate,
    risposte: a.risposte + b.risposte,
    fissati: a.fissati + b.fissati,
    processati: a.processati + b.processati,
    noShow: a.noShow + b.noShow,
    chiusure: a.chiusure + b.chiusure,
    importo: a.importo + b.importo
  };
}

function div(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

/**
 * Costo per unita'. Vale null anche quando la spesa e' zero, non solo quando lo
 * e' il denominatore: "0,00 EUR" per lead si legge come "questi lead non sono
 * costati nulla", che e' un'informazione, mentre qui il fatto e' che la spesa
 * non c'e' da ripartire.
 *
 * Succede in due casi diversi e in entrambi il trattino e' piu' onesto dello
 * zero: le campagne senza investimento nel periodo, e la vista Instant, dove il
 * foglio Ads non conosce il suffisso "_test_instant" e quindi nessuna spesa
 * finisce su quelle righe (l'investimento e' della campagna intera, e
 * spalmarlo sul sottoinsieme sarebbe un numero inventato).
 */
function costoPerUnita(spesa: number, unita: number): number | null {
  return spesa > 0 && unita > 0 ? spesa / unita : null;
}

// % Show Up = consulenze svolte sul totale degli appuntamenti giunti a
// scadenza (svolti + disertati). Prima calcolava No Show / Consulenze, che era
// il suo esatto contrario e poteva superare il 100%: ad agosto i disertati sono
// piu' degli svolti.
function deriveMetrics(raw: RawTotals): DerivedMetrics {
  return {
    ...raw,
    cplGenerati: costoPerUnita(raw.spesa, raw.leadGenerati),
    cplUnici: costoPerUnita(raw.spesa, raw.leadUnici),
    // % Appuntamento : delle persone raggiunte al telefono, quante hanno
    //                   fissato un appuntamento
    pctAppuntamento: div(raw.fissati, raw.risposte),
    cpas: costoPerUnita(raw.spesa, raw.processati),
    // % Consulenza   : delle persone raggiunte al telefono, quante sono
    //                   arrivate a una consulenza svolta. Stessa formula della
    //                   colonna "% App S" del report Looker, per poter
    //                   confrontare le due tabelle riga per riga.
    //
    //                   Prima era Consulenze/Appuntamenti. Quel rapporto
    //                   mescolava due gruppi diversi - consulenze svolte nel
    //                   periodo contro appuntamenti nati nel periodo - e poteva
    //                   superare il 100% quando si recuperava un arretrato (su
    //                   Looker si vede una riga al 160%). La domanda a cui
    //                   rispondeva e' coperta meglio da % Show Up, che confronta
    //                   solo appuntamenti giunti a scadenza.
    pctConsulenza: div(raw.processati, raw.risposte),
    pctShowUp: div(raw.processati, raw.processati + raw.noShow),
    crSales: div(raw.chiusure, raw.processati),
    cpa: costoPerUnita(raw.spesa, raw.chiusure),
    roas: div(raw.importo, raw.spesa)
  };
}

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

type MaxValues = {
  spesa: number;
  leadGenerati: number;
  cplGenerati: number;
  leadUnici: number;
  cplUnici: number;
  chiamate: number;
  risposte: number;
  fissati: number;
  processati: number;
  cpas: number;
  chiusure: number;
  importo: number;
  cpa: number;
  roas: number;
};

function fmtPct(v: number | null): ReactNode {
  return v !== null ? formatPct(v, 1) : <span className="text-slate-400">–</span>;
}

function fmtEur(v: number | null, digits = 0): ReactNode {
  return v !== null ? formatEur(v, digits) : <span className="text-slate-400">–</span>;
}

/**
 * Le colonne dei numeri: intestazione e campo su cui ordina il suo click.
 *
 * L'intestazione e il campo stanno nella stessa riga di proposito. Erano due
 * elenchi separati - i titoli qui, i valori dentro MetricCells - e finche' si
 * trattava solo di scriverli nello stesso ordine bastava attenzione; ora che il
 * titolo deve anche sapere su cosa ordinare, tenerli separati vorrebbe dire che
 * cliccando "Consulenze" si ordina per "CPAS" senza che niente se ne accorga.
 *
 * L'ORDINE DEVE RESTARE QUELLO DELLE CELLE in MetricCells, che disegna le
 * colonne una dopo l'altra: sono diciotto in fila, e le due liste vanno lette
 * insieme quando se ne aggiunge una.
 */
const COLONNE: Array<{ label: string; chiave: keyof DerivedMetrics }> = [
  { label: "Spesa", chiave: "spesa" },
  { label: "Lead Generati", chiave: "leadGenerati" },
  { label: "CPL Generati", chiave: "cplGenerati" },
  { label: "Lead Unici", chiave: "leadUnici" },
  { label: "CPL Unici", chiave: "cplUnici" },
  { label: "Chiamate", chiave: "chiamate" },
  { label: "Connessioni", chiave: "risposte" },
  { label: "Appuntamenti", chiave: "fissati" },
  { label: "% Appuntamento", chiave: "pctAppuntamento" },
  { label: "Consulenze", chiave: "processati" },
  { label: "CPAS", chiave: "cpas" },
  { label: "% Consulenza", chiave: "pctConsulenza" },
  { label: "% Show Up", chiave: "pctShowUp" },
  { label: "Chiusure", chiave: "chiusure" },
  { label: "Importo", chiave: "importo" },
  { label: "CR Sales", chiave: "crSales" },
  { label: "CPA", chiave: "cpa" },
  { label: "ROAS", chiave: "roas" }
];

const HEADERS = COLONNE.map((c) => c.label);

const LARGHEZZA_NUMERI = larghezzaColonnaNumeri(HEADERS);

function MetricCells({ m, max }: { m: DerivedMetrics; max: MaxValues }) {
  return (
    <>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.spesa, max.spesa) }}>
        {/* Due decimali: il foglio Ads riporta la spesa al centesimo. */}
        {fmtEur(m.spesa, 2)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.leadGenerati, max.leadGenerati) }}>
        {formatInt(m.leadGenerati)}
      </td>
      <td
        className="border-r border-white px-2 py-1.5 text-right tabular-nums"
        style={{ background: m.cplGenerati !== null ? heatBg(m.cplGenerati, max.cplGenerati) : undefined }}
      >
        {fmtEur(m.cplGenerati, 2)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.leadUnici, max.leadUnici) }}>
        {formatInt(m.leadUnici)}
      </td>
      <td
        className="border-r border-white px-2 py-1.5 text-right tabular-nums"
        style={{ background: m.cplUnici !== null ? heatBg(m.cplUnici, max.cplUnici) : undefined }}
      >
        {fmtEur(m.cplUnici, 2)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.chiamate, max.chiamate) }}>
        {formatInt(m.chiamate)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.risposte, max.risposte) }}>
        {formatInt(m.risposte)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.fissati, max.fissati) }}>
        {formatInt(m.fissati)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.pctAppuntamento) }}>
        {fmtPct(m.pctAppuntamento)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.processati, max.processati) }}>
        {formatInt(m.processati)}
      </td>
      <td
        className="border-r border-white px-2 py-1.5 text-right tabular-nums"
        style={{ background: m.cpas !== null ? heatBg(m.cpas, max.cpas) : undefined }}
      >
        {fmtEur(m.cpas, 2)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.pctConsulenza) }}>
        {fmtPct(m.pctConsulenza)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.pctShowUp) }}>
        {fmtPct(m.pctShowUp)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.chiusure, max.chiusure) }}>
        {formatInt(m.chiusure)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right tabular-nums" style={{ background: heatBg(m.importo, max.importo) }}>
        {fmtEur(m.importo)}
      </td>
      <td className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums" style={{ background: rateBg(m.crSales) }}>
        {fmtPct(m.crSales)}
      </td>
      <td
        className="border-r border-white px-2 py-1.5 text-right tabular-nums"
        style={{ background: m.cpa !== null ? heatBg(m.cpa, max.cpa) : undefined }}
      >
        {fmtEur(m.cpa, 2)}
      </td>
      <td
        className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums"
        style={{ background: m.roas !== null ? heatBg(m.roas, max.roas) : undefined }}
      >
        {m.roas !== null ? `${formatFloat(m.roas, 2)}x` : <span className="text-slate-400">–</span>}
      </td>
    </>
  );
}

/**
 * La cella con il nome della campagna.
 *
 * Mostra il nome senza il prefisso di categoria, su una riga sola, tagliandolo
 * con i puntini se non ci sta. Il nome intero si legge fermandoci sopra il
 * mouse, che e' l'unico modo che non muove niente: aprirlo dentro la cella
 * allungava la riga e faceva ballare la tabella sotto le mani.
 *
 * VALE IN TUTTE E QUATTRO LE VISTE, Singole compresa. Li' il nome e' quello
 * scritto in HubSpot e si potrebbe volerlo cercare per intero, ma quello che
 * distingue una variante - il suffisso - sta in fondo e resta visibile: a
 * cadere e' solo il prefisso, che e' scritto nella colonna accanto.
 */
function CellaNome({
  campagna,
  sinistra
}: {
  campagna: string;
  sinistra: number;
}) {
  return (
    <td
      className={`${BLOCCATA} ${LINEE_LATERALI} truncate bg-white px-3 py-1.5 text-slate-700 group-hover:bg-slate-50`}
      style={{ left: sinistra }}
      title={campagna}
    >
      {nomeSenzaCategoria(campagna)}
    </td>
  );
}

export default function CampaignAdsTable({
  adsRows,
  campaignSummary,
  funnelByCampagna
}: {
  adsRows: CampaignAdsRow[];
  campaignSummary: CampaignSummary[];
  funnelByCampagna?: Map<string, FunnelCampagna>;
}) {
  const summaryByCampagna = useMemo(() => {
    const map = new Map<string, CampaignSummary>();
    for (const s of campaignSummary) map.set(normKey(s.campagna), s);
    return map;
  }, [campaignSummary]);

  const groups = useMemo(() => {
    const byCategoria = new Map<string, { campagna: string; raw: RawTotals }[]>();
    for (const ads of adsRows) {
      const raw = toRaw(ads, summaryByCampagna.get(normKey(ads.campagna)), funnelByCampagna?.get(normKey(ads.campagna)));
      const list = byCategoria.get(ads.categoria) ?? [];
      list.push({ campagna: ads.campagna, raw });
      byCategoria.set(ads.categoria, list);
    }
    const list = Array.from(byCategoria.entries()).map(([categoria, rows]) => ({
      categoria,
      // Dentro ogni categoria le campagne vanno dalla piu' alla meno costosa,
      // cosi' le voci che pesano sul budget si leggono per prime. A parita' di
      // spesa si ordina per nome: senza un criterio di spareggio l'ordine
      // dipenderebbe da come sono arrivate le righe e potrebbe cambiare fra un
      // caricamento e l'altro.
      rows: [...rows].sort(
        (a, b) => b.raw.spesa - a.raw.spesa || a.campagna.localeCompare(b.campagna, "it")
      ),
      totale: rows.reduce((acc, r) => addRaw(acc, r.raw), emptyRaw)
    }));

    return list.sort((a, b) => {
      const aLast = categoriaResidua(a.categoria);
      const bLast = categoriaResidua(b.categoria);
      if (aLast !== bLast) return aLast ? 1 : -1;
      return b.totale.spesa - a.totale.spesa;
    });
  }, [adsRows, summaryByCampagna, funnelByCampagna]);

  // La colonna su cui si sta ordinando, dal piu' grande al piu' piccolo.
  //
  // Vuota vuol dire ordine di partenza: categorie per spesa, e dentro ognuna le
  // campagne per spesa. Non viene ricordata da nessuna parte, quindi ogni
  // ricaricamento riporta la tabella li'.
  const [ordina, setOrdina] = useState<keyof DerivedMetrics | null>(null);

  /**
   * L'ORDINAMENTO RESTA DENTRO LE CATEGORIE, che non si sciolgono mai: la
   * tabella e' letta per linea di prodotto, e un elenco unico costringerebbe a
   * ricomporre a mente quali righe appartengono a quale.
   *
   * Si ordina su due livelli, tutti e due sulla colonna cliccata: le categorie
   * fra loro per il proprio totale, e le campagne dentro ognuna. Lasciando le
   * categorie ferme al loro ordine di spesa, cliccando "Consulenze" in cima
   * sarebbe rimasta la categoria che spende di piu' anche senza una consulenza.
   *
   * "Altro" e "Nessuna" restano in fondo come sempre: non sono linee di
   * prodotto ma il posto dove finisce cio' che la regola non riconosce, e in
   * mezzo alle altre sembrerebbero categorie come tutte.
   */
  const gruppiVisibili = useMemo(() => {
    if (!ordina) return groups;
    // Le celle vuote - un costo per lead dove non c'e' spesa - vanno in fondo:
    // trattarle come zero le metterebbe in mezzo ai valori bassi veri.
    const valore = (raw: RawTotals) => deriveMetrics(raw)[ordina] ?? -Infinity;

    return groups
      .map((g) => ({
        ...g,
        // Il valore si calcola una volta per riga e non a ogni confronto: sono
        // centinaia di righe, e ordinarle fa migliaia di confronti. A parita'
        // si ordina per nome, se no l'ordine cambierebbe da un giro all'altro.
        rows: g.rows
          .map((r) => ({ r, v: valore(r.raw) }))
          .sort((a, b) => b.v - a.v || a.r.campagna.localeCompare(b.r.campagna, "it"))
          .map((x) => x.r)
      }))
      .sort((a, b) => {
        const aUltima = categoriaResidua(a.categoria);
        const bUltima = categoriaResidua(b.categoria);
        if (aUltima !== bUltima) return aUltima ? 1 : -1;
        return valore(b.totale) - valore(a.totale);
      });
  }, [groups, ordina]);

  const alternaOrdine = (chiave: keyof DerivedMetrics) =>
    // Ricliccando la stessa colonna si torna all'ordine di partenza: senza,
    // l'unico modo di riaverlo sarebbe ricaricare la pagina.
    setOrdina((prima) => (prima === chiave ? null : chiave));

  // LARGHEZZA DELLE DUE COLONNE DI TESTO, misurata sui nomi che ci sono davvero.
  //
  // Devono contenere il nome intero su una riga sola: troncarlo nasconderebbe la
  // fine, che e' dove due campagne si distinguono, e mandarlo a capo darebbe
  // righe di altezze diverse. Ma fissarla sul caso peggiore - il nome piu' lungo
  // e' di 94 caratteri, contro una mediana di 29 - sprecherebbe mezzo schermo su
  // ogni riga normale.
  //
  // Si stima da 7,6 pixel per carattere piu' il padding: e' una sovrastima
  // prudente, perche' se cadesse corta il testo uscirebbe dalla colonna.
  const larghezze = useMemo(() => {
    const categoria = larghezzaColonnaTesto(groups.map((g) => g.categoria), 96, 220, 14);
      // Il tetto di 900 pixel copre nomi fino a 114 caratteri, contro i 94 del
      // piu' lungo che esiste oggi: serve solo a impedire che un nome fuori
      // scala renda la tabella inutilizzabile. Oltre quella soglia il nome
      // uscirebbe dalla colonna, e si vedrebbe.
    // La misura si prende sui nomi COME SI VEDONO, cioe' senza il prefisso di
    // categoria. Misurarla sugli interi terrebbe occupata una colonna larga il
    // doppio del suo contenuto - e da quando e' bloccata, quei pixel sono
    // sempre occupati e non si possono scorrere via.
    //
    // Non c'e' piu' la moderazione che mediava con la vecchia larghezza fissa
    // di 340 pixel: serviva ai nomi interi, che arrivavano a 94 caratteri.
    // Accorciati sono gia' corti, e prenderli per intero non taglia niente.
    const campagna = larghezzaColonnaTesto(
      groups.flatMap((g) => g.rows.map((r) => nomeSenzaCategoria(r.campagna))),
      200,
      900
    );
    // La tabella riceve una larghezza ESPLICITA, somma delle sue colonne.
    //
    // Con table-layout: fixed e larghezza automatica il browser ha margine di
    // interpretazione su quanto sia larga la tabella, e finisce per ridistribuire
    // lo spazio fra le colonne invece di rispettare le misure del colgroup: il
    // risultato era che le colonne dei numeri restavano di larghezze diverse,
    // ognuna adattata al proprio contenuto. Dandogliela esplicita non c'e' piu'
    // niente da decidere.
    //
    // E' sempre piu' larga dello schermo - le sole diciassette colonne di numeri
    // fanno 2.244 pixel - quindi si scorre, ed e' esattamente il motivo per cui
    // le prime due colonne sono bloccate.
    return {
      categoria,
      campagna,
      totale: categoria + campagna + HEADERS.length * LARGHEZZA_NUMERI
    };
  }, [groups]);

  const grandTotal = useMemo(
    () => groups.reduce((acc, g) => addRaw(acc, g.totale), emptyRaw),
    [groups]
  );

  const maxValues = useMemo<MaxValues>(() => {
    const rowMetrics = groups.flatMap((g) => g.rows.map((r) => deriveMetrics(r.raw)));
    const maxOf = (values: Array<number | null>) =>
      Math.max(...values.map((v) => v ?? 0), 1);
    return {
      spesa: maxOf(rowMetrics.map((m) => m.spesa)),
      leadGenerati: maxOf(rowMetrics.map((m) => m.leadGenerati)),
      cplGenerati: maxOf(rowMetrics.map((m) => m.cplGenerati)),
      leadUnici: maxOf(rowMetrics.map((m) => m.leadUnici)),
      cplUnici: maxOf(rowMetrics.map((m) => m.cplUnici)),
      chiamate: maxOf(rowMetrics.map((m) => m.chiamate)),
      risposte: maxOf(rowMetrics.map((m) => m.risposte)),
      fissati: maxOf(rowMetrics.map((m) => m.fissati)),
      processati: maxOf(rowMetrics.map((m) => m.processati)),
      cpas: maxOf(rowMetrics.map((m) => m.cpas)),
      chiusure: maxOf(rowMetrics.map((m) => m.chiusure)),
      importo: maxOf(rowMetrics.map((m) => m.importo)),
      cpa: maxOf(rowMetrics.map((m) => m.cpa)),
      roas: maxOf(rowMetrics.map((m) => m.roas))
    };
  }, [groups]);

  if (!adsRows.length) return null;

  return (
    // Il tetto di altezza non e' una scelta estetica: senza, la riga delle
    // intestazioni non avrebbe niente a cui restare agganciata. Vedi
    // INTESTAZIONE_FERMA. 75vh lascia sempre in vista i filtri sopra e
    // l'inizio della sezione sotto, cosi' si capisce che la tabella e' un
    // riquadro che scorre per conto suo.
    <div className="max-h-[75vh] overflow-auto">
      {/* table-fixed piu' il colgroup danno alle diciassette colonne di numeri
          la stessa larghezza: con il calcolo automatico ognuna si adattava al
          proprio contenuto e la griglia risultava sghemba. Categoria e Campagna
          restano piu' larghe perche' contengono testo, non cifre. */}
      <table
        className="table-fixed border-collapse text-sm"
        style={{ width: larghezze.totale, minWidth: larghezze.totale }}
      >
        <colgroup>
          <col style={{ width: larghezze.categoria }} />
          <col style={{ width: larghezze.campagna }} />
          {HEADERS.map((h) => (
            <col key={h} style={{ width: LARGHEZZA_NUMERI }} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th
              className={`${INTESTAZIONE_ANGOLO} ${LINEA_SOTTO} bg-white py-2 pr-4 pl-0 text-left`}
              style={{ left: 0 }}
            >
              Categoria
            </th>
            <th
              className={`${INTESTAZIONE_ANGOLO} ${LINEA_SOTTO} bg-white px-3 py-2 text-left`}
              style={{ left: larghezze.categoria }}
            >
              Campagna
            </th>
            {COLONNE.map((c) => {
              const attiva = ordina === c.chiave;
              return (
                <th
                  key={c.label}
                  onClick={() => alternaOrdine(c.chiave)}
                  title={
                    attiva
                      ? "Torna all'ordine di partenza"
                      : `Ordina per ${c.label}, dal piu' grande`
                  }
                  // La colonna su cui si ordina si riconosce dal fondo grigio e
                  // dal testo nero. Niente frecce: le colonne sono larghe
                  // quanto la loro intestazione, e una freccia in piu' le
                  // avrebbe allargate tutte e diciotto per servirne una.
                  className={`${INTESTAZIONE_FERMA} ${LINEA_SOTTO} cursor-pointer select-none px-2 py-2 whitespace-nowrap transition hover:text-black ${
                    attiva ? "bg-neutral-100 text-black" : "bg-white"
                  }`}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        {/* I bordi sono espliciti riga per riga invece che con `divide-y` sul
            tbody: servono due spessori diversi (marcato per aprire una
            categoria, leggero fra le campagne al suo interno) e `divide-y` ne
            imporrebbe uno solo a tutte le righe. Prima la linea marcata sopra
            la prima categoria arrivava dall'intestazione, quindi era un caso
            fortuito che non si ripeteva sulle altre.

            Fra una categoria e l'altra non c'e' riga vuota: a separarle basta
            la linea marcata che apre la successiva, e senza lo stacco ci stanno
            piu' campagne nella stessa schermata. */}
        <tbody>
          {gruppiVisibili.map((g, gIdx) => (
            <Fragment key={g.categoria}>
              {g.rows.map((r, idx) => (
                <tr
                  key={`${g.categoria}-${r.campagna}`}
                  // La primissima riga non ha bordo alto: li' la linea la
                  // disegna gia' l'intestazione, e due linee attaccate ne
                  // farebbero una doppia. Le altre categorie lo tengono, e'
                  // quello che le separa fra loro.
                  className={`group hover:bg-slate-50/70 transition-colors ${
                    idx !== 0
                      ? "border-t border-slate-100"
                      : gIdx === 0
                        ? ""
                        : "border-t-2 border-slate-200"
                  }`}
                >
                  {idx === 0 ? (
                    <td
                      className={`${BLOCCATA} bg-white py-1.5 pr-4 pl-0 align-top font-semibold text-slate-800 whitespace-nowrap`}
                      style={{ left: 0 }}
                      rowSpan={g.rows.length}
                    >
                      {g.categoria}
                    </td>
                  ) : null}
                  <CellaNome campagna={r.campagna} sinistra={larghezze.categoria} />
                  <MetricCells m={deriveMetrics(r.raw)} max={maxValues} />
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900">
            <td
              className={`${BLOCCATA} bg-slate-100 py-2 pr-4 pl-0`}
              colSpan={2}
              style={{ left: 0 }}
            >
              Totale
            </td>
            <MetricCells m={deriveMetrics(grandTotal)} max={maxValues} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
