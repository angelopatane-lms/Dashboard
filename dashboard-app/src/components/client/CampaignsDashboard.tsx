"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { applyFilters, getString, type Filters } from "@/lib/metrics";
import { aggregateByCampagna, normalizeOperatori } from "@/lib/analytics";
import { categoriaResidua, guessCategoria } from "@/lib/campaignCategory";
import type { Variante } from "@/lib/campagne";
import {
  chiaveCampagna,
  FORMATI,
  formatoCampagna,
  leggiVariante,
  nomeConforme,
  SUFFISSO_INSTANT,
  VARIANTE_DEFAULT,
  VARIANTI,
  varianteEsegmento,
  type MappaVarianti
} from "@/lib/campagne";
import { PERIODO_DEFAULT, periodoScelto } from "@/lib/periodi";
import { FiltersBar } from "@/components/Filters";
import ChartTitle from "@/components/ui/ChartTitle";
import AndamentoChart, { formattaValore } from "@/components/charts/AndamentoChart";
import {
  costruisciSerie,
  etichettaMese,
  METRICA_DEFAULT,
  METRICHE,
  mesiDi,
  metrica
} from "@/lib/andamento";
import type { AndamentoRow } from "@/app/api/campaign-andamento/route";
import Card from "@/components/ui/Card";
import SectionTitle from "@/components/ui/SectionTitle";
import CampaignAdsTable, { type CampaignAdsRow, type FunnelCampagna } from "@/components/charts/CampaignAdsTable";
import type { CampaignAdsSpendRow } from "@/app/api/campaign-ads/route";
import type { CampaignConversionRow } from "@/app/api/campaign-conversions/route";
import type { RawBoomRecord } from "@/app/api/hubspot-data/route";
import type { CampaignTrattativeRow } from "@/app/api/campaign-trattative/route";
import type { CampaignChiamateRow } from "@/app/api/campaign-chiamate/route";
import { CHIUSURE_TIPOLOGIE, BOOM_TIPOLOGIE } from "@/lib/hubspotRegole";


// Opzioni del filtro che su questa pagina prende il posto di "Operatore" e si
// chiama "Variabile": le righe sono campagne, non persone.
//
// Servono a stringere la tabella su quello che si sta guardando. Da quando
// mostriamo anche le campagne con attivita' ma senza spesa le righe sono
// passate da 73 a 445 sul trimestre: la vista completa serve a far tornare i
// totali, queste a lavorare comodamente.
//
// "Con Vendita" tiene le righe che hanno prodotto un incasso: si guardano sia
// le Chiusure sia l'Importo perche' arrivano da due regole diverse sui
// tipi di incasso (vedi CHIUSURE_TIPOLOGIE e BOOM_TIPOLOGIE), quindi una riga
// puo' avere importo senza chiusure e viceversa.
const TIPOLOGIE = [
  { label: "Con Spesa", value: "con_spesa" },
  { label: "Con Vendita", value: "con_vendita" },
  { label: "Con Spesa e Vendita", value: "con_spesa_e_vendita" }
];

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
  funnelByCampagna: Map<string, FunnelCampagna>,
  variante: Variante,
  varianti: MappaVarianti
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
  const segmento = varianteEsegmento(variante);

  const nomi = new Map<string, string>();
  // Nelle viste per segmento la spesa NON crea righe: e' indicizzata sulla
  // campagna intera e serve solo da tabella di lookup per ripartirla. Usandola
  // anche come elenco, in "Instant" comparivano le campagne base a zero lead
  // accanto alle loro varianti - cioe' esattamente quello che il filtro doveva
  // togliere.
  if (!segmento) {
    for (const [chiave, entry] of spesaByCampagna) {
      nomi.set(chiave, entry.campagna.trim() || "(Nessuna)");
    }
  }
  for (const [chiave, r] of conversioniByCampagna) {
    if (!nomi.has(chiave)) nomi.set(chiave, r.campagna);
  }
  for (const chiave of funnelByCampagna.keys()) {
    if (!nomi.has(chiave)) nomi.set(chiave, chiave);
  }

  return Array.from(nomi.entries()).map(([chiave, campagna]) => {
    const conv = conversioniByCampagna.get(chiave);

    // SPESA DEI GRUPPI. Il foglio Ads conosce la campagna, non i suoi gruppi:
    // non esiste un budget speso "sui contatti assegnati subito". Nelle viste
    // instant e non instant la si ripartisce quindi in proporzione ai Lead
    // Generati, ed e' una STIMA dichiarata come tale.
    //
    // Conseguenza da tenere a mente leggendo la tabella: cosi' costruito, il
    // CPL Generati risulta identico nelle tre viste, perche' spesa e lead sono
    // divisi dalla stessa frazione. A cambiare - e a dire qualcosa - sono CPL
    // Unici, CPAS, CPA e ROAS, che hanno un altro denominatore.
    let spesa = spesaByCampagna.get(chiave)?.spesa ?? 0;
    let spesaStimata = false;
    if (segmento) {
      const base = chiaveCampagna(campagna, "unificate", varianti) ?? chiave;
      const spesaCampagna = spesaByCampagna.get(base)?.spesa ?? 0;
      const totale = conv?.lead_generati_campagna ?? 0;
      const quota = totale > 0 ? (conv?.lead_generati ?? 0) / totale : 0;
      spesa = spesaCampagna * quota;
      spesaStimata = spesa > 0;
    }

    return {
      categoria: guessCategoria(campagna),
      campagna,
      spesa,
      spesaStimata,
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
    to: defaultTo,
    variante: VARIANTE_DEFAULT
  }));

  // Le tre API raggruppano le righe lato database, quindi il valore va
  // rispedito a ogni cambio: non basta filtrare a valle.
  const variante = leggiVariante(filters.variante);

  // Le categorie scelte nel filtro a piu' voci. Elenco vuoto = tutte.
  const categorieScelte = useMemo(
    () => (filters.categorie ?? "").split(",").filter(Boolean),
    [filters.categorie]
  );

  const [adsSpendRows, setAdsSpendRows] = useState<CampaignAdsSpendRow[]>([]);
  // Mappa "nome con suffisso" -> "nome base", costruita dal server perche' solo
  // lui ha l'elenco delle campagne. Vedi /api/campaign-ads.
  const [varianti, setVarianti] = useState<MappaVarianti>({});
  const fetchedAdsRangeRef = useRef<{ from: string; to: string } | null>(null);

  useEffect(() => {
    const currentFrom = filters.from ?? defaultFrom;
    const currentTo = filters.to ?? defaultTo;
    const fetched = fetchedAdsRangeRef.current;
    if (fetched && currentFrom >= fetched.from && currentTo <= fetched.to) return;

    fetch(`/api/campaign-ads?from=${currentFrom}&to=${currentTo}`)
      .then((r) => r.json())
      .then((data: { rows?: CampaignAdsSpendRow[]; varianti?: MappaVarianti }) => {
        setAdsSpendRows(data.rows ?? []);
        setVarianti(data.varianti ?? {});
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
    for (const r of conversioni) {
      const k = chiaveCampagna(r.campagna, variante, varianti);
      if (k) map.set(k, r);
    }
    return map;
  }, [conversioni, variante, varianti]);

  // Appuntamenti, Chiusure e Importo dalle STESSE fonti della pagina Advisor:
  // gli endpoint restituiscono i record grezzi, che li' vengono raggruppati per
  // operatore e qui per campagna (id_campagna_track). Stessi record e stesse
  // regole, quindi i totali delle due pagine si riconciliano.
  //
  // Il foglio Operatori non puo' servire allo scopo: la sua colonna "Campagna"
  // contiene 9 categorie (DIV COACH, REM, MEP...), non i nomi tecnici delle
  // campagne, quindi l'aggancio per nome falliva su ogni riga e queste colonne
  // erano sempre a zero.
  const [boomRecords, setBoomRecords] = useState<RawBoomRecord[] | null>(null);
  const [hubspotErrore, setHubspotErrore] = useState<boolean | null>(null);

  // Consulenze svolte, precalcolate su Postgres dal sync delle trattative: la
  // data della consulenza non e' ricavabile dallo stato attuale, va ricostruita
  // dalla cronologia delle fasi.
  const [consulenze, setConsulenze] = useState<CampaignTrattativeRow[]>([]);
  const [consulenzeErrore, setConsulenzeErrore] = useState<boolean | null>(null);

  // Chiamate e Connessioni, anch'esse precalcolate: la campagna di una
  // telefonata e' quella che il contatto aveva in quel momento, e ricavarla in
  // lettura vorrebbe dire scandagliare 740.000 eventi a ogni caricamento.
  const [chiamate, setChiamate] = useState<CampaignChiamateRow[]>([]);
  const [chiamateErrore, setChiamateErrore] = useState<boolean | null>(null);

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

    // Restano solo gli incassi da HubSpot in diretta: gli Appuntamenti ora
    // arrivano da /api/campaign-trattative, che li conta dalla nostra tabella e
    // sa a quale gruppo appartengono. Una chiamata in meno a ogni cambio di
    // periodo, ed era quella su 2.000 record.
    const leggi = async () => {
      try {
        const b = await fetch(`/api/hubspot-data?from=${from}&to=${to}`).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`incassi HTTP ${r.status}`))
        );
        if (annullato) return;
        setBoomRecords(b.boomRecords ?? []);
        setHubspotErrore(false);
      } catch (err) {
        if (annullato) return;
        console.error("[campagne/hubspot]", err);
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
      const k = chiaveCampagna(campagna, variante, varianti);
      if (!k) return null;
      const cur = map.get(k) ?? { appuntamenti: 0, chiusure: 0, importo: 0, consulenze: 0, noShow: 0, chiamate: 0, connessioni: 0 };
      map.set(k, cur);
      return cur;
    };

    // GLI INCASSI SI DIVIDONO PER CONTATTO, non per nome campagna: il campo
    // "instant" arriva gia' calcolato da /api/hubspot-data, che sa quali
    // contatti erano stati assegnati subito. Il nome memorizzato non basta,
    // perche' un workflow lo scrive prima che il marcatore venga aggiunto.
    //
    // La chiave ricalca quella delle query SQL, altrimenti incassi e lead
    // finirebbero su righe diverse: nella vista Instant si toglie l'eventuale
    // marcatore e lo si rimette, cosi' le due grafie collassano su una riga.
    const chiaveIncasso = (nome: string, instant: boolean): string | null => {
      if (!varianteEsegmento(variante)) return chiaveCampagna(nome, variante, varianti);
      const pulito = nome.trim();
      if (!pulito || !nomeConforme(pulito)) return null;
      const senzaMarcatore = pulito
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/_test_instant$/, "");
      if (variante === "instant") return instant ? `${senzaMarcatore}${SUFFISSO_INSTANT}` : null;
      return instant ? null : varianti[senzaMarcatore] ?? senzaMarcatore;
    };

    for (const r of boomRecords ?? []) {
      if (!r.id_campagna_track?.trim()) continue;
      const chiave = chiaveIncasso(r.id_campagna_track, r.instant);
      if (!chiave) continue;
      const cur = map.get(chiave) ?? { appuntamenti: 0, chiusure: 0, importo: 0, consulenze: 0, noShow: 0, chiamate: 0, connessioni: 0 };
      map.set(chiave, cur);
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
      // Anche gli Appuntamenti vengono da qui: la nostra tabella conserva il
      // contatto, quindi sa dividerli fra assegnati subito e assegnati dopo.
      // HubSpot in diretta no, e per saperlo servirebbero venti chiamate alle
      // associazioni a ogni caricamento di pagina.
      cur.appuntamenti += r.appuntamenti;
    }
    for (const r of chiamate) {
      const cur = prendi(r.campagna);
      if (!cur) continue;
      cur.chiamate += r.chiamate;
      cur.connessioni += r.connessioni;
    }
    return map;
  }, [boomRecords, consulenze, chiamate, variante, varianti]);

  // Il filtro "Campagna" di questa pagina mostra le Categorie (dedotte dalle
  // campagne tecniche realmente presenti nel foglio Ads-spesa per il periodo
  // caricato), non i singoli nomi di campagna e non le voci generiche del
  // foglio Operatori (es. "MBE SALES", "DIV COACH", "Nessuna").
  const categoriaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of adsSpendRows) {
      const c = r.campagna.trim();
      if (c && (variante === "tutte" || nomeConforme(c))) set.add(guessCategoria(c));
    }
    // "Altro" in fondo, insieme a "Nessuna": sono voci di raccolta, non linee
    // di prodotto, e in ordine alfabetico "Altro" finirebbe per primo.
    return Array.from(set).sort((a, b) => {
      const aResidua = categoriaResidua(a);
      const bResidua = categoriaResidua(b);
      if (aResidua !== bResidua) return aResidua ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [adsSpendRows, variante]);

  const spesaByCampagna = useMemo(() => {
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? defaultTo;
    const map = new Map<string, { campagna: string; spesa: number }>();
    // Nelle viste per segmento la spesa si indicizza sulla CAMPAGNA INTERA: il
    // foglio Ads non sa nulla di assegnazioni, e la riga del gruppo andra' a
    // cercarsela di li' per ripartirla (vedi buildCampaignAdsRows).
    const chiaveSpesa = varianteEsegmento(variante) ? "unificate" : variante;
    for (const r of adsSpendRows) {
      if (from && r.data && r.data < from) continue;
      if (to && r.data && r.data > to) continue;
      // La spesa senza nome campagna resta visibile sotto "(Nessuna)": quello
      // non e' un nome non conforme, e' un nome assente, e scartarla
      // toglierebbe euro veri dal totale della pagina.
      const key = r.campagna.trim() ? chiaveCampagna(r.campagna, chiaveSpesa, varianti) : "__nessuna__";
      if (!key) continue;
      const cur = map.get(key) ?? { campagna: key, spesa: 0 };
      cur.spesa += r.spesa;
      map.set(key, cur);
    }
    return map;
  }, [adsSpendRows, filters.from, filters.to, variante, varianti, defaultFrom, defaultTo]);

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
    // La colonna "Campagna" del foglio Operatori contiene una Categoria e non
    // un nome di campagna tecnico, quindi si filtra per categoria dedotta. Il
    // filtro campagna non si applica a queste righe: si toglie prima.
    const { campagna: _ignorato, ...restFilters } = filters;
    const base = applyFilters(operatoriRowsWithToday, restFilters);
    if (!categorieScelte.length) return base;
    return base.filter((r) => categorieScelte.includes(guessCategoria(getString(r, "Campagna"))));
  }, [operatoriRowsWithToday, filters, categorieScelte]);

  const operatoriNorm = useMemo(() => normalizeOperatori(operatoriFiltered), [operatoriFiltered]);

  const campaignSummaryFull = useMemo(() => aggregateByCampagna(operatoriNorm), [operatoriNorm]);


  // LA TABELLA SI MOSTRA SOLO QUANDO CI SONO TUTTE E QUATTRO LE FONTI.
  //
  // Le righe nascono dall'unione di spesa, lead, telefonate, trattative e
  // incassi, che arrivano da richieste separate: disegnandola a ogni risposta
  // si vedevano quattro rimescolamenti di fila, con righe che comparivano e
  // numeri che cambiavano sotto gli occhi. Meglio aspettare e disegnare una
  // volta sola con i valori definitivi.
  //
  // "Arrivata" comprende anche "fallita": se una fonte non risponde la tabella
  // deve comunque comparire, con l'avviso che spiega quali colonne sono a zero.
  const pronto =
    conversioniErrore !== null &&
    consulenzeErrore !== null &&
    chiamateErrore !== null &&
    hubspotErrore !== null;

  const campaignAdsRows = useMemo(() => {
    let rows = buildCampaignAdsRows(spesaByCampagna, conversioniByCampagna, funnelByCampagna, variante, varianti);

    const vuoleSpesa = filters.tipologia === "con_spesa" || filters.tipologia === "con_spesa_e_vendita";
    const vuoleVendita = filters.tipologia === "con_vendita" || filters.tipologia === "con_spesa_e_vendita";
    if (vuoleSpesa || vuoleVendita) {
      rows = rows.filter((r) => {
        if (vuoleSpesa && r.spesa <= 0) return false;
        if (!vuoleVendita) return true;
        // Chiusure e Importo non stanno sulla riga: la tabella li prende dal
        // funnel, indicizzato con la stessa chiave con cui la riga e' nata.
        const chiave = chiaveCampagna(r.campagna, variante, varianti);
        const f = chiave ? funnelByCampagna.get(chiave) : undefined;
        return Boolean(f && (f.chiusure > 0 || f.importo > 0));
      });
    }
    // La colonna Categoria resta visibile se le categorie scelte sono piu' di
    // una, perche' li' serve a distinguere le righe: sparisce solo quando ce
    // n'e' una sola. Vedi mostraCategoria piu' sotto.
    if (categorieScelte.length) rows = rows.filter((r) => categorieScelte.includes(r.categoria));
    // Il formato si legge dal nome della campagna, quindi si filtra qui e non
    // nelle query: nessuna delle fonti sa distinguere un live da un evergreen.
    // La scelta e' multipla e arriva come elenco separato da virgole.
    const formatiScelti = (filters.formato ?? "").split(",").filter(Boolean);
    if (formatiScelti.length) {
      rows = rows.filter((r) => formatiScelti.includes(formatoCampagna(r.campagna)));
    }
    return rows;
  }, [
    spesaByCampagna,
    conversioniByCampagna,
    funnelByCampagna,
    variante,
    varianti,
    categorieScelte,
    filters.tipologia,
    filters.formato
  ]);

  // L'ANDAMENTO DELLE CATEGORIE, mese per mese.
  //
  // NON SEGUE IL FILTRO PERIODO, ed e' voluto: e' una serie storica, e
  // guardarla dentro la finestra scelta la ridurrebbe a un punto solo. Segue
  // invece il filtro Categoria, che decide quali linee disegnare.
  //
  // Prima questa sezione leggeva il foglio Operatori, che di campagne non ne
  // conosce - la sua colonna "Campagna" contiene le nove categorie - e
  // confrontava 7 giorni contro 90 sulle righe gia' filtrate per periodo:
  // scegliendo il mese in corso, i 90 giorni di riferimento erano quasi vuoti e
  // il valore "storico" tendeva a zero da solo.
  const [andamento, setAndamento] = useState<AndamentoRow[]>([]);
  const [andamentoPronto, setAndamentoPronto] = useState(false);
  const [metricaScelta, setMetricaScelta] = useState<string>(METRICA_DEFAULT);

  useEffect(() => {
    let annullato = false;
    fetch("/api/campaign-andamento?mesi=12")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { righe?: AndamentoRow[] }) => {
        if (annullato) return;
        setAndamento(d.righe ?? []);
        setAndamentoPronto(true);
      })
      .catch((err) => {
        console.error("[campaign-andamento]", err);
        if (!annullato) setAndamentoPronto(true);
      });
    return () => {
      annullato = true;
    };
  }, []);

  const vista = useMemo(() => {
    const m = metrica(metricaScelta);
    // "gruppo" e' il nome della linea, e qui e' la categoria: il grafico e il
    // calcolo delle anomalie sono gli stessi che disegnano gli advisor, dove
    // invece e' la persona.
    const righe = (
      categorieScelte.length
        ? andamento.filter((r) => categorieScelte.includes(r.categoria))
        : andamento
    ).map((r) => ({ ...r, gruppo: r.categoria }));
    const mesi = mesiDi(righe);
    const { serie, anomalie } = costruisciSerie(righe, mesi, m);
    return {
      m,
      mesi,
      serie,
      anomalie,
      // Il grafico ha bisogno di sapere in fretta se un punto e' segnalato,
      // mentre disegna ogni pallino di ogni linea.
      chiavi: new Set(anomalie.map((a) => `${a.gruppo}|${a.mese}`))
    };
  }, [andamento, categorieScelte, metricaScelta]);

  return (
    <div>
      <div id="filtri" className="w-full scroll-mt-6">
        {/* ATTENZIONE AI NOMI: qui si decide come si chiamano i filtri sullo
            schermo, e su questa pagina nessuno dei quattro si chiama come la
            proprieta' che lo porta. Leggendo il codice piu' avanti conviene
            tenere presente la corrispondenza:

              campaigns  -> "Categoria"    l'elenco delle categorie
              varianti   -> "Campagna"     unificate, instant, tutte
              formati    -> "Tipologia"    dal vivo o sempre attivo
              tipologie  -> "Variabile"    con spesa, con vendita...

            I nomi interni sono rimasti quelli con cui i filtri sono nati; sullo
            schermo hanno preso via via le parole che usa chi li guarda. */}
        <FiltersBar
          filters={filters}
          setFilters={setFilters}
          campaigns={categoriaOptions}
          campaignLabel="Categoria"
          campagnaMultipla
          varianti={VARIANTI}
          varianteLabel="Campagna"
          formati={FORMATI}
          formatoLabel="Tipologia"
          tipologie={TIPOLOGIE}
          tipologiaLabel="Variabile"
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

      {/* L'ancora "Campagne" del menu laterale porta qui: ora che il grafico
          KPI non c'e' piu', la tabella e' cio' che quel nome indica. */}
      <div id="campagne" className="scroll-mt-6">
        <Card className="mt-6">
          {pronto ? (
            <CampaignAdsTable
              adsRows={campaignAdsRows}
              campaignSummary={campaignSummaryFull}
              funnelByCampagna={funnelByCampagna}
            // Nella vista Instant il suffisso ce l'hanno tutte le righe: si
            // toglie dal nome scritto, e resta nell'etichetta col mouse sopra.
            senzaMarcatore={variante === "instant"}
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500">
              Caricamento dei dati in corso...
            </div>
          )}
        </Card>
      </div>

      <div id="insights" className="scroll-mt-6">
        <SectionTitle className="mt-10">Insights</SectionTitle>
      </div>

      <Card className="mt-6">
        <ChartTitle
          title="Andamento delle Campagne"
          description="Un punto per mese, per categoria. Il mese segnato con l'asterisco e' quello in corso: e' disegnato ma non concorre a definire cosa sia normale, ed e' escluso dalle segnalazioni, se no sarebbe l'unica notizia tutti i mesi. Il filtro Categoria decide quali linee vedere; il filtro Periodo non tocca questo grafico, che guarda tutta la storia disponibile."
        />

        {/* Il ROAS dice se stiamo guadagnando, le altre dicono perche': se
            scende, con un click si vede se e' salita la spesa, se sono calati i
            lead o se e' peggiorata la conversione. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {METRICHE.map((m) => (
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
          {andamentoPronto ? (
            <AndamentoChart
              mesi={vista.mesi}
              serie={vista.serie}
              metrica={vista.m}
              anomalie={vista.chiavi}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Caricamento dei dati in corso...
            </div>
          )}
        </div>

        {/* I pallini pieni sul grafico dicono dove guardare, queste righe dicono
            cosa e' successo. Un mese e' segnalato quando esce dalla fascia in
            cui quella categoria si e' sempre mossa, misurata con la mediana e
            lo scarto mediano: con nove mesi, un solo mese eccezionale sposta la
            media abbastanza da nascondere l'anomalia successiva. */}
        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Picchi e cali fuori dal normale
          </div>
          {vista.anomalie.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Nessun mese fuori dal normale su questa metrica. Serve almeno mezzo anno di storia per
              dire cosa sia normale: le categorie piu' recenti non compaiono.
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
  );
}
