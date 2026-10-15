import { NextResponse } from "next/server";
import { campagneAssegnabili } from "@/lib/assegnazioni/categorie";

/**
 * Le campagne che il serbatoio contiene davvero, per il menu delle escluse.
 *
 * PRIMA C'ERANO LE LIVE, cioe' 119 campagne su 5.206: dentro ce n'erano di
 * spente da mesi, e fuori restavano tutte le 485 evergreen - che quindi non si
 * potevano escludere, pur essendo fra quelle da cui arrivano lead.
 *
 * ADESSO SI OFFRE QUELLO CHE C'E': ogni voce porta quanti contatti assegnabili
 * ha in questo momento. Una campagna che non ne ha non compare, perche'
 * escluderla non cambierebbe niente, e il giorno in cui ne avesse comparirebbe
 * da sola.
 *
 * NON COSTA UNA LETTURA IN PIU': e' lo stesso giro che conta le categorie del
 * serbatoio, con una raccolta in piu' dentro lo stesso ciclo.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json(
      { campagne: [], errore: "HUBSPOT_PRIVATE_APP_TOKEN non impostata" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const campagne = await campagneAssegnabili(token);
    return NextResponse.json({ campagne }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[campagne-serbatoio]", e);
    // ELENCO VUOTO E NON ERRORE: la sezione deve restare usabile, con le
    // campagne gia' scelte al loro posto.
    return NextResponse.json(
      { campagne: [], errore: "lettura del serbatoio non riuscita" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
