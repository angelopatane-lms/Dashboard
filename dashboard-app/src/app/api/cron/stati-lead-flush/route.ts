import { NextRequest, NextResponse } from "next/server";
import { sincronizzaStatiLead, daDoveRipartire } from "@/lib/statiLead/sync";

/**
 * Lo scarico degli Stati Lead accumulati nell'ultimo quarto d'ora.
 *
 * CHI LO CHIAMA: QStash, su prenotazione del webhook - vedi
 * src/lib/statiLead/prenota.ts per il perche'. Se nel quarto d'ora non e'
 * cambiato nessuno Stato Lead, qui non arriva nessuno e il database resta
 * spento: e' tutto il senso dell'operazione.
 *
 * PERCHE' IL GIRO COMPLETO E NON IL SINGOLO CONTATTO. Il webhook sapeva quale
 * contatto era cambiato e rileggeva quello. Qui si riparte da `daDoveRipartire()`
 * e si rileggono i contatti dei quattro advisor telefonici modificati da
 * allora: costa qualche chiamata a HubSpot in piu', ma recupera anche gli
 * eventi il cui webhook e' andato perso - un rilascio, un minuto di
 * irraggiungibilita' - che prima restavano buchi fino al giro notturno.
 *
 * NON OSSERVA I TEAM, al contrario di /api/cron/stati-lead: quella e' una
 * fotografia giornaliera e farla quaranta volte al giorno riempirebbe
 * utente_team_storia di righe identiche.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });

  const scrivi = req.nextUrl.searchParams.get("prova") !== "1";

  try {
    const da = await daDoveRipartire();
    const esito = await sincronizzaStatiLead({ token, da, scrivi });
    console.log(
      `[cron/stati-lead-flush] dal ${esito.da}: ${esito.ingressi} ingressi | ` +
        esito.advisor.map((a) => `${a.nome} ${a.ingressi}/${a.contatti}`).join(", ")
    );
    return NextResponse.json({ ...esito, scrittura: scrivi });
  } catch (e) {
    console.error("[cron/stati-lead-flush]", e);
    return NextResponse.json({ errore: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
