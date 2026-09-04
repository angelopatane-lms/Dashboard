import { NextRequest, NextResponse } from "next/server";
import { eseguiSync } from "@/lib/campaignConversions/sync";
import { sincronizzaTrattative } from "@/lib/trattative/sync";
import { sincronizzaChiamate } from "@/lib/chiamate/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Giro orario: aggiorna le tre sorgenti che alimentano la pagina Campagne.
//
//   conversioni -> Lead Generati e Lead Unici
//   trattative  -> Consulenze
//   chiamate    -> Chiamate e Connessioni
//
// Le tre sincronizzazioni sono INDIPENDENTI di proposito: se una fallisce le
// altre devono comunque girare, altrimenti un guasto su HubSpot in un'area
// bloccherebbe tutto il resto. L'esito di ciascuna torna nella risposta, e la
// richiesta e' considerata fallita solo se falliscono tutte.
//
// Tutte ancorano la finestra all'ultima esecuzione RIUSCITA, non a "un'ora fa":
// un giro saltato viene recuperato dal successivo senza lasciare buchi.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });

  const nomi = ["conversioni", "trattative", "chiamate"] as const;
  const esiti = await Promise.allSettled([
    eseguiSync("incrementale", token),
    sincronizzaTrattative(token, "incrementale"),
    sincronizzaChiamate(token, "incrementale")
  ]);

  const risposta: Record<string, unknown> = {};
  esiti.forEach((e, i) => {
    const nome = nomi[i];
    if (e.status === "fulfilled") {
      risposta[nome] = e.value;
      if ((e.value as { troncato?: boolean }).troncato) {
        console.warn(`[cron/${nome}] giro troncato: finestra troppo ampia, serve un bootstrap manuale`);
      }
    } else {
      risposta[nome] = { errore: e.reason instanceof Error ? e.reason.message : String(e.reason) };
      console.error(`[cron/${nome}]`, e.reason);
    }
  });

  const tutteFallite = esiti.every((e) => e.status === "rejected");
  return NextResponse.json(risposta, { status: tutteFallite ? 500 : 200 });
}
