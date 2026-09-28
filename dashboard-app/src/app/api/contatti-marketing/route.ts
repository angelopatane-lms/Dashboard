// Quanti contatti di marketing abbiamo davvero, e quanto manca alla soglia.
//
// PERCHE' IL NUMERO CHE SI VEDE SU HUBSPOT NON E' QUELLO BUONO. HubSpot conta
// come "di marketing" anche i contatti gia' declassati, perche' il declassamento
// diventa effettivo solo al rinnovo dell'abbonamento. Il 28 settembre lo stato
// diceva 344.249, ma 149.772 di quelli erano gia' segnati per uscire il 30, e i
// contatti veri erano 194.477. Guardando il numero grande si sarebbe concluso
// che siamo fuori soglia di centomila, quando invece ci sono quarantamila di
// margine.
//
// LA COLONNA CHE DISTINGUE e' "Contatti di Marketing fino al prossimo
// aggiornamento" (hs_marketable_until_renewal): quando vale si', quel contatto
// e' gia' stato declassato da un flusso e sta solo aspettando la data.
//
// I DECLASSATI DEL GIORNO NON SI POSSONO CHIEDERE A HUBSPOT. L'API dei flussi
// dice se sono attivi, non quanti contatti hanno lavorato, e la proprieta' non
// porta la data in cui e' cambiata. Per questo ogni notte ne salviamo una
// fotografia (vedi /api/cron/marketing-snapshot): la differenza fra due notti
// e' il numero di declassati, ed e' l'unico modo onesto di misurarlo.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const HUBSPOT_API = "https://api.hubapi.com";

/** Oltre questo numero l'abbonamento scatta allo scaglione successivo.
 *
 *  NON esportata: in un file di rotta Next.js ammette solo i suoi nomi
 *  riservati, e qualunque altro export fa fallire la compilazione. */
const SOGLIA = 240_000;

async function conta(token: string, filters: Array<Record<string, string>>): Promise<number> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1, filterGroups: [{ filters }] })
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return Number(d.total ?? 0);
}

export async function GET() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });

  try {
    // Due ricerche invece di tre: il totale e' la somma, e una chiamata in meno
    // su un endpoint che ha un tetto al secondo e' sempre guadagnata.
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

    // Le fotografie delle ultime due settimane: servono a dire quanti ne sono
    // usciti oggi e a far vedere se il numero sale o scende.
    let storico: Array<{ giorno: string; reali: number; in_attesa: number; presoAlle: string }> = [];
    try {
      const { rows } = await getDb().query<{ giorno: Date; reali: number; in_attesa: number; preso_at: Date }>(
        `SELECT giorno, reali, in_attesa, preso_at FROM marketing_snapshot
          ORDER BY giorno DESC LIMIT 14`
      );
      // L'ORA DELLA FOTOGRAFIA VIAGGIA CON LA RIGA. Il confronto "declassati
      // oggi" vale come misura della giornata solo se lo scatto e' di notte:
      // una fotografia presa nel pomeriggio misura mezz'ora, non un giorno, e
      // chi legge deve vederlo scritto invece di dedurlo da un numero strano.
      storico = rows.map((r) => ({
        giorno: r.giorno.toISOString().slice(0, 10),
        reali: Number(r.reali),
        in_attesa: Number(r.in_attesa),
        presoAlle: r.preso_at.toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" })
      }));
    } catch (e) {
      // Senza fotografie la pagina mostra comunque i numeri di adesso: e' il
      // caso del primo giorno, prima che il lavoro notturno abbia girato.
      console.warn("[contatti-marketing] storico non leggibile:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json(
      { reali, inAttesa, totale: reali + inAttesa, soglia: SOGLIA, storico },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[contatti-marketing]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Lettura da HubSpot non riuscita" }, { status: 502 });
  }
}
