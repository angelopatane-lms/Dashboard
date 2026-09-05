import type { CsvRow } from "@/lib/csv";

export type DatasetKind = "operatori";

export type Filters = {
  from?: string;
  to?: string;
  operatore?: string;
  campagna?: string;
  vendita?: string;
  prodotto?: string;
  /** Solo pagina Campagne: restringe le righe della tabella (es. "con_spesa").
   *  Non filtra le righe del foglio Operatori, agisce a valle sulla tabella. */
  tipologia?: string;
};

export function getString(row: CsvRow, key: string): string {
  return (row[key] ?? "").toString().trim();
}

export function toNumber(value: string): number {
  // Rimuove simboli di valuta, spazi e qualsiasi altro carattere non
  // numerico (es. "€226,99") prima di normalizzare separatori italiani
  // (punto = migliaia, virgola = decimali).
  const cleaned = value.replace(/[^0-9.,-]/g, "");
  const normalized = cleaned.replaceAll(".", "").replaceAll(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function toDateIso(value: string): string {
  const v = value.trim();
  if (!v) return "";

  const vNoTime = v.split(" ")[0] ?? v;

  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (ymd.test(vNoTime)) return vNoTime;

  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const m = vNoTime.match(dmy);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function applyFilters(rows: CsvRow[], filters: Filters): CsvRow[] {
  const from = filters.from ?? "";
  const to = filters.to ?? "";
  const operatore = (filters.operatore ?? "").trim();
  const campagna = (filters.campagna ?? "").trim();

  return rows.filter((r) => {
    const date = toDateIso(getString(r, "Data"));

    if (from && date && date < from) return false;
    if (to && date && date > to) return false;

    if (operatore) {
      const op = getString(r, "Operatore");
      if (op !== operatore) return false;
    }

    if (campagna) {
      const c = getString(r, "Campagna");
      if (c !== campagna) return false;
    }

    return true;
  });
}

export function uniqueValues(rows: CsvRow[], key: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = getString(r, key);
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export type Kpis = {
  assegnati: number;
  chiamate: number;
  connessioni: number;
  appuntamenti: number;
  noShow: number;
  reattivitaMediaMin: number;
  consulenze: number;
  chiusure: number;
  boom: number;
};

export function computeKpis(operatori: CsvRow[]): Kpis {
  const sum = (rows: CsvRow[], key: string) =>
    rows.reduce((acc, r) => acc + toNumber(getString(r, key)), 0);

  const sumFallback = (rows: CsvRow[], primary: string, fallback: string) =>
    rows.reduce((acc, r) => {
      const v = getString(r, primary) || getString(r, fallback);
      return acc + toNumber(v);
    }, 0);

  const assegnati = sum(operatori, "Assegnati");
  const chiamate = sumFallback(operatori, "Chiamati", "Chiamate");
  const connessioni = sumFallback(operatori, "Connessi", "Connessioni");
  const appuntamenti = sum(operatori, "Appuntamenti");
  const noShow = sum(operatori, "No Show");

  const reattivitaValues = operatori
    .map((r) => toNumber(getString(r, "Latenza")))
    .filter((n) => n > 0);
  const reattivitaMediaMin =
    reattivitaValues.length > 0
      ? reattivitaValues.reduce((a, b) => a + b, 0) / reattivitaValues.length
      : 0;

  const consulenze = sum(operatori, "Consulenze");
  const chiusure = sum(operatori, "Chiusure");
  const boom = sum(operatori, "Boom");

  return {
    assegnati,
    chiamate,
    connessioni,
    appuntamenti,
    noShow,
    reattivitaMediaMin,
    consulenze,
    chiusure,
    boom
  };
}
