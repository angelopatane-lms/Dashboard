import Papa from "papaparse";

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors?.length) {
    const message = parsed.errors.map((e) => e.message).join("; ");
    throw new Error(message);
  }

  return (parsed.data ?? []).filter((row) => Object.keys(row).length > 0);
}

export async function fetchCsv(url: string, init?: RequestInit): Promise<CsvRow[]> {
  const nextInit = (init as RequestInit & { next?: { revalidate?: number } } | undefined)?.next;

  const res = await fetch(url, {
    ...init,
    ...(init?.cache ? { cache: init.cache } : {}),
    next: {
      revalidate: 300,
      ...(nextInit ?? {})
    },
    headers: {
      ...(init?.headers ?? {}),
      accept: "text/csv"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${res.statusText})`);
  }

  const text = await res.text();
  return parseCsv(text);
}
