import { NextRequest, NextResponse } from "next/server";

const OBJECT_TYPE_ID = "2-130365112";
const HUBSPOT_API = "https://api.hubapi.com";

type PropOption = { label: string; value: string };

async function getPropertyOptions(token: string, propName: string): Promise<PropOption[]> {
  const res = await fetch(
    `${HUBSPOT_API}/crm/v3/properties/${OBJECT_TYPE_ID}/${propName}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data.options) || data.options.length === 0) return [];
  return (data.options as Array<{ label?: string; value?: string }>)
    .map((o) => ({ label: o.label ?? o.value ?? "", value: o.value ?? o.label ?? "" }))
    .filter((o) => o.value)
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function getProdottiFromRecords(
  token: string,
  from: string,
  to: string
): Promise<PropOption[]> {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to + "T23:59:59.999Z").getTime();
  const values = new Set<string>();
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "data_di_pagamento", operator: "GTE", value: String(fromMs) },
          { propertyName: "data_di_pagamento", operator: "LTE", value: String(toMs) }
        ]
      }],
      properties: ["prodotto"],
      limit: 100,
      ...(after ? { after } : {})
    };
    const res = await fetch(
      `${HUBSPOT_API}/crm/v3/objects/${OBJECT_TYPE_ID}/search`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    if (!res.ok) break;
    const data = await res.json();
    for (const r of data.results ?? []) {
      const v = (r.properties?.prodotto ?? "").trim();
      if (v) values.add(v);
    }
    after = data.paging?.next?.after;
  } while (after);

  return [...values].sort().map((v) => ({ label: v, value: v }));
}

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    const prodottiPromise =
      from && to
        ? getProdottiFromRecords(token, from, to)
        : Promise.resolve<PropOption[]>([]);

    const [vendite, prodotti] = await Promise.all([
      getPropertyOptions(token, "tipo_di_vendita"),
      prodottiPromise
    ]);

    return NextResponse.json(
      { vendite, prodotti },
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
