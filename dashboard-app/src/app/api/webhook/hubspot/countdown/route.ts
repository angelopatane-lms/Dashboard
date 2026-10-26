import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { valutaContatto } from "@/lib/chatter/cluster";

/**
 * Il webhook del flusso "Countdown scaduto → Chatter": HubSpot ci avvisa
 * quando il countdown toglie la proprieta' a un contatto, e noi decidiamo se
 * passarlo a Mihai Pislaru con il suo Cluster Chatter. La regola sta in
 * src/lib/chatter/cluster.ts; finche' CHATTER_CLUSTER_ATTIVO non e' 1 si
 * annota soltanto.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const TETTO_CORPO = 64 * 1024;

/** Un segreto suo, come gli altri webhook: cambiarlo non rompe gli altri. */
const NOME_SEGRETO = "CHATTER_CLUSTER_SECRET";

function ugualiInSicurezza(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function idContatto(p: Record<string, unknown>): string {
  const dentro = (p.properties ?? {}) as Record<string, unknown>;
  for (const v of [p.objectId, p.hs_object_id, p.vid, p.contactId, dentro.hs_object_id]) {
    const s = String(v ?? "").trim();
    if (/^\d+$/.test(s)) return s;
  }
  return "";
}

async function lavora(contattoId: string): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.error("[webhook/countdown] HUBSPOT_PRIVATE_APP_TOKEN non impostato");
    return;
  }
  const v = await valutaContatto(contattoId, token);
  console.log(`[webhook/countdown] ${contattoId}: ${v.esito}${v.ciclo ? ` (${v.ciclo}° Ciclo)` : ""} - ${v.motivo}`);
}

export async function POST(req: NextRequest) {
  const segreto = process.env[NOME_SEGRETO];
  if (!segreto) return NextResponse.json({ error: "non configurato" }, { status: 500 });

  // Il segreto sta nell'indirizzo, come per gli altri webhook dei flussi.
  const dato = req.nextUrl.searchParams.get("segreto") ?? req.nextUrl.searchParams.get("k") ?? "";
  if (!ugualiInSicurezza(dato, segreto)) {
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  const corpo = await req.text();
  if (corpo.length > TETTO_CORPO) return NextResponse.json({ error: "corpo troppo lungo" }, { status: 413 });

  let p: Record<string, unknown> = {};
  try {
    const letto = JSON.parse(corpo);
    p = Array.isArray(letto) ? (letto[0] ?? {}) : letto;
  } catch {
    return NextResponse.json({ error: "corpo non leggibile" }, { status: 400 });
  }

  const contattoId = idContatto(p);
  if (!contattoId) {
    console.warn(`[webhook/countdown] nessun id contatto nel corpo: ${corpo.slice(0, 500)}`);
    return NextResponse.json({ ok: true, ignorato: true });
  }

  // Risposta subito, lavoro dopo: un webhook in timeout HubSpot lo ripete.
  waitUntil(lavora(contattoId));
  return NextResponse.json({ ok: true, preso: contattoId });
}

/** Per controllare dal browser che l'indirizzo risponda e in che modo e'. */
export async function GET() {
  return NextResponse.json({
    webhook: "hubspot-countdown-chatter",
    variabile: NOME_SEGRETO,
    segreto: Boolean(process.env[NOME_SEGRETO]),
    modo: process.env.CHATTER_CLUSTER_ATTIVO === "1" ? "assegna" : "sola lettura"
  });
}
