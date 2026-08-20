import { formatISO, parseISO } from "date-fns";
import type { CsvRow } from "@/lib/csv";
import { getString, toDateIso, toNumber } from "@/lib/metrics";

export type OperatoriNormalized = {
  data: string;
  operatore: string;
  campagna: string;
  assegnati: number;
  reattivitaMin: number;
  chiamate: number;
  connessioni: number;
  nuovi: number;
  nonRisposti: number;
  interesseFuturo: number;
  semina: number;
  daRichiamare: number;
  bin: number;
  appuntamenti: number;
  noShow: number;
  consulenze: number;
  chiusure: number;
  boom: number;
};

export function normalizeOperatori(rows: CsvRow[]): OperatoriNormalized[] {
  return rows
    .map((r) => {
      const data = toDateIso(getString(r, "Data"));
      return {
        data,
        operatore: getString(r, "Operatore"),
        campagna: getString(r, "Campagna"),
        assegnati: toNumber(getString(r, "Assegnati")),
        reattivitaMin: toNumber(getString(r, "Latenza")),
        chiamate: toNumber(getString(r, "Chiamati") || getString(r, "Chiamate")),
        connessioni: toNumber(getString(r, "Connessi") || getString(r, "Connessioni")),
        nuovi: toNumber(getString(r, "Nuovi")),
        nonRisposti: toNumber(getString(r, "Non Risposti")),
        interesseFuturo: toNumber(getString(r, "Interesse Futuro")),
        semina: toNumber(getString(r, "Semina")),
        daRichiamare: toNumber(getString(r, "Da Richiamare")),
        bin: toNumber(getString(r, "BIN")),
        appuntamenti: toNumber(getString(r, "Appuntamenti")),
        noShow: toNumber(getString(r, "No Show")),
        consulenze: toNumber(getString(r, "Consulenze")),
        chiusure: toNumber(getString(r, "Chiusure")),
        boom: toNumber(getString(r, "Boom"))
      };
    })
    .filter((r) => r.data);
}

export type TimeGrain = "day" | "week" | "month";

export function bucketDate(dateIso: string, grain: TimeGrain): string {
  const d = parseISO(dateIso);
  if (grain === "day") return dateIso;
  if (grain === "month") return formatISO(new Date(d.getFullYear(), d.getMonth(), 1), {
    representation: "date"
  });

  // week: Monday-start approximation via ISO week: bucket to date of Monday
  const day = d.getDay(); // 0 Sunday ... 6 Saturday
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return formatISO(monday, { representation: "date" });
}

export function safeDiv(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

export type TimeSeriesPoint = {
  bucket: string;
  assegnati: number;
  chiamate: number;
  connessioni: number;
  appuntamenti: number;
  noShow: number;
  nuovi: number;
  nonRisposti: number;
  interesseFuturo: number;
  semina: number;
  daRichiamare: number;
  bin: number;
  consulenze: number;
  chiusure: number;
  boom: number;
};

export function aggregateTimeSeries(
  operatori: OperatoriNormalized[],
  grain: TimeGrain
): TimeSeriesPoint[] {
  const map = new Map<string, TimeSeriesPoint>();

  const ensure = (bucket: string) => {
    const existing = map.get(bucket);
    if (existing) return existing;
    const created: TimeSeriesPoint = {
      bucket,
      assegnati: 0,
      chiamate: 0,
      connessioni: 0,
      appuntamenti: 0,
      noShow: 0,
      nuovi: 0,
      nonRisposti: 0,
      interesseFuturo: 0,
      semina: 0,
      daRichiamare: 0,
      bin: 0,
      consulenze: 0,
      chiusure: 0,
      boom: 0
    };
    map.set(bucket, created);
    return created;
  };

  for (const r of operatori) {
    const bucket = bucketDate(r.data, grain);
    const p = ensure(bucket);
    p.assegnati += r.assegnati;
    p.chiamate += r.chiamate;
    p.connessioni += r.connessioni;
    p.appuntamenti += r.appuntamenti;
    p.noShow += r.noShow;
    p.nuovi += r.nuovi;
    p.nonRisposti += r.nonRisposti;
    p.interesseFuturo += r.interesseFuturo;
    p.semina += r.semina;
    p.daRichiamare += r.daRichiamare;
    p.bin += r.bin;
    p.consulenze += r.consulenze;
    p.chiusure += r.chiusure;
    p.boom += r.boom;
  }

  return Array.from(map.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export type OperatorSummary = {
  operatore: string;
  assegnati: number;
  reattivitaMinAvg: number;
  chiamate: number;
  connessioni: number;
  appuntamenti: number;
  noShow: number;
  efficienzaContatto: number;
  conversioneAppuntamenti: number;
  noShowPct: number;
  indiceProntezza: number;
};

export function aggregateByOperatore(operatori: OperatoriNormalized[]): OperatorSummary[] {
  const map = new Map<
    string,
    {
      assegnati: number;
      chiamate: number;
      connessioni: number;
      appuntamenti: number;
      noShow: number;
      reattSum: number;
      reattCount: number;
    }
  >();

  for (const r of operatori) {
    const key = r.operatore || "(vuoto)";
    const cur = map.get(key) ?? {
      assegnati: 0,
      chiamate: 0,
      connessioni: 0,
      appuntamenti: 0,
      noShow: 0,
      reattSum: 0,
      reattCount: 0
    };
    cur.assegnati += r.assegnati;
    cur.chiamate += r.chiamate;
    cur.connessioni += r.connessioni;
    cur.appuntamenti += r.appuntamenti;
    cur.noShow += r.noShow;
    if (r.reattivitaMin > 0) {
      cur.reattSum += r.reattivitaMin;
      cur.reattCount += 1;
    }
    map.set(key, cur);
  }

  const out: OperatorSummary[] = [];
  for (const [operatore, t] of map.entries()) {
    const reattivitaMinAvg = t.reattCount ? t.reattSum / t.reattCount : 0;
    const adv = computeOperatorKpisAdvanced({
      chiamate: t.chiamate,
      connessioni: t.connessioni,
      appuntamenti: t.appuntamenti,
      noShow: t.noShow,
      reattivitaMinAvg
    });
    out.push({
      operatore,
      assegnati: t.assegnati,
      reattivitaMinAvg,
      chiamate: t.chiamate,
      connessioni: t.connessioni,
      appuntamenti: t.appuntamenti,
      noShow: t.noShow,
      ...adv
    });
  }

  return out.sort((a, b) => b.appuntamenti - a.appuntamenti);
}


export type CampaignSummary = {
  campagna: string;
  assegnati: number;
  connessioni: number;
  appuntamenti: number;
  noShow: number;
  consulenze: number;
  chiusure: number;
  boom: number;
};

export function aggregateByCampagna(
  operatori: OperatoriNormalized[]
): CampaignSummary[] {
  const map = new Map<
    string,
    {
      assegnati: number;
      connessioni: number;
      appuntamenti: number;
      noShow: number;
      consulenze: number;
      chiusure: number;
      boom: number;
    }
  >();

  const ensure = (key: string) =>
    map.get(key) ?? {
      assegnati: 0,
      connessioni: 0,
      appuntamenti: 0,
      noShow: 0,
      consulenze: 0,
      chiusure: 0,
      boom: 0
    };

  for (const r of operatori) {
    const key = r.campagna || "(vuoto)";
    const cur = ensure(key);
    cur.assegnati += r.assegnati;
    cur.connessioni += r.connessioni;
    cur.appuntamenti += r.appuntamenti;
    cur.noShow += r.noShow;
    cur.consulenze += r.consulenze;
    cur.chiusure += r.chiusure;
    cur.boom += r.boom;
    map.set(key, cur);
  }

  return Array.from(map.entries())
    .map(([campagna, t]) => ({ campagna, ...t }))
    .sort((a, b) => b.appuntamenti - a.appuntamenti);
}

export type ScatterPoint = {
  x: number;
  y: number;
  label: string;
};

export function buildScatterOperatori(
  operatori: OperatoriNormalized[],
  xKey: "reattivitaMin" | "connessioni" | "chiamate" | "assegnati",
  yKey: "connessioni" | "appuntamenti" | "noShow"
): ScatterPoint[] {
  return operatori
    .map((r) => ({
      x: r[xKey],
      y: r[yKey],
      label: `${r.operatore} | ${r.campagna} | ${r.data}`
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export type OperatorKpisAdvanced = {
  efficienzaContatto: number;
  conversioneAppuntamenti: number;
  noShowPct: number;
  indiceProntezza: number;
};

export function computeOperatorKpisAdvanced(t: {
  chiamate: number;
  connessioni: number;
  appuntamenti: number;
  noShow: number;
  reattivitaMinAvg: number;
}): OperatorKpisAdvanced {
  const efficienzaContatto = safeDiv(t.connessioni, t.chiamate);
  const conversioneAppuntamenti = safeDiv(t.appuntamenti, t.connessioni);
  const noShowPct = safeDiv(t.noShow, t.appuntamenti);

  // readiness: higher is better; cap at 1 when reactivity <= 1 min
  const indiceProntezza = t.reattivitaMinAvg > 0 ? Math.min(1, 1 / t.reattivitaMinAvg) : 0;

  return { efficienzaContatto, conversioneAppuntamenti, noShowPct, indiceProntezza };
}

export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

export type ZScoreAnomaly = {
  key: string;
  metric: string;
  value: number;
  z: number;
};

export function zScoreAnomalies(values: Array<{ key: string; value: number }>, metric: string) {
  const xs = values.map((v) => v.value).filter((v) => Number.isFinite(v));
  if (xs.length < 5) return [] as ZScoreAnomaly[];

  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / xs.length;
  const std = Math.sqrt(variance);
  if (std === 0) return [] as ZScoreAnomaly[];

  return values
    .map((v) => ({
      key: v.key,
      metric,
      value: v.value,
      z: (v.value - mean) / std
    }))
    .filter((a) => Math.abs(a.z) >= 2.0)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}
