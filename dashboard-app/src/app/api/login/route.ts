import { NextResponse } from "next/server";
import { AUTH_COOKIE, authToken, configuredPassword, livelloDiPassword, paginaDelLivello } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!configuredPassword()) {
    return NextResponse.json({ error: "Password non configurata sul server (DASHBOARD_PASSWORD)." }, { status: 500 });
  }
  const tentativo = typeof password === "string" ? password : "";
  const livello = await livelloDiPassword(tentativo);
  if (!livello) {
    // Piccola attesa: rende inutili i tentativi a raffica.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "Password errata" }, { status: 401 });
  }

  // LA STESSA FINESTRA PER TUTTI. Chi inserisce una password ridotta arriva
  // sulla sua tabella, chi inserisce quella piena sulla dashboard intera: non
  // serve una pagina di accesso per ciascuna, e chi ha il link non capisce
  // nemmeno che ne esistono piu' d'una.
  const response = NextResponse.json({ ok: true, destinazione: livello === "piena" ? null : paginaDelLivello(livello) });
  // Cookie di sessione (senza scadenza): vale finché non si chiude il browser.
  response.cookies.set(AUTH_COOKIE, await authToken(tentativo), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  return response;
}
