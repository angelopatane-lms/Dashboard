"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { applyFilters, getString, type Filters } from "@/lib/metrics";
import { aggregateByCampagna, normalizeOperatori } from "@/lib/analytics";
import { formatPct } from "@/lib/format";
import { guessCategoria } from "@/lib/campaignCategory";
import { chiaveCampagna, leggiVariante, nomeConforme, VARIANTE_DEFAULT, VARIANTI } from "@/lib/campagne";
import CampaignConversionPeaksChart from "@/components/charts/CampaignConversionPeaksChart";
import { FiltersBar } from "@/components/Filters";
import Card from "@/components/ui/Card";
import ChartTitle from "@/components/ui/ChartTitle";
import SectionTitle from "@/components/ui/SectionTitle";
import CampaignSummaryBar from "@/components/charts/CampaignSummaryBar";
import CampaignAdsTable, { type CampaignAdsRow, type FunnelCampagna } from "@/components/charts/CampaignAdsTable";
import type { CampaignAdsSpendRow } from "@/app/api/campaign-ads/route";
import type { CampaignConversionRow } from "@/app/api/campaign-conversions/route";
import type { RawBoomRecord, RawDealRecord } from "@/app/api/hubspot-data/route";
import type { CampaignTrattativeRow } from "@/app/api/campaign-trattative/route";
import type { CampaignChiamateRow } from "@/app/api/campaign-chiamate/route";
import { CHIUSURE_TIPOLOGIE, BOOM_TIPOLOGIE } from "@/lib/hubspotRegole";


type CampaignPeaksDatum = {
  date: string;
  [campaign: string]: string | number | null;
};

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Opzioni del filtro "Tipologia", che su questa pagina prende il posto di
// "Operatore": le righe sono campagne, non persone.
//
// "Con Spesa" riporta la tabella alle sole campagne che hanno investito nel
// periodo. Dacche' mostriamo anche quelle con attivita' ma senza spesa le righe
// sono passate da 73 a 445 sul trimestre: la vista completa serve a far tornare
// i totali, questa a lavorare comodamente.
const TIPOLOGIE = [{ label: "Con Spesa", value: "con_spesa" }];

// Le righe della tabella Ads rappresentano SOLO le campagne tecniche
// realmente presenti nella colonna "Campagna" del foglio Ads-spesa (non le
// voci generiche del foglio Operatori come "DIV COACH", "Imprenditoria",
// "MBE SALES", che duplicherebbero il nome della categoria). I dati di
// funnel (Connessioni, Appuntamenti, Consulenze, Chiusure, Importo) restano
// comunque agganciati per nome campagna tramite CampaignSummary.
//
// Lead Generati (persone distinte per campagna) e Lead Unici (di quelle, chi era
// alla prima conversione della sua vita) arrivano da /api/campaign-conversions,
// cioe' dalla cronologia della proprieta' HubSpot id_campagna_refresh salvata
// su Postgres. Fino a settembre 2026 erano numeri finti generati da un hash del
// nome campagna: ora sono reali.
function buildCampaignAdsRows(
  spesaByCampagna: Map<string, { campagna: string; spesa: number }>,
  conversioniByCampagna: Map<string, CampaignConversionRow>,
  funnelByCampagna: Map<string, FunnelCampagna>
): CampaignAdsRow[] {
  // Le righe sono l'UNIONE di chi ha speso e di chi ha prodotto qualcosa.
  // Prima si partiva solo dal foglio Ads, quindi una campagna senza spesa nel
  // periodo spariva dalla tabella insieme ai suoi lead e alle sue connessioni:
  // sulla sola categoria DIV COACH restavano fuori 22 campagne, 6.646 lead e
  // 1.931 connessioni, e i totali non tornavano con quelli di Looker.
  //
  // Il nome mostrato e' la chiave stessa: dopo l'esclusione dei nomi non
  // conformi (vedi src/lib/campagne.ts) foglio Ads e database scrivono la
  // campagna allo stesso modo, quindi non c'e' piu' una grafia "originale" da
  // preferire.
  const nomi = new Map<string, string>();
  for (const [chiave, entry] of spesaByCampagna) {
    nomi.set(chiave, entry.campagna.trim() || "(Nessuna)");
  }
  for (const [chiave, r] of conversioniByCampagna) {
    if (!nomi.has(chiave)) nomi.set(chiave, r.campagna);
  }
  for (const chiave of funnelByCampagna.keys()) {
    if (!nomi.has(chiave)) nomi.set(chiave, chiave);
  }

  return Array.from(nomi.entries()).map(([chiave, campagna]) => {
    const conv = conversioniByCampagna.get(chiave);
    return {
      categoria: guessCategoria(campagna),
      campagna,
      spesa: spesaByCampagna.get(chiave)?.spesa ?? 0,
      // Una campagna presente nel foglio spesa ma assente fra le conversioni
      // ha davvero prodotto zero lead: non e' un dato mancante.
      leadGenerati: conv?.lead_generati ?? 0,
      leadUnici: conv?.lead_unici ?? 0
    };
  });
}

export default function CampaignsDashboard({
  operatoriRows,
  operatoriRowsOggi,
  campaigns
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  campaigns: string[];
}) {
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
  }, []);

  const defaultTo = useMemo(
    () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" }),
    []
  );

  const [filters, setFilters] = useState<Filters>(() => ({
    from: defaultFrom,
    to: defaultTo,
    variante: VARIANTE_DEFAULT
  }));

  // Le tre API raggruppano le righe lato database, quindi il valore va
  // rispedito a ogni cambio: non basta filtrare a valle.
  const variante = leggiVariante(filters.variante);

  const [adsSpendRows, setAdsSpendRows] = useState<CampaignAdsSpendRow[]>([]);
  const fetchedAdsRangeRef = useRef<{ from: string; to: string } | null>(null);

  useEffect(() => {
    const currentFrom = filters.from ?? defaultFrom;
    const currentTo = filters.to ?? defaultTo;
    const fetched = fetchedAdsRangeRef.current;
    if (fetched && currentFrom >= fetched.from && currentTo <= fetched.to) return;

    fetch(`/api/campaign-ads?from=${currentFrom}&to=${currentTo}`)
      .then((r) => r.json())
      .then((data: { rows?: CampaignAdsSpendRow[] }) => {
        setAdsSpendRows(data.rows ?? []);
        fetchedAdsRangeRef.current = { from: currentFrom, to: currentTo };
      })
      .catch(console.error);
  }, [filters.from, filters.to, defaultFrom, defaultTo]);

  // Lead reali per campagna, dalla cronologia HubSpot salvata su Postgres.
  // A differenza della spesa (che si puo' ritagliare a posteriori da un
  // intervallo piu' ampio gia' scaricato) le conversioni sono aggregate dal
  // database sull'intervallo richiesto, quindi vanno rilette a ogni cambio di
  // date.
  const [conversioni, setConversioni] = useState<CampaignConversionRow[]>([]);
  // null = non ancora caricato, true = il caricamento e' fallito. Serve a non
  // spacciare per "zero lead" un errore di rete o un database irraggiungibile.
  const [conversioniErrore, setConversioniErrore] = useState<boolean | null>(null);

  useEffect(() => {
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? defaultTo;
    let annullato = false;

    fetch(`/api/campaign-conversions?from=${from}&to=${to}&variante=${variante}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { righe?: CampaignConversionRow[] }) => {
        if (annullato) return;
        setConversioni(data.righe ?? []);
        setConversioniErrore(false);
      })
      .catch((err) => {
        if (annullato) return;
        console.error("[campaign-conversions]", err);
        setConversioni([]);
        setConversioniErrore(true);
      });

    return () => {
      annullato = true;
    };
  }, [filters.from, filters.to, variante, defaultFrom, defaultTo]);

  const conversioniByCampagna = useMemo(() => {
    const map = new Map<string, CampaignConversionRow>();
    for (const r of conversioni) map.set(normKey(r.campagna), r);
    return map;
  }, [conversioni]);

  // Appuntamenti, Chiusure e Importo dalle STESSE fonti della pagina Advisor:
  // gli endpoint restituiscono i record grezzi, che li' vengono raggruppati per
  // operatore e qui per campagna (id_campagna_track). Stessi record e stesse
  // regole, quindi i totali delle due pagine si riconciliano.
  //
  // Il foglio Operatori non puo' servire allo scopo: la sua colonna "Campagna"
  // contiene 9 categorie (DIV COACH, REM, MEP...), non i nomi tecnici delle
  // campagne, quindi l'aggancio per nome falliva su ogni riga e queste colonne
  // erano sempre a zero.
  const [dealRecords, setDealRecords] = useState<RawDealRecord[] | null>(null);
  const [boomRecords, setBoomRecords] = useState<RawBoomRecord[] | null>(null);
  const [hubspotErrore, setHubspotErrore] = useState(false);

  // Consulenze svolte, precalcolate su Postgres dal sync delle trattative: la
  // data della consulenza non e' ricavabile dallo stato attuale, va ricostruita
  // dalla cronologia delle fasi.
  const [consulenze, setConsulenze] = useState<CampaignTrattativeRow[]>([]);
  const [consulenzeErrore, setConsulenzeErrore] = useState(false);

  // Chiamate e Connessioni, anch'esse precalcolate: la campagna di una
  // telefonata e' quella che il contatto aveva in quel momento, e ricavarla in
  // lettura vorrebbe dire scandagliare 740.000 eventi a ogni caricamento.
  const [chiamate, setChiamate] = useState<CampaignChiamateRow[]>([]);
  const [chiamateErrore, setChiamateErrore] = useState(false);

  useEffect(() => {
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? defaultTo;
    let annullato = false;

    fetch(`/api/campaign-chiamate?from=${from}&to=${to}&variante=${variante}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { righe?: CampaignChiamateRow[] }) => {
        if (annullato) return;
        setChiamate(data.righe ?? []);
        setChiamateErrore(false);
      })
      .catch((err) => {
        if (annullato) return;
        console.error("[campaign-chiamate]", err);
        setChiamate([]);
        setChiamateErrore(true);
      });

    return () => {
      annullato = true;
    };
  }, [filters.from, filters.to, variante, defaultFrom, defaultTo]);

  useEffect(() => {
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? defaultTo;
    let annullato = false;

    fetch(`/api/campaign-trattative?from=${from}&to=${to}&variante=${variante}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { righe?: CampaignTrattativeRow[] }) => {
        if (annullato) return;
        setConsulenze(data.righe ?? []);
        setConsulenzeErrore(false);
      })
      .catch((err) => {
        if (annullato) return;
        console.error("[campaign-trattative]", err);
        setConsulenze([]);
        setConsulenzeErrore(true);
      });

    return () => {
      annullato = true;
    };
  }, [filters.from, filters.to, variante, defaultFrom, defaultTo]);

  useEffect(() => {
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? defaultTo;
    let annullato = false;

    const leggi = async () => {
      try {
        const [d, b] = await Promise.all([
          fetch(`/api/hubspot-deals?from=${from}&to=${to}`).then((r) =>
            r.ok ? r.json() : Promise.reject(new Error(`deals HTTP ${r.status}`))
          ),
          fetch(`/api/hubspot-data?from=${from}&to=${to}`).then((r) =>
            r.ok ? r.json() : Promise.reject(new Error(`incassi HTTP ${r.status}`))
          )
        ]);
        if (annullato) return;
        setDealRecords(d.dealRecords ?? []);
        setBoomRecords(b.boomRecords ?? []);
        setHubspotErrore(false);
      } catch (err) {
        if (annullato) return;
        console.error("[campagne/hubspot]", err);
        setDealRecords([]);
        setBoomRecords([]);
        setHubspotErrore(true);
      }
    };
    leggi();

    return () => {
      annullato = true;
    };
  }, [filters.from, filters.to, defaultFrom, defaultTo]);

  const funnelByCampagna = useMemo(() => {
    const map = new Map<string, FunnelCampagna>();
    // null = la campagna non va mostrata: nome non conforme, oppure fuori dalla
    // variante scelta.
    const prendi = (campagna: string): FunnelCampagna | null => {
      const k = chiaveCampagna(campagna, variante);
      if (!k) return null;
      const cur = map.get(k) ?? { appuntamenti: 0, chiusure: 0, importo: 0, consulenze: 0, noShow: 0, chiamate: 0, connessioni: 0 };
      map.set(k, cur);
      return cur;
    };

    for (const r of dealRecords ?? []) {
      if (!r.id_campagna_track?.trim()) continue;
      const cur = prendi(r.id_campagna_track);
      if (cur) cur.appuntamenti += 1;
    }
    for (const r of boomRecords ?? []) {
      if (!r.id_campagna_track?.trim()) continue;
      const cur = prendi(r.id_campagna_track);
      if (!cur) continue;
      if (CHIUSURE_TIPOLOGIE.has(r.tipologia_di_incasso)) cur.chiusure += 1;
      if (BOOM_TIPOLOGIE.has(r.tipologia_di_incasso)) cur.importo += r.importo;
    }
    // Si SOMMA invece di assegnare: se due righe finissero sulla stessa chiave
    // normalizzata, assegnare farebbe vincere l'ultima e perdere l'altra. Le
    // query aggregano gia' per nome normalizzato, questa e' una rete di
    // sicurezza sul lato che non controlliamo (i nomi del foglio Ads).
    for (const r of consulenze) {
      const cur = prendi(r.campagna);
      if (!cur) continue;
      cur.consulenze += r.consulenze;
      cur.noShow += r.no_show;
    }
    for (const r of chiamate) {
      const cur = prendi(r.campagna);
      if (!cur) continue;
      cur.chiamate += r.chiamate;
      cur.connessioni += r.connessioni;
    }
    return map;
  }, [dealRecords, boomRecords, consulenze, chiamate, variante]);

  // Il filtro "Campagna" di questa pagina mostra le Categorie (dedotte dalle
  // campagne tecniche realmente presenti nel foglio Ads-spesa per il periodo
  // caricato), non i singoli nomi di campagna e non le voci generiche del
  // foglio Operatori (es. "MBE SALES", "DIV COACH", "Nessuna").
  const categoriaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of adsSpendRows) {
      const c = r.campagna.trim();
      if (c && nomeConforme(c)) set.add(guessCategoria(c));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [adsSpendRows]);

  const spesaByCampagna = useMemo(() => {
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? defaultTo;
    const map = new Map<string, { campagna: string; spesa: number }>();
    for (const r of adsSpendRows) {
      if (from && r.data && r.data < from) continue;
      if (to && r.data && r.data > to) continue;
      // La spesa senza nome campagna resta visibile sotto "(Nessuna)": quello
      // non e' un nome non conforme, e' un nome assente, e scartarla
      // toglierebbe euro veri dal totale della pagina.
      //
      // Nel foglio Ads il marcatore non compare mai: le varianti instant non
      // hanno un budget proprio. Con la vista "instant" la tabella mostra
      // quindi righe senza spesa, ed e' corretto cosi'.
      const key = r.campagna.trim() ? chiaveCampagna(r.campagna, variante) : "__nessuna__";
      if (!key) continue;
      const cur = map.get(key) ?? { campagna: key, spesa: 0 };
      cur.spesa += r.spesa;
      map.set(key, cur);
    }
    return map;
  }, [adsSpendRows, filters.from, filters.to, variante, defaultFrom, defaultTo]);

  const todayIsoRome = useMemo(
    () =>
      new Date().toLocaleDateString("en-CA", {
        timeZone: "Europe/Rome"
      }),
    []
  );

  const includeToday = useMemo(() => {
    const from = filters.from ?? "";
    const to = filters.to ?? "";
    if (!todayIsoRome) return false;
    if (from && from > todayIsoRome) return false;
    if (to && to < todayIsoRome) return false;
    return true;
  }, [filters.from, filters.to, todayIsoRome]);

  const operatoriRowsWithToday = useMemo(
    () => (includeToday ? [...operatoriRows, ...operatoriRowsOggi] : operatoriRows),
    [includeToday, operatoriRows, operatoriRowsOggi]
  );

  const operatoriFiltered = useMemo(() => {
    // filters.campagna qui contiene una Categoria (non un nome di campagna
    // tecnico): applichiamo gli altri filtri normalmente e poi filtriamo per
    // categoria dedotta dal campo "Campagna" di ogni riga.
    const { campagna: categoriaFilter, ...restFilters } = filters;
    const base = applyFilters(operatoriRowsWithToday, restFilters);
    if (!categoriaFilter) return base;
    return base.filter((r) => guessCategoria(getString(r, "Campagna")) === categoriaFilter);
  }, [operatoriRowsWithToday, filters]);

  const operatoriNorm = useMemo(() => normalizeOperatori(operatoriFiltered), [operatoriFiltered]);

  const campaignSummaryFull = useMemo(() => aggregateByCampagna(operatoriNorm), [operatoriNorm]);

  const campaignSummary = useMemo(() => campaignSummaryFull.slice(0, 12), [campaignSummaryFull]);

  const campaignAdsRows = useMemo(() => {
    let rows = buildCampaignAdsRows(spesaByCampagna, conversioniByCampagna, funnelByCampagna);
    if (filters.tipologia === "con_spesa") rows = rows.filter((r) => r.spesa > 0);
    if (filters.campagna) rows = rows.filter((r) => r.categoria === filters.campagna);
    return rows;
  }, [spesaByCampagna, conversioniByCampagna, funnelByCampagna, filters.campagna, filters.tipologia]);

  const campaignAnomalies = useMemo(() => {
    const toMs = (iso: string) => new Date(iso).getTime();
    const maxDateIso = operatoriNorm.reduce<string | null>(
      (acc, r) => (!acc || r.data > acc ? r.data : acc),
      null
    );
    if (!maxDateIso) return [];

    const endMs = toMs(maxDateIso);
    const dayMs = 24 * 60 * 60 * 1000;
    const recentDays = 7;
    const baselineDays = 90;
    const recentStartMs = endMs - (recentDays - 1) * dayMs;
    const baselineEndMs = recentStartMs - dayMs;
    const baselineStartMs = baselineEndMs - (baselineDays - 1) * dayMs;

    type Agg = { ass: number; app: number };
    const recentByCamp = new Map<string, Agg>();
    const baselineByCamp = new Map<string, Agg>();

    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t)) continue;
      if (t >= recentStartMs && t <= endMs) {
        const cur = recentByCamp.get(r.campagna) ?? { ass: 0, app: 0 };
        cur.ass += r.assegnati; cur.app += r.appuntamenti;
        recentByCamp.set(r.campagna, cur);
      } else if (t >= baselineStartMs && t <= baselineEndMs) {
        const cur = baselineByCamp.get(r.campagna) ?? { ass: 0, app: 0 };
        cur.ass += r.assegnati; cur.app += r.appuntamenti;
        baselineByCamp.set(r.campagna, cur);
      }
    }

    const campaignSet = new Set(
      (campaigns ?? []).map((c) => c.trim()).filter((c) => c && c.toLowerCase() !== "nessuna")
    );
    const campaignKeys = campaignSet.size > 0
      ? Array.from(campaignSet)
      : Array.from(new Set<string>([...Array.from(recentByCamp.keys()), ...Array.from(baselineByCamp.keys())]));

    return campaignKeys
      .map((campagna) => {
        const recent = recentByCamp.get(campagna) ?? { ass: 0, app: 0 };
        const baseline = baselineByCamp.get(campagna) ?? { ass: 0, app: 0 };
        const recentRate = recent.ass > 0 ? recent.app / recent.ass : 0;
        const baselineRate = baseline.ass > 0 ? baseline.app / baseline.ass : 0;
        return { campagna, recentRate, baselineRate, delta: recentRate - baselineRate };
      })
      .sort((a, b) => {
        const aAltro = a.campagna.trim().toLowerCase() === "altro";
        const bAltro = b.campagna.trim().toLowerCase() === "altro";
        if (aAltro && !bAltro) return 1;
        if (!aAltro && bAltro) return -1;
        return a.delta - b.delta;
      });
  }, [operatoriNorm, campaigns]);

  const campaignPeaks = useMemo(() => {
    const toMs = (iso: string) => new Date(iso).getTime();
    const maxDateIso = operatoriNorm.reduce<string | null>(
      (acc, r) => (!acc || r.data > acc ? r.data : acc),
      null
    );
    if (!maxDateIso) return { campaigns: [] as string[], data: [] as CampaignPeaksDatum[] };

    const endMs = toMs(maxDateIso);
    const dayMs = 24 * 60 * 60 * 1000;
    const startMs = endMs - 59 * dayMs;

    const assByCamp = new Map<string, number>();
    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;
      assByCamp.set(r.campagna, (assByCamp.get(r.campagna) ?? 0) + r.assegnati);
    }

    const peakCampaigns = campaignAnomalies
      .map((r) => r.campagna)
      .filter((c) => (assByCamp.get(c) ?? 0) > 0);
    if (peakCampaigns.length === 0) return { campaigns: [] as string[], data: [] as CampaignPeaksDatum[] };

    type Agg = { ass: number; app: number };
    const byDay = new Map<string, Map<string, Agg>>();
    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data || !peakCampaigns.includes(r.campagna)) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;
      const dayMap = byDay.get(r.data) ?? new Map<string, Agg>();
      const cur = dayMap.get(r.campagna) ?? { ass: 0, app: 0 };
      cur.ass += r.assegnati; cur.app += r.appuntamenti;
      dayMap.set(r.campagna, cur);
      byDay.set(r.data, dayMap);
    }

    const data: CampaignPeaksDatum[] = Array.from(byDay.keys())
      .sort((a, b) => toMs(a) - toMs(b))
      .map((date) => {
        const dayMap = byDay.get(date) ?? new Map<string, Agg>();
        const row: CampaignPeaksDatum = { date };
        for (const c of peakCampaigns) {
          const agg = dayMap.get(c);
          row[c] = agg && agg.ass > 0 ? agg.app / agg.ass : null;
        }
        return row;
      });

    return { campaigns: peakCampaigns, data };
  }, [operatoriNorm, campaignAnomalies]);

  const [focusedPeaksCampaign, setFocusedPeaksCampaign] = useState<string | null>(null);

  const lowestDeltaCampaign = useMemo(() => {
    if (campaignAnomalies.length === 0) return null;
    return campaignAnomalies.reduce<string | null>((acc, r) => {
      if (!acc) return r.campagna;
      const prev = campaignAnomalies.find((x) => x.campagna === acc);
      if (!prev) return r.campagna;
      return r.delta < prev.delta ? r.campagna : acc;
    }, null);
  }, [campaignAnomalies]);

  const peaksVisibleCampaigns = useMemo(() => {
    if (focusedPeaksCampaign) return [focusedPeaksCampaign];
    if (lowestDeltaCampaign) return [lowestDeltaCampaign];
    return [] as string[];
  }, [focusedPeaksCampaign, lowestDeltaCampaign]);

  useEffect(() => {
    if (!lowestDeltaCampaign) return;
    if (!focusedPeaksCampaign) { setFocusedPeaksCampaign(lowestDeltaCampaign); return; }
    const stillExists = campaignAnomalies.some((r) => r.campagna === focusedPeaksCampaign);
    if (!stillExists) setFocusedPeaksCampaign(lowestDeltaCampaign);
  }, [campaignAnomalies, focusedPeaksCampaign, lowestDeltaCampaign]);

  const insightsTableHeightPx = useMemo(() => {
    const rows = Math.max(1, campaignAnomalies.length);
    return Math.max(260, 32 + rows * 40);
  }, [campaignAnomalies.length]);

  const baselineRateByCampaign = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of campaignAnomalies) out[r.campagna] = r.baselineRate;
    return out;
  }, [campaignAnomalies]);

  return (
    <div>
      <div id="filtri" className="w-full scroll-mt-6">
        <FiltersBar
          filters={filters}
          setFilters={setFilters}
          campaigns={categoriaOptions}
          tipologie={TIPOLOGIE}
          varianti={VARIANTI}
        />
      </div>

      {conversioniErrore || hubspotErrore || consulenzeErrore || chiamateErrore ? (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Dati non disponibili.</strong>{" "}
          {conversioniErrore ? "Lead Generati e Lead Unici" : null}
          {conversioniErrore && hubspotErrore ? ", " : null}
          {hubspotErrore ? "Appuntamenti, Chiusure e Importo" : null}
          {hubspotErrore && consulenzeErrore ? ", " : null}
          {consulenzeErrore ? "Consulenze" : null}
          {consulenzeErrore && chiamateErrore ? ", " : null}
          {chiamateErrore ? "Connessioni" : null} mostrano zero
          perche' la fonte non e' raggiungibile, non perche' le campagne non abbiano
          prodotto risultati. Le altre colonne restano valide.
        </div>
      ) : null}

      <Card className="mt-6">
        <CampaignAdsTable adsRows={campaignAdsRows} campaignSummary={campaignSummaryFull} funnelByCampagna={funnelByCampagna} />
      </Card>

      <div id="campagne" className="scroll-mt-6">
        <SectionTitle className="mt-10">KPI Campagne</SectionTitle>
      </div>
      <Card>
        <ChartTitle
          title="KPI Campagne"
          description="Confronto per campagna su assegnati, connessioni, appuntamenti, no show e show up."
        />
        <div className="mt-4 h-[340px]">
          <CampaignSummaryBar data={campaignSummary} />
        </div>
      </Card>

      <div id="insights" className="scroll-mt-6">
        <SectionTitle className="mt-10">Insights</SectionTitle>
      </div>
      <div
        className="mt-6 overflow-hidden rounded-md bg-white ring-1 ring-slate-200"
        style={{ height: insightsTableHeightPx }}
      >
        <div className="grid grid-cols-12 gap-x-4 border-b border-slate-700 bg-[#64748b] px-4 py-2 text-[13px] font-semibold text-white">
          <div className="col-span-4 whitespace-nowrap">Campagna</div>
          <div className="col-span-3 whitespace-nowrap text-center">Conversione 7g</div>
          <div className="col-span-3 whitespace-nowrap text-center">Conversione 90g</div>
          <div className="col-span-2 whitespace-nowrap text-center text-[17px]">Δ</div>
        </div>
        <div className="divide-y divide-slate-200">
          {campaignAnomalies.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">Nessuna anomalia disponibile.</div>
          ) : (
            campaignAnomalies.map((row) => {
              const delta = row.delta;
              const sign = delta >= 0 ? "+" : "";
              const deltaColor = delta < 0 ? "text-rose-700" : "text-emerald-700";
              const isFocused = focusedPeaksCampaign === row.campagna;
              return (
                <div
                  key={row.campagna}
                  className={`grid grid-cols-12 gap-x-4 px-4 py-2 text-sm ${isFocused ? "bg-slate-50" : "bg-white"}`}
                >
                  <button
                    type="button"
                    onClick={() => setFocusedPeaksCampaign(row.campagna)}
                    className="col-span-4 truncate text-left font-medium text-slate-900 hover:underline"
                    title={row.campagna}
                  >
                    {row.campagna}
                  </button>
                  <div className="col-span-3 text-center text-slate-700">{formatPct(row.recentRate, 1)}</div>
                  <div className="col-span-3 text-center text-slate-700">{formatPct(row.baselineRate, 1)}</div>
                  <div className={`col-span-2 text-center font-semibold ${deltaColor}`}>
                    {sign}{formatPct(delta, 1)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Card className="mt-6">
        <div className="h-[360px]">
          <CampaignConversionPeaksChart
            data={campaignPeaks.data}
            campaigns={campaignPeaks.campaigns}
            baselineByCampaign={baselineRateByCampaign}
            visibleCampaigns={peaksVisibleCampaigns}
          />
        </div>
      </Card>
    </div>
  );
}
