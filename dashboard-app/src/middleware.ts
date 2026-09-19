import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthorized } from "@/lib/auth";

// Pagine e dati rispondono solo a chi ha fatto l'accesso. Senza accesso:
// - le pagine mostrano la finestra della password (/accesso), senza caricare nulla;
// - le API rispondono 401.
export async function middleware(request: NextRequest) {
  if (await isAuthorized(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Accesso richiesto" }, { status: 401 });
  }
  return NextResponse.rewrite(new URL("/accesso", request.url));
}

export const config = {
  // Restano fuori solo i file tecnici e le funzioni che hanno già una protezione propria:
  // cron (CRON_SECRET), webhook (firma di HubSpot/Fireflies), trascrizione (indirizzo firmato).
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|accesso|api/login|api/cron/|api/webhook/|api/trascrizione/).*)"
  ]
};
