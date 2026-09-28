// La fotografia notturna dei contatti di marketing.
//
// PERCHE' SERVE. HubSpot non dice quanti contatti un flusso ha declassato: l'API
// dei flussi risponde se sono attivi e nient'altro, e la proprieta' "Contatti di
// Marketing fino al prossimo aggiornamento" non porta la data in cui e'
// cambiata. L'unico modo di misurare il lavoro dei flussi e' contare ogni notte
// e guardare la differenza fra due notti.
//
// QUANDO. Alle 00:10, cioe' dopo che i flussi notturni hanno finito il loro
// giro delle 02:00 del giorno precedente e prima che ricominci la giornata. La
// riga porta la data del giorno in cui e' stata presa.
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
