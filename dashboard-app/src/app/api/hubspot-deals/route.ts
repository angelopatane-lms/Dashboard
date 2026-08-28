import { NextRequest, NextResponse } from "next/server";
import type { RawDealRecord } from "@/app/api/hubspot-data/route";

const DEALS_PIPELINE_ID = "433643709";
const HUBSPOT_API = "https://api.hubapi.com";

async function fetchOwners(token: string): Promise<Record<string, string>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/owners?limit=500`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Owners error ${res.status}`);
  const data = await res.json();
  const map: Record<string, string> = {};
  for (const o of data.results ?? []) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ");
    if (o.id && name) map[String(o.id)] = name;
  }
  return map;
}

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
    const ownerMap = await fetchOwners(token);
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
      if (records.length === 0) {
        console.log(`[hubspot-deals] first page: ${rawResults.length} results, sample createdate: ${rawResults[0]?.properties?.createdate}`);
      }
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

    console.log(`[hubspot-deals] ${records.length} deal records`);
    return NextResponse.json(
      { dealRecords: records },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[hubspot-deals]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
