import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HUBSPOT_API = "https://api.hubapi.com";
const MIN = 60_000;

/**
 * Le ore di consulenza per advisor, in un periodo.
 *
 * SERVE ALLA COLONNA "RESA" della tabella Advisor, che divide l'incasso per le
 * ore lavorate. L'incasso c'e' gia' - e' la colonna Boom, che somma gli importi
 * dell'oggetto BOOM per proprietario - e mancava solo il denominatore.
 *
 * ORE PRENOTATE, NON ORE PARLATE. La durata vera della call la sapremmo da
 * Fireflies, ma oggi solo il 31% delle consulenze svolte lascia una
 * registrazione: sette postazioni su undici non catturano. Un denominatore
 * costruito su quelle durate sarebbe sottostimato del 31% per chi registra e
 * pari a zero per chi non registra, e la colonna direbbe che chi non registra
 * rende all'infinito. La durata dello slot invece c'e' per tutti e sbaglia allo
 * stesso modo per tutti - che su un indicatore di confronto fra persone conta
 * piu' della precisione assoluta. Quando la copertura sara' completa si passa
 * alle durate vere senza toccare la colonna.
 *
 * SI CONTANO SOLO LE CONSULENZE AVVENUTE, non gli appuntamenti fissati: un no
 * show non e' un'ora lavorata. Il fatto che siano avvenute viene da
 * trattativa.svolta_ts, cioe' dagli stessi criteri del workflow HubSpot che
 * alimentano la colonna Consulenze.
 */

/** La chiave con cui la tabella identifica una persona: stessa normalizzazione
 *  usata per incasso e appuntamenti, altrimenti le righe non si incontrano. */
const chiaveNome = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

type Riunione = { id: string; properties: Record<string, string | null> };

async function hubspot<T>(token: string, percorso: string, corpo?: unknown): Promise<T> {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${HUBSPOT_API}${percorso}`, {
      method: corpo ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(corpo ? { body: JSON.stringify(corpo) } : {})
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} su ${percorso}`);
    return (await res.json()) as T;
  }
  throw new Error(`HubSpot continua a rispondere 429 su ${percorso}`);
}

/** I contatti che hanno avuto una consulenza svolta nel periodo. */
async function contattiConConsulenza(dalle: number, alle: number): Promise<Set<number>> {
  const r = await getDb().query(
    `SELECT DISTINCT COALESCE(a.nuovo_id, t.contact_id) AS id
       FROM trattativa t
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND t.svolta_ts >= $1::timestamptz
        AND t.svolta_ts <  $2::timestamptz`,
    [new Date(dalle).toISOString(), new Date(alle).toISOString()]
  );
  return new Set(r.rows.map((x: { id: number }) => Number(x.id)).filter(Number.isFinite));
}

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "token non impostato" }, { status: 500 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "servono from e to" }, { status: 400 });

  const dalle = Date.parse(`${from}T00:00:00+02:00`);
  const alle = Date.parse(`${to}T23:59:59.999+02:00`);
  if (!Number.isFinite(dalle) || !Number.isFinite(alle)) {
    return NextResponse.json({ error: "date non valide" }, { status: 400 });
  }

  try {
    const riunioni: Riunione[] = [];
    let dopo: string | undefined;
    do {
      const d = await hubspot<{ results?: Riunione[]; paging?: { next?: { after?: string } } }>(
        token,
        "/crm/v3/objects/meetings/search",
        {
          filterGroups: [
            {
              filters: [
                { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(dalle) },
                { propertyName: "hs_meeting_start_time", operator: "LT", value: String(alle) }
              ]
            }
          ],
          properties: ["hs_meeting_start_time", "hs_meeting_end_time", "hubspot_owner_id"],
          limit: 100,
          ...(dopo ? { after: dopo } : {})
        }
      );
      riunioni.push(...(d.results ?? []));
      dopo = d.paging?.next?.after;
    } while (dopo && riunioni.length < 5000);

    const contattiDi = new Map<string, number[]>();
    for (let i = 0; i < riunioni.length; i += 100) {
      const d = await hubspot<{
        results?: Array<{ from: { id: string }; to: Array<{ toObjectId: string | number }> }>;
      }>(token, "/crm/v4/associations/meetings/contacts/batch/read", {
        inputs: riunioni.slice(i, i + 100).map((m) => ({ id: m.id }))
      });
      for (const r of d.results ?? []) {
        contattiDi.set(
          String(r.from?.id),
          (r.to ?? []).map((x) => Number(x.toObjectId)).filter(Number.isFinite)
        );
      }
    }

    const [proprietari, archiviati, svolte] = await Promise.all([
      hubspot<{ results?: Array<Record<string, string>> }>(token, "/crm/v3/owners?limit=500"),
      hubspot<{ results?: Array<Record<string, string>> }>(token, "/crm/v3/owners?limit=500&archived=true"),
      contattiConConsulenza(dalle, alle).catch(() => new Set<number>())
    ]);
    const nomi = new Map<string, string>();
    for (const o of [...(proprietari.results ?? []), ...(archiviati.results ?? [])]) {
      const n = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || String(o.email ?? o.id);
      nomi.set(String(o.id), n);
    }

    const ore: Record<string, number> = {};
    const consulenze: Record<string, number> = {};
    let senzaProprietario = 0;

    for (const m of riunioni) {
      const p = m.properties ?? {};
      const suoi = contattiDi.get(m.id) ?? [];
      if (!suoi.some((c) => svolte.has(c))) continue;

      const inizio = Date.parse(p.hs_meeting_start_time ?? "");
      const fine = Date.parse(p.hs_meeting_end_time ?? "");
      if (!Number.isFinite(inizio)) continue;
      // Senza orario di fine si assume mezz'ora, che e' lo slot piu' frequente:
      // meglio di scartare la riunione, che toglierebbe ore davvero lavorate.
      const durata = Number.isFinite(fine) && fine > inizio ? fine - inizio : 30 * MIN;

      const chi = nomi.get(String(p.hubspot_owner_id ?? ""));
      if (!chi) {
        senzaProprietario += 1;
        continue;
      }
      const k = chiaveNome(chi);
      ore[k] = (ore[k] ?? 0) + durata / (60 * MIN);
      consulenze[k] = (consulenze[k] ?? 0) + 1;
    }

    for (const k of Object.keys(ore)) ore[k] = Math.round(ore[k] * 100) / 100;

    console.log(
      `[advisor-ore] ${from} - ${to}: ${riunioni.length} riunioni, ` +
        `${Object.values(consulenze).reduce((s, n) => s + n, 0)} con consulenza svolta, ` +
        `${Object.keys(ore).length} persone` +
        (senzaProprietario ? `, ${senzaProprietario} senza proprietario` : "")
    );

    return NextResponse.json({ ore, consulenze }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[advisor-ore]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "HubSpot non raggiungibile" }, { status: 502 });
  }
}
