import { NextResponse } from "next/server";
import { categorieAssegnabili, MAX_CATEGORIE } from "@/lib/assegnazioni/categorie";

/**
 * Le categorie con quanti contatti hanno, da sole.
 *
 * SEPARATE DALLE PERSONE PERCHE' COSTANO TUTT'ALTRO. L'elenco delle persone
 * arriva dall'app in mezzo secondo; questi numeri si contano enumerando il
 * serbatoio su HubSpot, una ventina di chiamate, sette secondi e mezzo
 * misurati. Finche' le due cose viaggiavano insieme, aprire la scheda
 * significava guardare un rettangolo bianco alto mille pixel con scritto
 * "lettura delle persone e delle categorie..." - e il vuoto si vedeva proprio
 * nel momento in cui si apriva.
 *
 * Adesso la pagina chiede le due cose insieme e disegna l'elenco appena
 * arriva: i sei riquadri si riempiono dopo, al loro ritmo.
 *
 * SI PAGA UNA VOLTA OGNI MEZZ'ORA, non a ogni apertura: il conteggio si tiene
 * in caldo dentro `categorieAssegnabili`.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    // ELENCO VUOTO E NON ERRORE: senza i numeri la scheda funziona lo stesso -
    // si vedono le persone e le preferenze gia' impostate - e far cadere tutto
    // per i riquadri sarebbe sproporzionato.
    return NextResponse.json(
      { categorie: [], massimo: MAX_CATEGORIE },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const categorie = await categorieAssegnabili(token);
    return NextResponse.json(
      { categorie, massimo: MAX_CATEGORIE },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[campagne-persona/categorie]", e);
    return NextResponse.json(
      { categorie: [], massimo: MAX_CATEGORIE },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
