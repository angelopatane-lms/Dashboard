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

function swapOptionsByLabel(opts: PropOption[], labelA: string, labelB: string): PropOption[] {
  const result = [...opts];
  const idxA = result.findIndex((o) => o.label === labelA);
  const idxB = result.findIndex((o) => o.label === labelB);
  if (idxA !== -1 && idxB !== -1) [result[idxA], result[idxB]] = [result[idxB], result[idxA]];
  return result;
}

export async function GET() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });
  }

  try {
    const venditeRaw = await getPropertyOptions(token, "tipo_di_vendita");
    const vendite = swapOptionsByLabel(venditeRaw, "Contatto Personale", "Telefonica");
    return NextResponse.json(
      { vendite },
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
