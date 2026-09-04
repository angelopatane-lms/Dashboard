import { NextRequest, NextResponse } from "next/server";
import { eseguiSync } from "@/lib/campaignConversions/sync";
import { sincronizzaTrattative } from "@/lib/trattative/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Giro orario: aggiorna sia le conversioni dei contatti (Lead Generati e Unici)
// sia le trattative (Consulenze).
//
// Le due sincronizzazioni sono INDIPENDENTI di proposito: se una fallisce
// l'altra deve comunque girare, altrimenti un guasto su HubSpot in un'area
// bloccherebbe anche l'altra. L'esito di entrambe torna nella risposta, e la
// richiesta e' considerata fallita solo se falliscono tutte e due.
//
// Entrambe ancorano la finestra all'ultima esecuzione RIUSCITA, non a "un'ora
// fa": un giro saltato viene recuperato dal successivo senza lasciare buchi.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });

  const esiti = await Promise.allSettled([
    eseguiSync("incrementale", token),
    sincronizzaTrattative(token, "incrementale")
  ]);

  const [conversioni, trattative] = esiti;
  const risposta = {
    conversioni:
      conversioni.status === "fulfilled"
        ? conversioni.value
        : { errore: conversioni.reason instanceof Error ? conversioni.reason.message : String(conversioni.reason) },
    trattative:
      trattative.status === "fulfilled"
        ? trattative.value
        : { errore: trattative.reason instanceof Error ? trattative.reason.message : String(trattative.reason) }
  };

  if (conversioni.status === "rejected") console.error("[cron/conversioni]", conversioni.reason);
  if (trattative.status === "rejected") console.error("[cron/trattative]", trattative.reason);
  if (trattative.status === "fulfilled" && trattative.value.troncato) {
    console.warn(
      "[cron/trattative] giro troncato: la finestra da recuperare e' troppo ampia, serve un bootstrap manuale"
    );
  }

  const entrambeFallite = esiti.every((e) => e.status === "rejected");
  return NextResponse.json(risposta, { status: entrambeFallite ? 500 : 200 });
}
