import { NextResponse } from "next/server";
import {
  assegnatiOggiInArchivio,
  ricalcolaAssegnatiOggi,
  FRESCHEZZA_MINUTI
} from "@/lib/assegnatiOggi";

/**
 * Rinfresca il conto degli assegnati di oggi, se e' scaduto.
 *
 * PERCHE' UNA ROTTA E NON LA PAGINA. Il conto vero sono una quarantina di
 * chiamate a HubSpot - i contatti passati di mano oggi, piu' la cronologia del
 * campo proprietario a lotti di cinquanta - e una ventina di secondi. Su un
 * caricamento di pagina non si possono spendere: la pagina legge l'archivio e
 * basta, e a tenerlo fresco e' il browser che chiama qui mentre l'utente
 * guarda la tabella. Al caricamento dopo i numeri sono quelli nuovi.
 *
 * NON E' UN CRON PERCHE' NON SERVE: se nessuno guarda la dashboard, nessuno ha
 * bisogno del parziale di oggi. E il piano Vercel non accetta comunque cron
 * piu' frequenti di uno al giorno.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const archivio = await assegnatiOggiInArchivio();
  if (archivio && !archivio.vecchia) {
    return NextResponse.json(
      { totale: archivio.totale, presoAt: archivio.presoAt, rifatto: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    // 200 E NON 500: senza questo conto la tabella mostra i numeri del foglio,
    // che e' il comportamento di sempre. Non e' un guasto, e' una fonte in meno.
    return NextResponse.json(
      { totale: archivio?.totale ?? null, perche: "HUBSPOT_PRIVATE_APP_TOKEN non impostata" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const fresco = await ricalcolaAssegnatiOggi(token);
    return NextResponse.json(
      {
        totale: fresco.totale,
        presoAt: fresco.presoAt,
        rifatto: true,
        persone: Object.keys(fresco.conteggi).length,
        scadeTraMinuti: FRESCHEZZA_MINUTI
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/assegnati-oggi]", e);
    // SI TIENE QUELLO CHE C'E': un errore di rete non deve svuotare la colonna.
    return NextResponse.json(
      {
        totale: archivio?.totale ?? null,
        presoAt: archivio?.presoAt ?? null,
        perche: "ricalcolo non riuscito"
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
