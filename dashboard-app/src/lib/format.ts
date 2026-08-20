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

export function formatEur(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
