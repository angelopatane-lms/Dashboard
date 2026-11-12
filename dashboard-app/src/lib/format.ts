export function formatInt(n: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(n);
}

export function formatFloat(n: number, digits = 1): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(n);
}

export function formatPct(n: number, digits = 1): string {
  return `${formatFloat(n * 100, digits)}%`;
}

export function formatEur(n: number, digits = 0): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(n);
}

/**
 * Minuti in ore e minuti: "47 min", "2h 20m", "15h".
 *
 * Il tempo di risposta si misura in minuti ma si legge in ore: "140,5 min"
 * non dice niente a chi guarda, "2h 20m" si capisce al volo.
 */
export function formatDurata(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0 min";
  const tot = Math.round(min);
  if (tot < 60) return `${tot} min`;
  const ore = Math.floor(tot / 60);
  const resto = tot % 60;
  return resto ? `${ore}h ${resto}m` : `${ore}h`;
}
