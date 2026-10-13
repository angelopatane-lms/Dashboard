import { NextRequest, NextResponse } from "next/server";
import { kpiIntervallo, perTabella } from "@/lib/kpiSetter";
import type { Candidato } from "@/lib/salescopilot";

/**
 * I KPI dei setter di Sales Copilot per un intervallo di giorni.
 *
 * L'INTERVALLO E' QUELLO DEI FILTRI DELLA PAGINA, non la giornata di oggi: la
 * tabella Setter mostra un periodo, e metterci sotto i numeri di oggi
 * significherebbe dire "quattro messaggi" a chi ha chiesto il mese.
 *
 * PERCHE' PASSA DA QUI E NON DAL BROWSER: la chiave sta in una variabile
 * d'ambiente e non deve mai arrivare alla pagina. Se la chiamata partisse dal
 * browser, chiunque apra gli strumenti per sviluppatori se la porterebbe via -
 * e anche se e' di sola lettura, resta una chiave dei dati di un fornitore.
 *
 * CHI PUO' CHIAMARLA: ci pensa il middleware, che lascia passare solo la
 * password piena. Non aggiungere questo indirizzo a `API_RIDOTTE`.
 *
 * QUANTO SPESSO CHIAMA DAVVERO COPILOT: una chiamata sola per intervallo, e
 * solo per i giorni scaduti - i giorni chiusi che hanno gia' dato numeri non si
 * richiedono mai piu'. La pagina puo' chiedere con la frequenza che vuole.
 * Vedi `kpiIntervallo`.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const HUBSPOT = "https://api.hubapi.com";

/**
 * Le nostre persone per l'aggancio: nome ed email dei proprietari HubSpot.
 *
 * SONO LORO E NON IL FOGLIO perche' l'email e' la prima regola di aggancio, e
 * il foglio degli operatori le email non le ha. Misurato il 13 ottobre 2026:
 * cinque persone di Copilot su otto si agganciano per email proprio grazie a
 * questi record.
 */
async function nostrePersone(token: string): Promise<Candidato[]> {
  const persone: Candidato[] = [];
  let dopo: string | undefined;
  for (let p = 0; p < 12; p++) {
    const u = new URL(`${HUBSPOT}/crm/v3/owners`);
    u.searchParams.set("limit", "100");
    if (dopo) u.searchParams.set("after", dopo);
    const r = await fetch(u, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!r.ok) break;
    const d = (await r.json()) as {
      results?: Array<{ firstName?: string; lastName?: string; email?: string }>;
      paging?: { next?: { after?: string } };
    };
    for (const o of d.results ?? []) {
      const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
      if (nome) persone.push({ nome, email: o.email ?? null });
    }
    dopo = d.paging?.next?.after;
    if (!dopo) break;
  }
  return persone;
}

/** Il giorno di oggi in Italia: la giornata la decide il fuso di chi lavora. */
const oggiRoma = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

export async function GET(req: NextRequest) {
  const chiave = process.env.SALESCOPILOT_KPI_KEY;
  if (!chiave) {
    // 200 E NON 503: la pagina deve poter disegnare la tabella senza questi
    // numeri, come fa da sempre. `vuotoPerche` dice perche' non ci sono.
    return NextResponse.json(
      { righe: [], perTabella: {}, vuotoPerche: "SALESCOPILOT_KPI_KEY non impostata" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // `from`/`to` come il resto delle rotte della Dashboard; senza, la giornata
  // di oggi. Una data scritta male non vale zero: vale "oggi".
  const data = (nome: string) => {
    const v = req.nextUrl.searchParams.get(nome);
    return /^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : null;
  };
  const da = data("from") ?? data("giorno") ?? oggiRoma();
  const a = data("to") ?? data("giorno") ?? oggiRoma();

  try {
    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const candidati = token ? await nostrePersone(token) : [];
    const esito = await kpiIntervallo(da, a, chiave, candidati);
    return NextResponse.json(
      {
        da,
        a,
        ...esito,
        perTabella: perTabella(esito.righe),
        // CHI NON SI E' AGGANCIATO VIENE DETTO, non nascosto: i suoi numeri non
        // finiscono in nessuna riga della tabella, e un'assenza silenziosa e'
        // il modo in cui si perde l'attivita' di una persona per settimane.
        senzaAggancio: [
          ...new Set(esito.righe.filter((r) => !r.nostro).map((r) => r.nome ?? r.personaId))
        ]
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[api/copilot/setter-kpi]", e);
    return NextResponse.json(
      { righe: [], perTabella: {}, vuotoPerche: "lettura non riuscita" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
