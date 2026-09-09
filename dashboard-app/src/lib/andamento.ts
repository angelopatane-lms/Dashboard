// Le metriche del grafico dell'andamento e il modo di dire quando un mese e'
// fuori dal normale.

import type { AndamentoRow } from "@/app/api/campaign-andamento/route";
import { categoriaResidua } from "@/lib/campaignCategory";
import type { OperatoriNormalized } from "@/lib/analytics";

/**
 * I formati sono quelli della tabella Campagne, decimali compresi: la spesa a
 * due cifre perche' il foglio Ads la riporta al centesimo, l'importo a zero
 * perche' sono migliaia di euro e i centesimi sarebbero rumore.
 */
export type Formato = "intero" | "euro" | "euro_centesimi" | "percento" | "volte";

/**
 * Una riga di serie storica: un mese, e il nome della linea a cui appartiene.
 *
 * "gruppo" e non "categoria" perche' lo stesso codice disegna due grafici che
 * raggruppano cose diverse - le campagne per categoria, gli advisor per
 * persona - e chiamarlo con il nome di uno dei due avrebbe costretto l'altro a
 * fingere di essere una categoria.
 */
export type RigaSerie = { mese: string; gruppo: string };

export type Metrica<T> = {
  value: string;
  label: string;
  formato: Formato;
  /** Piu' alto e' meglio: decide se un'anomalia e' un picco o un tonfo. */
  altoEBene: boolean;
  /** Null quando manca il denominatore: non e' zero, e' non calcolabile. */
  calcola: (r: T) => number | null;
};

/**
 * LE METRICHE HANNO GLI STESSI NOMI DELLE COLONNE DELLA TABELLA, e lo stesso
 * ordine: sono la stessa cosa guardata nel tempo invece che nel periodo, e due
 * vocabolari sulla stessa pagina costringerebbero a tradurre a mente.
 *
 * "CPAS" e "CPA" sono i due costi che usa la tabella - per consulenza svolta e
 * per vendita chiusa - e hanno preso il posto del "costo per appuntamento" che
 * mi ero inventato, che nella tabella non esiste.
 *
 * NE MANCANO SETTE delle diciotto colonne, e non per dimenticanza: Lead Unici e
 * CPL Unici vogliono la prima conversione di ogni persona, Chiamate e
 * Connessioni la tabella delle telefonate, le tre percentuali di funnel i loro
 * denominatori. Si possono aggiungere, ma ognuna e' una query in piu' su ogni
 * apertura della pagina.
 *
 * Il ROAS resta la scelta di partenza: e' la domanda vera. Ma da solo non dice
 * mai perche', ed e' per questo che le altre sono a un click.
 */
export const METRICHE: Metrica<AndamentoRow>[] = [
  { value: "spesa", label: "Spesa", formato: "euro_centesimi", altoEBene: false, calcola: (r) => r.spesa },
  {
    value: "lead_generati",
    label: "Lead Generati",
    formato: "intero",
    altoEBene: true,
    calcola: (r) => r.lead
  },
  {
    value: "cpl_generati",
    label: "CPL Generati",
    formato: "euro_centesimi",
    altoEBene: false,
    calcola: (r) => (r.spesa > 0 && r.lead > 0 ? r.spesa / r.lead : null)
  },
  {
    value: "appuntamenti",
    label: "Appuntamenti",
    formato: "intero",
    altoEBene: true,
    calcola: (r) => r.appuntamenti
  },
  {
    value: "consulenze",
    label: "Consulenze",
    formato: "intero",
    altoEBene: true,
    calcola: (r) => r.consulenze
  },
  {
    value: "cpas",
    label: "CPAS",
    formato: "euro_centesimi",
    altoEBene: false,
    calcola: (r) => (r.spesa > 0 && r.consulenze > 0 ? r.spesa / r.consulenze : null)
  },
  {
    value: "chiusure",
    label: "Chiusure",
    formato: "intero",
    altoEBene: true,
    calcola: (r) => r.chiusure
  },
  { value: "importo", label: "Importo", formato: "euro", altoEBene: true, calcola: (r) => r.incasso },
  {
    value: "cr_sales",
    label: "CR Sales",
    formato: "percento",
    altoEBene: true,
    calcola: (r) => (r.consulenze > 0 ? r.chiusure / r.consulenze : null)
  },
  {
    value: "cpa",
    label: "CPA",
    formato: "euro_centesimi",
    altoEBene: false,
    calcola: (r) => (r.spesa > 0 && r.chiusure > 0 ? r.spesa / r.chiusure : null)
  },
  {
    value: "roas",
    label: "ROAS",
    formato: "volte",
    altoEBene: true,
    calcola: (r) => (r.spesa > 0 ? r.incasso / r.spesa : null)
  }
];

export const METRICA_DEFAULT = "roas";

export function metrica(value: string): Metrica<AndamentoRow> {
  return METRICHE.find((m) => m.value === value) ?? METRICHE[0];
}

export type Normalita = { mediana: number; basso: number; alto: number };

/**
 * La banda dentro cui i valori di una categoria si sono sempre mossi.
 *
 * USA MEDIANA E SCARTO ASSOLUTO MEDIANO, non media e deviazione standard. Con
 * otto o dieci mesi un solo mese eccezionale sposta la media e allarga la
 * deviazione abbastanza da nascondere l'anomalia successiva - e il mese
 * eccezionale e' esattamente quello che stiamo cercando. La mediana non se ne
 * accorge nemmeno.
 *
 * Il fattore 1,4826 riporta lo scarto mediano alla stessa scala della
 * deviazione standard di una distribuzione normale: serve solo perche' la
 * soglia si legga come "due sigma" e non come un numero arbitrario.
 *
 * Restituisce null in tre casi, e in tutti e tre segnalare qualcosa sarebbe
 * peggio che tacere:
 *
 * - meno di quattro mesi: non c'e' una normalita' da conoscere;
 * - valori tutti uguali: qualunque scostamento risulterebbe fuori banda;
 * - mediana a zero: una categoria ferma per meta' dei mesi non ha un livello
 *   normale, e il primo mese in cui fa qualcosa risulterebbe un'anomalia.
 */
export function normalita(valori: number[], soglia = 2): Normalita | null {
  const buoni = valori.filter((v) => Number.isFinite(v));
  if (buoni.length < 4) return null;

  const mediana = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const centro = mediana(buoni);
  if (centro <= 0) return null;

  const scarto = 1.4826 * mediana(buoni.map((v) => Math.abs(v - centro)));
  if (scarto <= 0) return null;

  return {
    mediana: centro,
    // Nessuna di queste grandezze puo' essere negativa: una banda che parte da
    // meno sette si legge come un errore di conto, e per il lettore e' zero.
    basso: Math.max(0, centro - soglia * scarto),
    alto: centro + soglia * scarto
  };
}

export type Anomalia = {
  gruppo: string;
  mese: string;
  valore: number;
  normalita: Normalita;
  /** Vero quando il valore e' una buona notizia per quella metrica. */
  buona: boolean;
};

export type SerieAndamento = {
  gruppo: string;
  /** Un valore per mese, nell'ordine dei mesi. Null dove non calcolabile. */
  valori: Array<number | null>;
  normalita: Normalita | null;
};

/**
 * Le serie per categoria e i mesi fuori banda.
 *
 * IL MESE IN CORSO RESTA FUORI DA TUTTO, sia dal calcolo della normalita' sia
 * dalle segnalazioni. E' incompleto per definizione - nove giorni contro
 * trenta - e provandolo si vedeva: su nove metriche, sette avevano il mese in
 * corso in cima all'elenco per ogni singola categoria, sempre "in calo".
 * Sarebbe l'unica notizia, tutti i mesi, e non e' una notizia.
 *
 * Resta disegnato sul grafico, marcato come parziale: si vede dove sta andando,
 * senza spacciarlo per un fatto compiuto.
 */
export function costruisciSerie<T extends RigaSerie>(
  righe: T[],
  mesi: string[],
  m: Metrica<T>
): { serie: SerieAndamento[]; anomalie: Anomalia[] } {
  const perGruppo = new Map<string, Map<string, T>>();
  for (const r of righe) {
    const dentro = perGruppo.get(r.gruppo) ?? new Map<string, T>();
    dentro.set(r.mese, r);
    perGruppo.set(r.gruppo, dentro);
  }

  const ultimo = mesi[mesi.length - 1];
  const serie: SerieAndamento[] = [];
  const anomalie: Anomalia[] = [];

  for (const [gruppo, perMese] of perGruppo) {
    const valori = mesi.map((mese) => {
      const r = perMese.get(mese);
      return r ? m.calcola(r) : null;
    });

    const perBanda = mesi
      .map((mese, i) => ({ mese, v: valori[i] }))
      .filter((x) => x.mese !== ultimo && x.v !== null)
      .map((x) => x.v as number);

    const banda = normalita(perBanda);
    serie.push({ gruppo, valori, normalita: banda });

    if (!banda) continue;
    mesi.forEach((mese, i) => {
      if (mese === ultimo) return;
      const v = valori[i];
      if (v === null) return;
      if (v >= banda.basso && v <= banda.alto) return;
      anomalie.push({
        gruppo,
        mese,
        valore: v,
        normalita: banda,
        buona: m.altoEBene ? v > banda.alto : v < banda.basso
      });
    });
  }

  // Prima le notizie brutte, e fra queste le piu' recenti: e' l'ordine in cui
  // servono, non l'ordine alfabetico.
  anomalie.sort(
    (a, b) => Number(a.buona) - Number(b.buona) || b.mese.localeCompare(a.mese)
  );
  // "Altro" e "Nessuna" chiudono la legenda, come chiudono l'elenco del filtro
  // e le righe della tabella: non sono linee di prodotto ma il posto dove
  // finisce cio' che la regola non riconosce, e in ordine alfabetico "Altro"
  // aprirebbe la fila sembrando una categoria come le altre.
  serie.sort((a, b) => {
    const aUltima = categoriaResidua(a.gruppo);
    const bUltima = categoriaResidua(b.gruppo);
    if (aUltima !== bUltima) return aUltima ? 1 : -1;
    return a.gruppo.localeCompare(b.gruppo, "it");
  });

  return { serie, anomalie };
}

/** I mesi presenti nei dati, dal piu' vecchio al piu' recente. */
export function mesiDi(righe: RigaSerie[]): string[] {
  return Array.from(new Set(righe.map((r) => r.mese))).sort();
}

/** "2026-07" diventa "lug 26". */
export function etichettaMese(mese: string): string {
  const nomi = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const i = Number(mese.slice(5, 7)) - 1;
  return `${nomi[i] ?? mese.slice(5, 7)} ${mese.slice(2, 4)}`;
}

// ---------------------------------------------------------------------------
// L'andamento delle persone: Advisor e Setter.
//
// I dati arrivano dal foglio Operatori, che ha una riga per persona, campagna e
// giorno. Non dal database, che di operatori non sa niente: nessuna delle sue
// tabelle - trattativa, chiamata, no_show - porta il nome di chi ha lavorato la
// pratica.
// ---------------------------------------------------------------------------

export type RigaAdvisor = RigaSerie & {
  assegnati: number;
  chiamate: number;
  connessioni: number;
  appuntamenti: number;
  noShow: number;
};

/**
 * I mesi di ogni persona, sommando le sue righe giornaliere.
 *
 * Le righe senza operatore o senza data non hanno un posto dove andare e si
 * fermano qui.
 */
export function righeAdvisor(norm: OperatoriNormalized[]): RigaAdvisor[] {
  const per = new Map<string, RigaAdvisor>();
  for (const r of norm) {
    if (!r.operatore || !r.data) continue;
    const mese = r.data.slice(0, 7);
    const k = `${mese}|${r.operatore}`;
    const v =
      per.get(k) ??
      {
        mese,
        gruppo: r.operatore,
        assegnati: 0,
        chiamate: 0,
        connessioni: 0,
        appuntamenti: 0,
        noShow: 0
      };
    v.assegnati += r.assegnati;
    v.chiamate += r.chiamate;
    v.connessioni += r.connessioni;
    v.appuntamenti += r.appuntamenti;
    v.noShow += r.noShow;
    per.set(k, v);
  }
  return Array.from(per.values());
}

/**
 * Le metriche del grafico delle persone: gli stessi nomi e formati della
 * tabella qui sopra.
 *
 * NE MANCANO QUATTRO delle nove colonne - Consulenze, Chiusure, % Chiusura e
 * Boom - e non per scelta: nel foglio quelle colonne sono a zero prima di
 * agosto 2026. Misurato sulle 23.804 righe: Consulenze 0 da marzo a giugno, 5 a
 * luglio, 301 ad agosto; Boom zero fino a luglio e 260.612 EUR ad agosto.
 * Disegnarle darebbe una linea piatta a zero e poi un'impennata, cioe' il
 * racconto di un'azienda che comincia a vendere ad agosto.
 *
 * Nella tabella quei numeri ci sono lo stesso perche' per il periodo scelto
 * arrivano da HubSpot in diretta, non dal foglio. Per averli anche qui
 * servirebbe rileggere HubSpot mese per mese.
 *
 * La sesta voce segue la tabella, che cambia colonna fra le due pagine:
 * l'Advisor vede le Consulenze - qui assenti - e il Setter i No Show, che
 * invece la storia ce l'hanno.
 */
export function metricheAdvisor(setter: boolean): Metrica<RigaAdvisor>[] {
  const base: Metrica<RigaAdvisor>[] = [
    { value: "assegnati", label: "Assegnati", formato: "intero", altoEBene: true, calcola: (r) => r.assegnati },
    { value: "chiamate", label: "Chiamate", formato: "intero", altoEBene: true, calcola: (r) => r.chiamate },
    {
      value: "connessioni",
      label: "Connessioni",
      formato: "intero",
      altoEBene: true,
      calcola: (r) => r.connessioni
    },
    {
      value: "appuntamenti",
      label: "Appuntamenti",
      formato: "intero",
      altoEBene: true,
      calcola: (r) => r.appuntamenti
    },
    {
      value: "pct_appuntamento",
      label: "% Appuntamento",
      formato: "percento",
      altoEBene: true,
      // Stessa formula della tabella: degli assegnati raggiunti al telefono,
      // quanti hanno fissato.
      calcola: (r) => (r.connessioni > 0 ? r.appuntamenti / r.connessioni : null)
    }
  ];

  if (setter) {
    base.push({
      value: "no_show",
      label: "No Show",
      formato: "intero",
      altoEBene: false,
      calcola: (r) => r.noShow
    });
  }

  return base;
}

export function metricaAdvisor(value: string, setter: boolean): Metrica<RigaAdvisor> {
  const elenco = metricheAdvisor(setter);
  return elenco.find((m) => m.value === value) ?? elenco[0];
}

export const METRICA_ADVISOR_DEFAULT = "appuntamenti";
