// La fotografia notturna dei contatti di marketing.
//
// PERCHE' SERVE. HubSpot non dice quanti contatti un flusso ha declassato: l'API
// dei flussi risponde se sono attivi e nient'altro, e la proprieta' "Contatti di
// Marketing fino al prossimo aggiornamento" non porta la data in cui e'
// cambiata. L'unico modo di misurare il lavoro dei flussi e' contare ogni notte
// e guardare la differenza fra due notti.
//
// QUANDO, E PERCHE' DUE ORARI PER UNA FOTOGRAFIA SOLA. I flussi girano a
// cavallo della mezzanotte: alle 23:30 quello stretto marca i contatti se siamo
// fuori soglia, alle 00:00 il principale li declassa insieme al segmento
// Declassabili. La foto va scattata subito dopo - alle 00:25 - perche' un
// ritardo di ore vorrebbe dire accorgersi solo la mattina dopo che i flussi non
// hanno lavorato.
//
// I cron di Vercel pero' vanno a orario di Greenwich, che da noi e' due ore
// indietro d'estate e una d'inverno: un orario fisso scatterebbe alle 00:25 per
// meta' anno e alle 23:25 per l'altra meta', cioe' PRIMA dei flussi, misurando
// la notte sbagliata. Per questo ce ne sono due, alle 22:25 e alle 23:25 di
// Greenwich, e a decidere quale vale e' il controllo qui sotto sull'ora
// italiana: ne passa sempre e solo uno.
//
// SI PUO' RILANCIARE: la chiave e' il giorno, quindi una seconda esecuzione
// aggiorna la riga invece di aggiungerne una.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const HUBSPOT_API = "https://api.hubapi.com";

async function conta(token: string, filters: Array<Record<string, string>>): Promise<number> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1, filterGroups: [{ filters }] })
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return Number((await res.json()).total ?? 0);
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });

  // Passa solo la chiamata che cade nella mezz'ora giusta italiana: l'altra
  // esce senza toccare niente. Senza questo controllo, una delle due
  // scatterebbe prima dei flussi e sovrascriverebbe la foto buona con una
  // presa troppo presto.
  const adesso = new Date().toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour12: false });
  const [ore, minuti] = adesso.split(":").map(Number);
  if (!(ore === 0 && minuti >= 15 && minuti < 55)) {
    return NextResponse.json({ saltato: true, oraItaliana: adesso });
  }

  try {
    const [reali, inAttesa] = await Promise.all([
      conta(token, [
        { propertyName: "hs_marketable_status", operator: "EQ", value: "true" },
        { propertyName: "hs_marketable_until_renewal", operator: "NEQ", value: "true" }
      ]),
      conta(token, [
        { propertyName: "hs_marketable_status", operator: "EQ", value: "true" },
        { propertyName: "hs_marketable_until_renewal", operator: "EQ", value: "true" }
      ])
    ]);

    // Il giorno e' quello di Roma: una fotografia presa alle 00:10 italiane non
    // deve finire sul giorno prima solo perche' il server ragiona in UTC.
    const giorno = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });

    await getDb().query(
      `INSERT INTO marketing_snapshot (giorno, reali, in_attesa, preso_at)
       VALUES ($1::date, $2, $3, now())
       ON CONFLICT (giorno) DO UPDATE
         SET reali = EXCLUDED.reali, in_attesa = EXCLUDED.in_attesa, preso_at = now()`,
      [giorno, reali, inAttesa]
    );

    return NextResponse.json({ giorno, reali, inAttesa, totale: reali + inAttesa });
  } catch (e) {
    console.error("[marketing-snapshot]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Fotografia non riuscita" }, { status: 500 });
  }
}
