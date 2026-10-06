import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, livelloDaCookie, paginaDelLivello } from "@/lib/auth";

/**
 * Le rotte che le pagine sotto /pubblico interrogano, e SOLO IN LETTURA.
 *
 * Valgono per entrambi i livelli ridotti: la tabella Advisor e quella Setter
 * sono lo stesso componente e chiedono le stesse cose. Quelle aggiunte dopo
 * - setter-trattative e advisor-telefonici - restituiscono solo conteggi per
 * persona; senza, la tabella Setter perdeva no show e consulenze svolte, e
 * quella Advisor le consulenze fuori CRM e i telefonici.
 *
 * `obiettivi` risponde anche alle scritture: e' la colonna dove si digita
 * l'obiettivo del mese. Sulla pagina ridotta la cella e' gia' di sola lettura,
 * ma l'interfaccia non basta - chi conosce l'indirizzo puo' mandare una POST a
 * mano. Il controllo sul metodo e' quello che tiene davvero.
 */
const API_RIDOTTE = new Set([
  "/api/hubspot-data",
  "/api/hubspot-deals",
  "/api/hubspot-boom-options",
  "/api/obiettivi",
  "/api/setter-trattative",
  "/api/advisor-telefonici"
]);

// Pagine e dati rispondono solo a chi ha fatto l'accesso. Senza accesso:
// - le pagine mostrano la finestra della password (/accesso), senza caricare nulla;
// - le API rispondono 401.
export async function middleware(request: NextRequest) {
  const livello = await livelloDaCookie(request.cookies.get(AUTH_COOKIE)?.value);
  if (livello === "piena") return NextResponse.next();

  const percorso = request.nextUrl.pathname;

  if (livello) {
    // Ogni password ridotta apre la SUA pagina e basta: quella degli Advisor
    // non porta ai Setter, e viceversa.
    const pagina = paginaDelLivello(livello);
    if (percorso === pagina || percorso === `${pagina}/`) return NextResponse.next();
    if (API_RIDOTTE.has(percorso) && request.method === "GET") return NextResponse.next();
    // Chi ha la password ridotta e chiede altro non e' un estraneo: e' entrato
    // e sta bussando dove non gli spetta. Un 403 lo dice; il 401 farebbe
    // ricomparire la finestra della password a chi l'ha appena inserita.
    if (percorso.startsWith("/api/")) {
      return NextResponse.json({ error: "Non consentito con questo accesso" }, { status: 403 });
    }
    return NextResponse.rewrite(new URL(pagina, request.url));
  }

  if (percorso.startsWith("/api/")) {
    return NextResponse.json({ error: "Accesso richiesto" }, { status: 401 });
  }
  return NextResponse.rewrite(new URL("/accesso", request.url));
}

export const config = {
  // Restano fuori solo i file tecnici e le funzioni che hanno già una protezione propria:
  // cron (CRON_SECRET), webhook (firma di HubSpot/Fireflies/Zoom), trascrizione (indirizzo firmato).
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|accesso|api/login|api/cron/|api/webhook/|api/trascrizione/).*)"
  ]
};
