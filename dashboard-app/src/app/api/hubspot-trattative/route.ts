import { NextRequest, NextResponse } from "next/server";

const HUBSPOT_API = "https://api.hubapi.com";
const PIPELINE_ID = "433643709";

async function fetchOwners(token: string): Promise<Record<string, string>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/owners?limit=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return {};
  const data = await res.json();
  const map: Record<string, string> = {};
  for (const o of data.results ?? []) {
    map[String(o.id)] = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
  }
  return map;
}

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const campaign = searchParams.get("campaign") ?? "";

  if (!from || !to) {
    return NextResponse.json({ error: "Missing from or to params" }, { status: 400 });
  }

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to + "T23:59:59.999Z").getTime();

  try {
    const ownerMap = await fetchOwners(token);

    const properties = ["setter", "hubspot_owner_id", "id_campagna_track"];

    const allRecords: Array<{ properties: Record<string, string | null> }> = [];
    let after: string | undefined;

    do {
      const filters: Array<Record<string, string>> = [
        { propertyName: "createdate", operator: "GTE", value: String(fromMs) },
        { propertyName: "createdate", operator: "LTE", value: String(toMs) },
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE_ID },
        ...(campaign ? [{ propertyName: "id_campagna_track", operator: "EQ", value: campaign }] : [])
      ];

      const body: Record<string, unknown> = {
        filterGroups: [{ filters }],
        properties,
        limit: 100,
        ...(after ? { after } : {})
      };

      const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HubSpot search error ${res.status}: ${err}`);
      }

      const data = await res.json();
      allRecords.push(...(data.results ?? []));
      after = data.paging?.next?.after;
    } while (after);

    const agg = new Map<string, number>();

    for (const record of allRecords) {
      const p = record.properties;
      const setterId = (p.setter ?? "").trim() || (p.hubspot_owner_id ?? "").trim();
      if (!setterId) continue;
      const operatore = ownerMap[setterId] ?? setterId;
      if (!operatore) continue;

      agg.set(operatore, (agg.get(operatore) ?? 0) + 1);
    }

    return NextResponse.json(
      [...agg.entries()].map(([operatore, appuntamenti]) => ({ operatore, appuntamenti })),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[hubspot-trattative]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
