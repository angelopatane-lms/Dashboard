import { NextRequest, NextResponse } from "next/server";
import { assegnabili } from "@/lib/assegnazioni/pool";

/**
 * Lo sportello verso l'app Employee Manager, che assegna i contatti.
 *
 * PERCHE' PASSA DA QUI E NON DAL BROWSER. Il segreto condiviso con quell'app
 * sta in una variabile d'ambiente e non deve mai arrivare alla pagina: se la
 * chiamata partisse dal browser, chiunque apra gli strumenti per sviluppatori
 * se lo porterebbe via, e con quello potrebbe accendere e spegnere le
 * assegnazioni da fuori. Il browser chiama questa rotta, questa rotta chiama
 * l'app.
 *
 * PERCHE' NON UN RIQUADRO CON L'APP DENTRO, che era la richiesta iniziale:
 * provato il 5 ottobre 2026, dentro compare il login. Il cookie di sessione di
 * quell'app non e' marcato `SameSite=None`, quindi il browser non lo manda - ne'
 * lo accetta - quando la pagina sta dentro un riquadro servito da un altro
 * indirizzo. Si sistemava marcando il cookie, ma quell'app non ha protezione
 * CSRF e oggi il SameSite e' l'unica difesa che ha.
 *
 * CHI PUO' CHIAMARLA. Non c'e' un controllo qui dentro: ci pensa il middleware,
 * che lascia passare solo la password piena su tutto quello che non e'
 * esplicitamente elencato come ridotto. Non aggiungere questo indirizzo a
 * `API_RIDOTTE` in src/middleware.ts: da qui si accendono le assegnazioni vere.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * SOTTO /dispatch-api/ E NON /api/, che sarebbe stato il nome ovvio: su quel
 * server traefik instrada tutto `/api/*` verso un'altra applicazione, che
 * risponde al posto di questa. Verificato il 5 ottobre 2026 - `/api/qualunque`
 * torna un 404 in JSON che Flask non produce, `/dispatch-api/qualunque` torna
 * il 404 HTML di Flask. Una rotta sotto /api/ li' non si raggiunge.
 */
const INDIRIZZO =
  process.env.LMS_ASSEGNAZIONI_URL ||
  "https://lms.217.154.117.118.nip.io/dispatch-api/assegnazione-stato";

function senzaSegreto() {
  return NextResponse.json(
    { error: "LMS_ASSEGNAZIONI_TOKEN non impostato: la sezione resta in sola lettura" },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

async function chiama(metodo: "GET" | "POST", corpo?: unknown) {
  const token = process.env.LMS_ASSEGNAZIONI_TOKEN;
  if (!token) return senzaSegreto();

  try {
    const r = await fetch(INDIRIZZO, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo ? { "Content-Type": "application/json" } : {})
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      cache: "no-store",
      // Quell'app interroga HubSpot per contare i due serbatoi: dieci secondi
      // di suo piu' il giro di rete. Oltre i venti e' meglio un messaggio che
      // una pagina che gira a vuoto.
      signal: AbortSignal.timeout(20_000)
    });
    const dati = await r.json().catch(() => ({ error: `risposta non leggibile (${r.status})` }));
    return NextResponse.json(dati, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // L'errore vero serve a chi guarda i registri; a chi guarda la pagina basta
    // sapere che l'app non risponde, perche' non puo' farci niente.
    console.error("[assegnazione-lead]", e);
    return NextResponse.json(
      { error: "L'app Assegnazione Lead non risponde" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function GET() {
  const risposta = await chiama("GET");

  // GLI ASSEGNABILI ACCANTO AL GREZZO. Il serbatoio che dichiara l'app conta
  // tutti i contatti senza proprietario; quelli che si possono davvero dare
  // sono molti meno - l'8 ottobre 2026, 525 su 38.299 - perche' l'eta' massima
  // ne taglia il 98%. Mostrare solo il grezzo faceva sembrare pieno un
  // serbatoio che si stava svuotando.
  //
  // NON COSTA DUE CHIAMATE AL MINUTO: il conteggio si riusa per cinque minuti,
  // e la riga che lo conserva e' anche la fotografia dell'andamento.
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token || risposta.status !== 200) return risposta;

  try {
    const dati = (await risposta.clone().json()) as Record<string, unknown>;
    const quanti = await assegnabili(token, dati);
    // null quando HubSpot non ha risposto: si lascia fuori il campo invece di
    // scrivere zero, che si leggerebbe come "non c'e' piu' niente".
    if (!quanti) return risposta;
    return NextResponse.json(
      {
        ...dati,
        // SOLO SE MISURATI. Un conteggio mancato non deve comparire come zero:
        // lasciando fuori il campo, la card mostra il serbatoio grezzo come
        // faceva prima che questi numeri esistessero.
        ...(quanti.serieA != null ? { assegnabili_a: quanti.serieA } : {}),
        ...(quanti.serieB != null ? { assegnabili_b: quanti.serieB } : {})
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    // Non fa cadere la sezione: senza questi due numeri funziona come prima.
    console.error("[assegnazione-lead] assegnabili:", e);
    return risposta;
  }
}

export async function POST(req: NextRequest) {
  const dati = await req.json().catch(() => ({}));
  const comando: Record<string, boolean | string> = {};
  // Si passa SOLO quello che si riconosce: un corpo inatteso non deve
  // arrivare intero all'altra applicazione.
  if (typeof dati.sistema === "boolean") comando.sistema = dati.sistema;
  if (typeof dati.feriali === "boolean") comando.feriali = dati.feriali;
  if (typeof dati.weekend === "boolean") comando.weekend = dati.weekend;
  if (typeof dati.campagne_sospese_attivo === "boolean") {
    comando.campagne_sospese_attivo = dati.campagne_sospese_attivo;
  }
  // L'unico campo di testo: si taglia a una lunghezza ragionevole perche'
  // finisce in una riga di app_settings, e non deve poterla riempire.
  if (typeof dati.campagne_sospese === "string") {
    comando.campagne_sospese = dati.campagne_sospese.slice(0, 2000);
  }
  if (Object.keys(comando).length === 0) {
    return NextResponse.json({ error: "nessun comando riconosciuto" }, { status: 400 });
  }
  return chiama("POST", comando);
}
