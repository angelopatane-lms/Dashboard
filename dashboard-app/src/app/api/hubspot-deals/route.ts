import { NextRequest, NextResponse } from "next/server";
import type { RawDealRecord } from "@/app/api/hubspot-data/route";
import { nomiPerRotta } from "@/lib/proprietari";

const DEALS_PIPELINE_ID = "433643709";
const HUBSPOT_API = "https://api.hubapi.com";

// I nomi dei proprietari arrivano da src/lib/proprietari.ts.
//
// PERCHE' NON PIU' IN LOCALE. La versione precedente chiamava
// /crm/v3/owners?limit=500 senza `archived=true`, e quell'endpoint esclude di
// default gli utenti DISATTIVATI: leggeva 76 proprietari invece di 496. Ogni
// ex dipendente restava senza nome, e siccome il codice ricade sull'id quando
// il nome manca, in tabella compariva un numero - che non combacia con nessuna
// riga del foglio Operatori, quindi il suo lavoro spariva dal conteggio. Su un
// solo mese erano sette persone, fra cui chi aveva fissato 38 appuntamenti poi
// disertati.

async function searchWithRetry(
  token: string,
  url: string,
  body: Record<string, unknown>
): Promise<{ results: Array<{ properties: Record<string, string | null> }>; paging?: { next?: { after: string } } }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) {
      const wait = 1000 * (attempt + 1);
      console.warn(`[hubspot-deals] 429 rate limit, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const err = await res.text();
    throw new Error(`HubSpot search ${res.status}: ${err}`);
  }
  throw new Error("Max retries exceeded");
}

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to + "T23:59:59.999Z").getTime();

  try {
    const ownerMap = await nomiPerRotta(token);
    const records: RawDealRecord[] = [];
    let after: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filterGroups: [{
          filters: [
            { propertyName: "createdate", operator: "GTE", value: String(fromMs) },
            { propertyName: "createdate", operator: "LTE", value: String(toMs) },
            { propertyName: "pipeline", operator: "EQ", value: DEALS_PIPELINE_ID }
          ]
        }],
        properties: ["setter", "hubspot_owner_id", "id_campagna_track", "createdate"],
        limit: 100,
        ...(after ? { after } : {})
      };

      const data = await searchWithRetry(token, `${HUBSPOT_API}/crm/v3/objects/deals/search`, body);

      const rawResults = data.results ?? [];
      for (const r of rawResults) {
        const p = r.properties;
        const setterId = (p.setter ?? "").trim() || (p.hubspot_owner_id ?? "").trim();
        const operatore = ownerMap[setterId] ?? setterId;
        if (!operatore) continue;
        const rawDate = p.createdate ?? "";
        const createdate_ms = rawDate
          ? (/^\d+$/.test(rawDate) ? parseInt(rawDate) : new Date(rawDate).getTime())
          : 0;
        records.push({
          operatore,
          id_campagna_track: p.id_campagna_track ?? "",
          createdate_ms
        });
      }

      after = data.paging?.next?.after;
      if (after) await new Promise((r) => setTimeout(r, 200));
    } while (after);

    const uniqueOperatori = [...new Set(records.map((r) => r.operatore || "(empty)"))];
    console.log(`[hubspot-deals] deals:${records.length} | operatori:${uniqueOperatori.join(" / ")}`);
    return NextResponse.json(
      { dealRecords: records },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[hubspot-deals]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
