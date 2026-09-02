import { NextRequest, NextResponse } from "next/server";
import { eseguiSync } from "@/lib/campaignConversions/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Giro di reconciliazione (bootstrap iniziale + rete di sicurezza settimanale).
// Riprocessa i contatti con stato_lead rilevante (Nuovo/Riconvertito/Webinar),
// non solo quelli segnalati come "modificati di recente".
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });

  try {
    const risultato = await eseguiSync("full", token);
    return NextResponse.json(risultato);
  } catch (err) {
    console.error("[cron/campaign-conversions-full]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
