import { NextRequest, NextResponse } from "next/server";

const OBJECT_TYPE_ID = "2-130365112";
const HUBSPOT_API = "https://api.hubapi.com";

const CHIUSURE_TIPOLOGIE = ["Acconto", "Quota unica"];
const BOOM_TIPOLOGIE = ["Acconto", "Rata", "Quota unica", "Upgrade"];

type BoomRecord = {
  properties: {
    data_di_pagamento: string | null;
    tipologia_di_incasso: string | null;
    importo: string | null;
    hubspot_owner_id: string | null;
  };
};

async function fetchAllBoom(token: string, from: string, to: string): Promise<BoomRecord[]> {
  const results: BoomRecord[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            { propertyName: "data_di_pagamento", operator: "GTE", value: from },
            { propertyName: "data_di_pagamento", operator: "LTE", value: to }
          ]
        }
      ],
      properties: ["data_di_pagamento", "tipologia_di_incasso", "importo", "hubspot_owner_id"],
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
    results.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  return results;
}

async function fetchOwners(token: string): Promise<Record<string, string>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/owners/?limit=500`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) throw new Error(`HubSpot owners error ${res.status}`);

  const data = await res.json();
  const map: Record<string, string> = {};
  for (const owner of data.results ?? []) {
    const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ");
    if (owner.id && name) map[String(owner.id)] = name;
  }
  return map;
}

export type HubspotBoomEntry = {
  operatore: string;
  chiusure: number;
  boom: number;
};

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

  try {
    const [records, ownerMap] = await Promise.all([
      fetchAllBoom(token, from, to),
      fetchOwners(token)
    ]);

    const agg = new Map<string, { chiusure: number; boom: number }>();

    for (const record of records) {
      const p = record.properties;
      const ownerId = p.hubspot_owner_id ?? "";
      const operatore = ownerMap[ownerId] ?? ownerId;
      const tipologia = p.tipologia_di_incasso ?? "";
      const importo = parseFloat(p.importo ?? "0") || 0;

      const cur = agg.get(operatore) ?? { chiusure: 0, boom: 0 };

      if (CHIUSURE_TIPOLOGIE.includes(tipologia)) {
        cur.chiusure += 1;
      }
      if (BOOM_TIPOLOGIE.includes(tipologia)) {
        cur.boom += importo;
      }

      agg.set(operatore, cur);
    }

    const result: HubspotBoomEntry[] = Array.from(agg.entries()).map(
      ([operatore, v]) => ({ operatore, ...v })
    );

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (err) {
    console.error("[hubspot-boom]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
