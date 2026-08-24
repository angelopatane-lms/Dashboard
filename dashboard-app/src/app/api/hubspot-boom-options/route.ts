import { NextRequest, NextResponse } from "next/server";

const OBJECT_TYPE_ID = "2-130365112";
const HUBSPOT_API = "https://api.hubapi.com";

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "Missing from or to params" }, { status: 400 });
  }

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to + "T23:59:59.999Z").getTime();

  const vendite = new Set<string>();
  const prodotti = new Set<string>();
  let after: string | undefined;

  try {
    do {
      const body: Record<string, unknown> = {
        filterGroups: [
          {
            filters: [
              { propertyName: "data_di_pagamento", operator: "GTE", value: String(fromMs) },
              { propertyName: "data_di_pagamento", operator: "LTE", value: String(toMs) }
            ]
          }
        ],
        properties: ["tipo_di_vendita", "prodotto"],
        limit: 100,
        ...(after ? { after } : {})
      };

      const res = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/${OBJECT_TYPE_ID}/search`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HubSpot search error ${res.status}: ${err}`);
      }

      const data = await res.json();
      for (const r of data.results ?? []) {
        const v = (r.properties?.tipo_di_vendita ?? "").trim();
        const p = (r.properties?.prodotto ?? "").trim();
        if (v) vendite.add(v);
        if (p) prodotti.add(p);
      }
      after = data.paging?.next?.after;
    } while (after);

    return NextResponse.json(
      {
        vendite: [...vendite].sort(),
        prodotti: [...prodotti].sort()
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[hubspot-boom-options]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
