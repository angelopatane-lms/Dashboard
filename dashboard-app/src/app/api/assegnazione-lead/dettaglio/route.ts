import { NextRequest, NextResponse } from "next/server";
import { leggiGiorno } from "@/lib/assegnazioni/giorno";
import { leggiRichieste } from "@/lib/assegnazioni/richieste";

/**
 * Chi ha ricevuto lead oggi, e quanti.
 *
 * PERCHE' NON LA CHIEDE ALL'APP. L'app di assegnazione sa tutto questo meglio
 * di noi - e' lei che assegna - ma il suo database gira sul suo server e da
 * Vercel non si raggiunge: `host.docker.internal`. Esporlo su internet per
 * alimentare un riquadro sarebbe un prezzo sbagliato: li' dentro ci sono anche
 * incassi e commissioni. Quindi il dettaglio si ricostruisce da HubSpot, che
 * la stessa informazione ce l'ha gia'.
 *
 * COSA CHIEDE ALL'APP, invece: il totale che dichiara di se'. Serve da
 * controprova, non da fonte. Due numeri che arrivano per strade diverse e
 * coincidono valgono piu' di uno solo; e quando divergono, la pagina lo dice.
 *
 * PERCHE' NON E' FRA LE API RIDOTTE. Da `/api/assegnazione-lead` si accendono
 * e spengono le assegnazioni vere. Questo indirizzo e' di sola lettura, ma
 * racconta quanti lead ha preso ogni persona: non e' materiale da pagina
 * pubblica. Resta dietro la password piena, come il resto della sezione.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const STATO_APP =
  process.env.LMS_ASSEGNAZIONI_URL ||
  "https://lms.217.154.117.118.nip.io/dispatch-api/assegnazione-stato";

/**
 * Il totale dichiarato dall'app, se risponde.
 *
 * NON FALLISCE MAI IL REPORT: se l'app non risponde il dettaglio da HubSpot
 * resta valido, perde solo la controprova. Restituire null e dirlo e' meglio
 * che non mostrare niente.
 */
async function attesoDallApp(): Promise<number | null> {
  const token = process.env.LMS_ASSEGNAZIONI_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(STATO_APP, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { assegnati_oggi?: unknown };
    return typeof d.assegnati_oggi === "number" ? d.assegnati_oggi : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // `giorno=AAAA-MM-GG` per rileggere una giornata passata dall'archivio.
  // Senza, oggi.
  const chiesto = req.nextUrl.searchParams.get("giorno");
  const giorno = chiesto && /^\d{4}-\d{2}-\d{2}$/.test(chiesto) ? new Date(`${chiesto}T12:00:00`) : undefined;
  const forza = req.nextUrl.searchParams.get("forza") === "1";

  try {
    // LA CONTROPROVA VALE SOLO PER OGGI. L'app dichiara il totale CORRENTE, e
    // confrontarlo con una giornata passata accosta due numeri che parlano di
    // giorni diversi: la pagina annuncerebbe una divergenza inesistente. Per i
    // giorni passati si usa il valore conservato insieme alla fotografia, che
    // e' quello giusto perche' fu preso in quel momento.
    const atteso = giorno ? undefined : await attesoDallApp();
    const esito = await leggiGiorno(token, { giorno, atteso, forza });

    // LE RICHIESTE NON PASSANO DALLA FOTOGRAFIA: arrivano dalla nostra banca
    // dati, costano una query e non una trentina di chiamate a HubSpot. Si
    // leggono fresche anche quando il dettaglio viene dall'archivio, perche'
    // un rifiuto arrivato un minuto fa deve comparire subito.
    const richieste = await leggiRichieste(chiesto ?? undefined).catch((e) => {
      // Non fa cadere il resto: il dettaglio da HubSpot resta valido anche se
      // questa meta' non si legge, e la pagina lo dice invece di fingere che
      // non ci siano state richieste.
      console.error("[assegnazione-lead/dettaglio] richieste:", e);
      return null;
    });

    return NextResponse.json(
      { ...esito, richieste },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[assegnazione-lead/dettaglio]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "errore imprevisto" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
