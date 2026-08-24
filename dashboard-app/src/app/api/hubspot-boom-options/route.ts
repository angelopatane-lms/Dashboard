import { NextResponse } from "next/server";

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

export async function GET() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });
  }

  try {
    const [vendite, prodotti] = await Promise.all([
      getPropertyOptions(token, "tipo_di_vendita"),
      getPropertyOptions(token, "prodotto")
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
