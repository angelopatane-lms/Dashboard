import { NextResponse } from "next/server";
import { AUTH_COOKIE, authToken, checkPassword, configuredPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!configuredPassword()) {
    return NextResponse.json({ error: "Password non configurata sul server (DASHBOARD_PASSWORD)." }, { status: 500 });
  }
  if (typeof password !== "string" || !(await checkPassword(password))) {
    // Piccola attesa: rende inutili i tentativi a raffica.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "Password errata" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  // Cookie di sessione (senza scadenza): vale finché non si chiude il browser.
  response.cookies.set(AUTH_COOKIE, await authToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  return response;
}
