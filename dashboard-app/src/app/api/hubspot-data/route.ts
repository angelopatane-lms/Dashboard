import { NextRequest, NextResponse } from "next/server";

const BOOM_OBJECT_ID = "2-130365112";
const HUBSPOT_API = "https://api.hubapi.com";

export type RawBoomRecord = {
  operatore: string;
  tipologia_di_incasso: string;
  importo: number;
  tipo_di_vendita: string;
  prodotto: string;
  id_campagna_track: string;
  data_di_pagamento_ms: number;
};

export type RawDealRecord = {
  operatore: string;
  id_campagna_track: string;
  createdate_ms: number;
};

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
      console.warn(`[hubspot-data] 429 rate limit, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const err = await res.text();
    throw new Error(`HubSpot search ${res.status}: ${err}`);
  }
  throw new Error("Max retries exceeded");
}

async function fetchBoomRecords(
  token: string,
  fromMs: number,
  toMs: number,
  ownerMap: Record<string, string>
): Promise<RawBoomRecord[]> {
  const records: RawBoomRecord[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "data_di_pagamento", operator: "GTE", value: String(fromMs) },
          { propertyName: "data_di_pagamento", operator: "LTE", value: String(toMs) }
        ]
      }],
      properties: ["data_di_pagamento", "tipologia_di_incasso", "importo", "hubspot_owner_id", "id_campagna_track", "tipo_di_vendita", "prodotto"],
      limit: 100,
      ...(after ? { after } : {})
    };

    const data = await searchWithRetry(token, `${HUBSPOT_API}/crm/v3/objects/${BOOM_OBJECT_ID}/search`, body);

    for (const r of data.results ?? []) {
      const p = r.properties;
      const operatore = ownerMap[(p.hubspot_owner_id ?? "").trim()] ?? "";
      if (!operatore) continue;
      records.push({
        operatore,
        tipologia_di_incasso: p.tipologia_di_incasso ?? "",
        importo: parseFloat(p.importo ?? "0") || 0,
        tipo_di_vendita: (p.tipo_di_vendita ?? "").trim(),
        prodotto: (p.prodotto ?? "").trim(),
        id_campagna_track: p.id_campagna_track ?? "",
        data_di_pagamento_ms: parseInt(p.data_di_pagamento ?? "0") || 0
      });
    }
    after = data.paging?.next?.after;
    if (after) await new Promise((r) => setTimeout(r, 200));
  } while (after);

  return records;
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
    const boomRecords = await fetchBoomRecords(token, fromMs, toMs, ownerMap);
    const uniqueOperatori = [...new Set(boomRecords.map((r) => r.operatore || "(empty)"))].slice(0, 8);
    const uniqueTipologie = [...new Set(boomRecords.map((r) => r.tipologia_di_incasso || "(empty)"))];
    console.log(`[hubspot-data] boom:${boomRecords.length} | operatori:${uniqueOperatori.join(" / ")} | tipologie:${uniqueTipologie.join(" / ")}`);

    return NextResponse.json(
      { boomRecords },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[hubspot-data]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
