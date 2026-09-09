"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { applyFilters, computeKpis, type Filters } from "@/lib/metrics";
import {
  aggregateByCampagna,
  aggregateByOperatore,
  normalizeOperatori
} from "@/lib/analytics";
import { formatFloat, formatInt, formatPct, formatEur } from "@/lib/format";
import { PERIODO_DEFAULT, periodoScelto } from "@/lib/periodi";
import { FiltersBar } from "@/components/Filters";
import SectionTitle from "@/components/ui/SectionTitle";
import KPICard from "@/components/ui/KPICard";
import Card from "@/components/ui/Card";
import ChartTitle from "@/components/ui/ChartTitle";
import FunnelStagesChart from "@/components/charts/FunnelStagesChart";
import ReactivityGauge from "@/components/charts/ReactivityGauge";
import AndamentoChart, { formattaValore } from "@/components/charts/AndamentoChart";
import AgendaGiornaliera from "@/components/charts/AgendaGiornaliera";
import type { EventoAgenda } from "@/app/api/advisor-agenda/route";
import { chiaveNome } from "@/lib/nomi";
import {
  costruisciSerie,
  etichettaMese,
  METRICA_ADVISOR_DEFAULT,
  mesiDi,
  metricaAdvisor,
  metricheAdvisor,
  righeAdvisor,
  unisciAdvisor
} from "@/lib/andamento";
import type { AdvisorAndamentoRow } from "@/app/api/advisor-andamento/route";
import CampaignSummaryBar from "@/components/charts/CampaignSummaryBar";
import CampaignConversionPeaksChart from "@/components/charts/CampaignConversionPeaksChart";
import OperatorStatsTable from "@/components/charts/OperatorStatsTable";
import type { RawBoomRecord, RawDealRecord } from "@/app/api/hubspot-data/route";
import { CHIUSURE_TIPOLOGIE, BOOM_TIPOLOGIE } from "@/lib/hubspotRegole";


type CampaignPeaksDatum = {
  date: string;
  [campaign: string]: string | number | null;
};

export default function DashboardEnterprise({
  operatoriRows,
  operatoriRowsOggi,
  operators,
  campaigns,
  hideCampagne,
  hideInsights,
  hideOperatorTable,
  useHubspot,
  operatorLabel,
  operatoriAmmessi,
}: {
  operatoriRows: CsvRow[];
  operatoriRowsOggi: CsvRow[];
  operators: string[];
  campaigns: string[];
  hideCampagne?: boolean;
  hideInsights?: boolean;
  hideOperatorTable?: boolean;
  useHubspot?: boolean;
  operatorLabel?: string;
  /** Chi ha Team Principale "Advisor" fra gli utenti HubSpot, come chiave di
   *  nome. Null = elenco non disponibile, e allora non si filtra niente. */
  operatoriAmmessi?: string[] | null;
}) {
  // Le pagine si aprono sul mese in corso. Le date arrivano dal periodo
  // predefinito invece di essere ricalcolate qui: erano scritte due volte, in
  // questa pagina e nell'altra, e sommavano il giorno sull'ora locale del
  // browser mentre lo leggevano sul fuso di Roma.
  const periodoIniziale = useMemo(() => periodoScelto(PERIODO_DEFAULT), []);
  const defaultFrom = periodoIniziale.from;
  const defaultTo = periodoIniziale.to;

  const [filters, setFilters] = useState<Filters>(() => ({
    periodo: PERIODO_DEFAULT,
    from: defaultFrom,
    to: defaultTo
  }));

  const [boomLoading, setBoomLoading] = useState<boolean>(!!useHubspot);
  const [dealsLoading, setDealsLoading] = useState<boolean>(!!useHubspot);
  const [vendite, setVendite] = useState<Array<{ label: string; value: string }>>([]);
  const [rawBoomRecords, setRawBoomRecords] = useState<RawBoomRecord[]>([]);
  const [rawDealRecords, setRawDealRecords] = useState<RawDealRecord[] | null>(null);
  const fetchedRangeRef = useRef<{ from: string; to: string } | null>(null);

  const todayIsoRome = useMemo(
    () =>
      new Date().toLocaleDateString("en-CA", {
        timeZone: "Europe/Rome"
      }),
    []
  );

  useEffect(() => {
    if (!useHubspot) return;
    fetch("/api/hubspot-boom-options")
      .then((r) => r.json())
      .then((data: { vendite?: Array<{ label: string; value: string }> }) => {
        setVendite(data.vendite ?? []);
      })
      .catch(console.error);
  }, [useHubspot]);

  useEffect(() => {
    if (!useHubspot) return;
    const currentFrom = filters.from ?? defaultFrom;
    const currentTo = filters.to ?? defaultTo;
    const fetched = fetchedRangeRef.current;
    if (fetched && currentFrom >= fetched.from && currentTo <= fetched.to) return;

    setDealsLoading(true);
    setBoomLoading(true);

    fetch(`/api/hubspot-deals?from=${currentFrom}&to=${currentTo}`)
      .then((r) => r.json())
      .then((data: { dealRecords?: RawDealRecord[]; error?: string }) => {
        if (data.error) { console.error("[hubspot-deals]", data.error); return; }
        setRawDealRecords(data.dealRecords ?? []);
      })
      .catch(console.error)
      .finally(() => {
        setDealsLoading(false);
        setTimeout(() => {
          fetch(`/api/hubspot-data?from=${currentFrom}&to=${currentTo}`)
            .then((r) => r.json())
            .then((data: { boomRecords?: RawBoomRecord[] }) => {
              setRawBoomRecords(data.boomRecords ?? []);
              fetchedRangeRef.current = { from: currentFrom, to: currentTo };
            })
            .catch(console.error)
            .finally(() => setBoomLoading(false));
        }, 1000);
      });
  }, [useHubspot, filters.from, filters.to, defaultFrom, defaultTo]);

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

  const operatoriFiltered = useMemo(
    () => applyFilters(operatoriRowsWithToday, filters),
    [operatoriRowsWithToday, filters]
  );

  const kpis = useMemo(
    () => computeKpis(operatoriFiltered),
    [operatoriFiltered]
  );

  const operatoriNorm = useMemo(
    () => normalizeOperatori(operatoriFiltered),
    [operatoriFiltered]
  );

  const operatorSummaryAll = useMemo(
    () => aggregateByOperatore(operatoriNorm),
    [operatoriNorm]
  );

  // L'AGENDA DEL GIORNO.
  //
  // Non segue il filtro Periodo, che e' un intervallo mentre un'agenda mostra un
  // giorno: ha un suo selettore, e parte da oggi.
  const oggiRoma = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
  const [giornoAgenda, setGiornoAgenda] = useState<string>(oggiRoma);
  const [eventiAgenda, setEventiAgenda] = useState<EventoAgenda[]>([]);
  const [agendaInCorso, setAgendaInCorso] = useState(true);
  const [agendaFallita, setAgendaFallita] = useState(false);
  const [agendaLetta, setAgendaLetta] = useState("");

  useEffect(() => {
    let annullato = false;
    setAgendaInCorso(true);
    fetch(`/api/advisor-agenda?giorno=${giornoAgenda}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { eventi?: EventoAgenda[] }) => {
        if (annullato) return;
        setEventiAgenda(d.eventi ?? []);
        setAgendaFallita(false);
        setAgendaInCorso(false);
        setAgendaLetta(
          new Date().toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" })
        );
      })
      .catch((err) => {
        console.error("[advisor-agenda]", err);
        if (annullato) return;
        setEventiAgenda([]);
        setAgendaFallita(true);
        setAgendaInCorso(false);
      });
    return () => {
      annullato = true;
    };
  }, [giornoAgenda]);

  // LE COLONNE SONO TUTTI GLI ADVISOR, sempre le stesse.
  //
  // Non le persone della tabella, che dipendono dal periodo scelto: l'agenda di
  // oggi non deve cambiare elenco perche' si e' guardato un altro mese. E in
  // ordine alfabetico, non nell'ordine della tabella, che si puo' riordinare
  // con un click e quindi non sta fermo: qui l'ordine deve essere quello in cui
  // si cerca un nome.
  //
  // Lo stesso elenco fa da filtro: l'agenda legge i meeting di tutto il
  // portale, e fra i proprietari c'e' anche chi advisor non e'.
  const ammessi = useMemo(
    () => (operatoriAmmessi ? new Set(operatoriAmmessi.map(chiaveNome)) : null),
    [operatoriAmmessi]
  );
  const eventiAmmessi = useMemo(
    () => (ammessi ? eventiAgenda.filter((e) => ammessi.has(chiaveNome(e.operatore))) : eventiAgenda),
    [eventiAgenda, ammessi]
  );
  const personeAmmesse = useMemo(
    () =>
      operatoriAmmessi
        ? [...operatoriAmmessi].sort((a, b) => a.localeCompare(b, "it"))
        : Array.from(new Set(operatorSummaryAll.map((r) => r.operatore).filter(Boolean))).sort((a, b) =>
            a.localeCompare(b, "it")
          ),
    [operatoriAmmessi, operatorSummaryAll]
  );

  // L'ANDAMENTO DELLE PERSONE, mese per mese.
  //
  // NON SEGUE IL FILTRO PERIODO, ed e' voluto: e' una serie storica, e
  // guardarla dentro la finestra scelta la ridurrebbe a un punto solo. Gli
  // altri filtri li segue tutti, perche' agiscono sulle righe del foglio.
  const setterView = (operatorLabel ?? "Advisor") === "Setter";
  const [metricaScelta, setMetricaScelta] = useState<string>(METRICA_ADVISOR_DEFAULT);

  const daFoglio = useMemo(() => {
    const { from: _da, to: _a, ...senzaPeriodo } = filters;
    return righeAdvisor(normalizeOperatori(applyFilters(operatoriRowsWithToday, senzaPeriodo)));
  }, [operatoriRowsWithToday, filters]);

  // La finestra da chiedere a HubSpot e' quella del foglio, non una lunghezza
  // decisa a caso: le due fonti devono coprire gli stessi mesi, o il grafico
  // avrebbe colonne dove meta' delle linee non esistono. Si calcola sulle righe
  // NON filtrate, se no cambierebbe a ogni tocco dei filtri e rifarebbe la
  // lettura di HubSpot da capo.
  const finestraStorica = useMemo(() => {
    const mesi = mesiDi(righeAdvisor(normalizeOperatori(operatoriRowsWithToday)));
    if (!mesi.length) return null;
    return {
      from: `${mesi[0]}-01`,
      to: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })
    };
  }, [operatoriRowsWithToday]);

  // null = ancora in corso. Appuntamenti, chiusure e incassi arrivano da qui e
  // non dal foglio, per le stesse ragioni per cui li' sopra la tabella li
  // sostituisce: vedi unisciAdvisor.
  const [daHubspot, setDaHubspot] = useState<AdvisorAndamentoRow[] | null>(null);
  const [hubspotFallito, setHubspotFallito] = useState(false);

  useEffect(() => {
    if (!finestraStorica) return;
    let annullato = false;
    fetch(`/api/advisor-andamento?from=${finestraStorica.from}&to=${finestraStorica.to}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { righe?: AdvisorAndamentoRow[] }) => {
        if (annullato) return;
        setDaHubspot(d.righe ?? []);
      })
      .catch((err) => {
        console.error("[advisor-andamento]", err);
        if (annullato) return;
        setDaHubspot([]);
        setHubspotFallito(true);
      });
    return () => {
      annullato = true;
    };
  }, [finestraStorica]);

  const conHubspot = daHubspot !== null && !hubspotFallito;

  // Se HubSpot non ha risposto si resta sulle righe del foglio: unire un elenco
  // vuoto azzererebbe gli appuntamenti di tutti, che e' peggio di un numero che
  // non coincide con la tabella.
  const andamentoPersone = useMemo(
    () => (conHubspot && daHubspot ? unisciAdvisor(daFoglio, daHubspot) : daFoglio),
    [daFoglio, daHubspot, conHubspot]
  );

  const vista = useMemo(() => {
    const m = metricaAdvisor(metricaScelta, setterView, conHubspot);
    const mesi = mesiDi(andamentoPersone);
    const { serie, anomalie } = costruisciSerie(andamentoPersone, mesi, m);
    return {
      m,
      mesi,
      serie,
      anomalie,
      chiavi: new Set(anomalie.map((a) => `${a.gruppo}|${a.mese}`))
    };
  }, [andamentoPersone, metricaScelta, setterView, conHubspot]);

  const hubspotOverrides = useMemo((): Record<string, { chiusure: number; boom: number }> => {
    if (!useHubspot || rawBoomRecords.length === 0) return {};
    const fromMs = new Date(filters.from ?? defaultFrom).getTime();
    const toMs = new Date((filters.to ?? defaultTo) + "T23:59:59.999Z").getTime();
    const agg: Record<string, { chiusure: number; boom: number }> = {};
    for (const r of rawBoomRecords) {
      if (r.data_di_pagamento_ms < fromMs || r.data_di_pagamento_ms > toMs) continue;
      if (filters.campagna) {
        const normalized = filters.campagna.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        if (normalized && !r.id_campagna_track.toLowerCase().includes(normalized)) continue;
      }
      if (filters.vendita && r.tipo_di_vendita.trim().toLowerCase() !== filters.vendita.trim().toLowerCase()) continue;
      if (filters.prodotto && r.prodotto !== filters.prodotto) continue;
      const key = r.operatore.trim().toLowerCase().replace(/\s+/g, " ");
      const cur = agg[key] ?? { chiusure: 0, boom: 0 };
      if (CHIUSURE_TIPOLOGIE.has(r.tipologia_di_incasso)) cur.chiusure += 1;
      if (BOOM_TIPOLOGIE.has(r.tipologia_di_incasso)) cur.boom += r.importo;
      agg[key] = cur;
    }
    return agg;
  }, [useHubspot, rawBoomRecords, filters, defaultFrom, defaultTo]);

  const trattativeOverrides = useMemo((): Record<string, number> | null => {
    if (!useHubspot || rawDealRecords === null) return null;
    const fromMs = new Date(filters.from ?? defaultFrom).getTime();
    const toMs = new Date((filters.to ?? defaultTo) + "T23:59:59.999Z").getTime();
    const agg: Record<string, number> = {};
    for (const r of rawDealRecords) {
      if (r.createdate_ms < fromMs || r.createdate_ms > toMs) continue;
      if (filters.campagna) {
        const normalized = filters.campagna.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        if (normalized && !r.id_campagna_track.toLowerCase().includes(normalized)) continue;
      }
      const keyD = r.operatore.trim().toLowerCase().replace(/\s+/g, " ");
      agg[keyD] = (agg[keyD] ?? 0) + 1;
    }
    return agg;
  }, [useHubspot, rawDealRecords, filters, defaultFrom, defaultTo]);

  const prodotti = useMemo((): Array<{ label: string; value: string }> => {
    if (!useHubspot || rawBoomRecords.length === 0) return [];
    const fromMs = new Date(filters.from ?? defaultFrom).getTime();
    const toMs = new Date((filters.to ?? defaultTo) + "T23:59:59.999Z").getTime();
    const values = new Set<string>();
    for (const r of rawBoomRecords) {
      if (r.data_di_pagamento_ms < fromMs || r.data_di_pagamento_ms > toMs) continue;
      if (r.prodotto) values.add(r.prodotto);
    }
    return [...values].sort().map((v) => ({ label: v, value: v }));
  }, [useHubspot, rawBoomRecords, filters.from, filters.to, defaultFrom, defaultTo]);

  const hubspotTotals = useMemo(() => {
    if (!useHubspot) return null;
    let chiusure = 0;
    let boom = 0;
    const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    for (const r of operatorSummaryAll) {
      chiusure += hubspotOverrides[normKey(r.operatore)]?.chiusure ?? 0;
      boom += hubspotOverrides[normKey(r.operatore)]?.boom ?? 0;
    }
    return { chiusure, boom };
  }, [useHubspot, hubspotOverrides, operatorSummaryAll]);

  const campaignSummary = useMemo(
    () => aggregateByCampagna(operatoriNorm).slice(0, 12),
    [operatoriNorm]
  );

  const effContatto = useMemo(
    () => (kpis.chiamate ? kpis.connessioni / kpis.chiamate : 0),
    [kpis]
  );
  const convApp = useMemo(
    () => (kpis.connessioni ? kpis.appuntamenti / kpis.connessioni : 0),
    [kpis]
  );
  const noShowPct = useMemo(
    () => (kpis.appuntamenti ? kpis.noShow / kpis.appuntamenti : 0),
    [kpis]
  );

  const reactivityPct = useMemo(() => {
    if (kpis.chiamate === 0) return 0;
    return Math.max(0, Math.min(100, 100 * (1 - kpis.reattivitaMediaMin / 300)));
  }, [kpis.chiamate, kpis.reattivitaMediaMin]);

  const funnelStages = useMemo(
    () => [
      { label: "Assegnati", value: kpis.assegnati, color: "#0ea5e9" },
      { label: "Chiamate", value: kpis.chiamate, color: "#64748b" },
      { label: "Conn.", value: kpis.connessioni, color: "#22c55e" },
      { label: "App.", value: kpis.appuntamenti, color: "#a855f7" }
    ],
    [kpis]
  );

  const leadStatusStages = useMemo(() => {
    const totals = operatoriNorm.reduce(
      (acc, r) => {
        acc.nuovi += r.nuovi;
        acc.nonRisposti += r.nonRisposti;
        acc.interesseFuturo += r.interesseFuturo;
        acc.semina += r.semina;
        acc.daRichiamare += r.daRichiamare;
        acc.bin += r.bin;
        acc.appuntamenti += r.appuntamenti;
        acc.noShow += r.noShow;
        return acc;
      },
      {
        nuovi: 0,
        nonRisposti: 0,
        interesseFuturo: 0,
        semina: 0,
        daRichiamare: 0,
        bin: 0,
        appuntamenti: 0,
        noShow: 0
      }
    );

    const total =
      totals.nuovi +
      totals.nonRisposti +
      totals.interesseFuturo +
      totals.semina +
      totals.daRichiamare +
      totals.bin +
      totals.appuntamenti +
      totals.noShow;

    const toPct = (n: number) => (total > 0 ? n / total : 0);

    return [
      { label: "Nuovi", value: toPct(totals.nuovi), color: "#0ea5e9" },
      { label: "Non\u00A0Risposti", value: toPct(totals.nonRisposti), color: "#64748b" },
      { label: "Interesse\u00A0Futuro", value: toPct(totals.interesseFuturo), color: "#a855f7" },
      { label: "Semina", value: toPct(totals.semina), color: "#f59e0b" },
      { label: "Da\u00A0Richiamare", value: toPct(totals.daRichiamare), color: "#22c55e" },
      { label: "BIN", value: toPct(totals.bin), color: "#ef4444" },
      { label: "Appuntamenti", value: toPct(totals.appuntamenti), color: "#14b8a6" },
      { label: "No Show", value: toPct(totals.noShow), color: "#94a3b8" }
    ];
  }, [operatoriNorm]);

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
        cur.ass += r.assegnati;
        cur.app += r.appuntamenti;
        recentByCamp.set(r.campagna, cur);
      } else if (t >= baselineStartMs && t <= baselineEndMs) {
        const cur = baselineByCamp.get(r.campagna) ?? { ass: 0, app: 0 };
        cur.ass += r.assegnati;
        cur.app += r.appuntamenti;
        baselineByCamp.set(r.campagna, cur);
      }
    }

    const campaignSet = new Set(
      (campaigns ?? [])
        .map((c) => c.trim())
        .filter((c) => c && c.toLowerCase() !== "nessuna")
    );
    const campaignKeys =
      campaignSet.size > 0
        ? Array.from(campaignSet)
        : Array.from(
            new Set<string>([
              ...Array.from(recentByCamp.keys()),
              ...Array.from(baselineByCamp.keys())
            ])
          );

    const rows = campaignKeys
      .map((campagna) => {
        const recent = recentByCamp.get(campagna) ?? { ass: 0, app: 0 };
        const baseline = baselineByCamp.get(campagna) ?? { ass: 0, app: 0 };

        const recentRate = recent.ass > 0 ? recent.app / recent.ass : 0;
        const baselineRate = baseline.ass > 0 ? baseline.app / baseline.ass : 0;
        const delta = recentRate - baselineRate;

        return {
          campagna,
          recentAss: recent.ass,
          recentApp: recent.app,
          baselineAss: baseline.ass,
          baselineApp: baseline.app,
          recentRate,
          baselineRate,
          delta
        };
      })
      .sort((a, b) => {
        const aAltro = a.campagna.trim().toLowerCase() === "altro";
        const bAltro = b.campagna.trim().toLowerCase() === "altro";
        if (aAltro && !bAltro) return 1;
        if (!aAltro && bAltro) return -1;
        return a.delta - b.delta;
      });

    return rows;
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
    const days = 60;
    const startMs = endMs - (days - 1) * dayMs;

    const assByCamp = new Map<string, number>();
    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;
      assByCamp.set(r.campagna, (assByCamp.get(r.campagna) ?? 0) + r.assegnati);
    }

    const campaigns = campaignAnomalies
      .map((r) => r.campagna)
      .filter((c) => (assByCamp.get(c) ?? 0) > 0);
    if (campaigns.length === 0) {
      return { campaigns: [] as string[], data: [] as CampaignPeaksDatum[] };
    }

    type Agg = { ass: number; app: number };
    const byDay = new Map<string, Map<string, Agg>>();

    for (const r of operatoriNorm) {
      if (!r.campagna || !r.data) continue;
      if (!campaigns.includes(r.campagna)) continue;

      const t = toMs(r.data);
      if (Number.isNaN(t) || t < startMs || t > endMs) continue;

      const dayKey = r.data;
      const dayMap = byDay.get(dayKey) ?? new Map<string, Agg>();
      const cur = dayMap.get(r.campagna) ?? { ass: 0, app: 0 };
      cur.ass += r.assegnati;
      cur.app += r.appuntamenti;
      dayMap.set(r.campagna, cur);
      byDay.set(dayKey, dayMap);
    }

    const data: CampaignPeaksDatum[] = Array.from(byDay.keys())
      .sort((a, b) => toMs(a) - toMs(b))
      .map((date) => {
        const dayMap = byDay.get(date) ?? new Map<string, Agg>();
        const row: CampaignPeaksDatum = { date };

        for (const c of campaigns) {
          const agg = dayMap.get(c);
          row[c] = agg && agg.ass > 0 ? agg.app / agg.ass : null;
        }

        return row;
      });

    return { campaigns, data };
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
    if (!focusedPeaksCampaign) {
      setFocusedPeaksCampaign(lowestDeltaCampaign);
      return;
    }
    const stillExists = campaignAnomalies.some((r) => r.campagna === focusedPeaksCampaign);
    if (!stillExists) setFocusedPeaksCampaign(lowestDeltaCampaign);
  }, [campaignAnomalies, focusedPeaksCampaign, lowestDeltaCampaign]);

  const insightsTableHeightPx = useMemo(() => {
    const headerPx = 32;
    const rowPx = 40;
    const rows = Math.max(1, campaignAnomalies.length);
    return Math.max(260, headerPx + rows * rowPx);
  }, [campaignAnomalies.length]);

  const baselineRateByCampaign = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of campaignAnomalies) out[r.campagna] = r.baselineRate;
    return out;
  }, [campaignAnomalies]);

  return (
    <div>
      <div className="min-w-0">
        <div id="filtri" className="w-full scroll-mt-6">
          <FiltersBar
            filters={filters}
            setFilters={setFilters}
            operators={operators}
            campaigns={campaigns}
            vendite={useHubspot ? vendite : undefined}
            prodotti={useHubspot ? prodotti : undefined}
            operatorLabel={operatorLabel}
          />
        </div>

        {/* Senza titolo di sezione: la tabella si spiega da se'. L'ancora
            "tabella-operatori" resta pero' sul contenitore, perche' e' la
            destinazione della voce di menu.

            La tabella compare solo quando HubSpot ha risposto: prima si
            disegnava subito con le colonne del foglio piene e quelle di HubSpot
            a trattino, poi i trattini diventavano numeri e le righe si
            riordinavano sotto gli occhi. Meglio una attesa sola. */}
        {!hideOperatorTable && (
          <div id="tabella-operatori" className="mt-6 scroll-mt-6">
            <Card>
              {useHubspot && (dealsLoading || boomLoading) ? (
                <div className="flex h-64 items-center justify-center text-sm text-slate-500">
                  Caricamento dei dati in corso...
                </div>
              ) : (
              <OperatorStatsTable data={operatorSummaryAll} hubspotOverrides={useHubspot ? hubspotOverrides : undefined} trattativeOverrides={useHubspot && trattativeOverrides !== null ? trattativeOverrides : undefined} precomputedTotals={hubspotTotals ?? undefined} hubspotLoading={useHubspot ? boomLoading : false} trattativeLoading={useHubspot ? dealsLoading : false} operatorLabel={operatorLabel ?? "Advisor"} />
              )}
            </Card>
          </div>
        )}

        {/* Solo sugli Advisor: il proprietario di un meeting e' chi lo tiene,
            e i setter li prenotano ma non ci vanno. Sulla loro pagina l'agenda
            sarebbe l'agenda di qualcun altro. */}
        {!hideOperatorTable && !setterView && (
          <>
            <div id="agenda" className="scroll-mt-6">
              <SectionTitle className="mt-10">Agenda</SectionTitle>
            </div>
            <Card>
              <AgendaGiornaliera
                giorno={giornoAgenda}
                onGiorno={setGiornoAgenda}
                eventi={eventiAmmessi}
                operatori={personeAmmesse}
                caricamento={agendaInCorso}
                errore={agendaFallita}
                aggiornato={agendaLetta}
              />
            </Card>
          </>
        )}

        <div id="trend-funnel" className="scroll-mt-6">
          <SectionTitle className="mt-10">Trend Principali</SectionTitle>
        </div>
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <ChartTitle
              title={`Andamento ${setterView ? "dei Setter" : "degli Advisor"}`}
              description="Un punto per mese, per persona. Il mese segnato con l'asterisco e' quello in corso: e' disegnato ma non concorre a definire cosa sia normale, ed e' escluso dalle segnalazioni, se no sarebbe l'unica notizia tutti i mesi. Il filtro Periodo non tocca questo grafico, che guarda tutta la storia del foglio Operatori; gli altri filtri valgono."
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {metricheAdvisor(setterView, conHubspot).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMetricaScelta(m.value)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium shadow-sm transition ${
                    metricaScelta === m.value
                      ? "border-neutral-700 bg-black text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-neutral-800 hover:text-black"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="mt-4 h-[380px]">
              {daHubspot === null ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Caricamento dei dati in corso...
                </div>
              ) : (
                <AndamentoChart
                  mesi={vista.mesi}
                  serie={vista.serie}
                  metrica={vista.m}
                  anomalie={vista.chiavi}
                />
              )}
            </div>

            {hubspotFallito ? (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>Appuntamenti, Chiusure e Boom non disponibili.</strong> HubSpot non ha
                risposto: gli Appuntamenti qui sotto sono quelli del foglio Operatori, che possono
                non coincidere con la tabella, e le altre due non compaiono.
              </div>
            ) : null}

            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Picchi e cali fuori dal normale
              </div>
              {vista.anomalie.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  Nessun mese fuori dal normale su questa metrica. Servono almeno quattro mesi
                  completi per dire cosa sia normale: chi ha cominciato da poco non compare.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                  {vista.anomalie.slice(0, 8).map((a) => (
                    <li key={`${a.gruppo}|${a.mese}`} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          a.buona ? "bg-emerald-600" : "bg-rose-600"
                        }`}
                      />
                      <span>
                        <strong className="font-semibold text-slate-900">{a.gruppo}</strong>
                        {" · "}
                        {etichettaMese(a.mese)}: {vista.m.label}{" "}
                        <strong className={a.buona ? "text-emerald-700" : "text-rose-700"}>
                          {formattaValore(a.valore, vista.m)}
                        </strong>{" "}
                        contro una normalita' fra {formattaValore(a.normalita.basso, vista.m)} e{" "}
                        {formattaValore(a.normalita.alto, vista.m)}.
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

      <div id="stati-lead" className="scroll-mt-6">
        <SectionTitle className="mt-10">Stati Lead</SectionTitle>
      </div>
      <Card>
        <ChartTitle
          title="Stato Lead Pattern"
          description="Conteggio aggregato dei principali Stati Lead a confronto con il numero di Appuntamenti e di No Show"
        />
        <div className="mt-4 h-[340px]">
          <FunnelStagesChart stages={leadStatusStages} valueFormat="pct" barSize={17} />
        </div>
      </Card>

      <div id="performance" className="scroll-mt-6">
        <SectionTitle className="mt-10">Performance</SectionTitle>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <ChartTitle
              title="Latenza"
              description="Tempo medio fra assegnazione e prima chiamata"
            />
            <div className="mt-4 h-[315px]">
              <ReactivityGauge value={kpis.reattivitaMediaMin} max={300} />
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Media Periodo:{" "}
              <span className="font-semibold text-gray-900">
                {formatFloat(kpis.reattivitaMediaMin, 1)} min
              </span>
            </div>
          </Card>
          <Card>
            <ChartTitle
              title="Reattività"
              description="Tempestività dell'Operatore nel passare all'azione"
            />
            <div className="mt-4 h-[315px]">
              <ReactivityGauge
                value={reactivityPct}
                max={100}
                unit="%"
                fillColor="#f59e0b"
              />
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Media Periodo:{" "}
              <span className="font-semibold text-gray-900">
                {formatFloat(reactivityPct, 1)}%
              </span>
            </div>
          </Card>
        </div>

        {hideCampagne ? null : (
          <>
            <div id="campagne" className="scroll-mt-6">
              <SectionTitle className="mt-10">Campagne</SectionTitle>
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
          </>
        )}
      </div>

      {hideInsights ? null : (
        <>
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
                  const focusBg = isFocused ? "bg-slate-50" : "bg-white";

                  return (
                    <div
                      key={row.campagna}
                      className={`grid grid-cols-12 gap-x-4 px-4 py-2 text-sm ${focusBg}`}
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
                        {sign}
                        {formatPct(delta, 1)}
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
        </>
      )}

      </div>
    </div>
  );
}
