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

/** Le due code del declassamento: il segmento normale e quello stretto, che il
 *  flusso delle 23:30 usa quando siamo fuori soglia. */
const LISTA_DECLASSABILI = "17585";
const LISTA_DECLASSABILI_EXTRA = "17595";

/** Quanti contatti ci sono adesso in una lista. Se la lettura fallisce si
 *  restituisce null invece di zero: "non lo so" e "sono zero" non sono la
 *  stessa cosa, e uno zero finto sulla coda farebbe pensare che non c'e'
 *  niente da declassare. */
async function dimensioneLista(token: string, id: string): Promise<number | null> {
  try {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/lists/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const d = await res.json();
    const n = Number((d.list ?? d)?.additionalProperties?.hs_list_size);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

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

  // DUE MOMENTI DIVERSI, UNA ROTTA SOLA.
  //
  // Alle 23:45 si fotografa il PRIMA: quanti contatti di marketing ci sono
  // mentre i flussi non hanno ancora lavorato, e quanti ne ha appena marcati il
  // flusso stretto - quella marcatura dopo le 00:00 sparisce, quindi o la si
  // guarda in quella mezz'ora o e' persa. Alle 00:25 si fotografa il DOPO.
  //
  // Con le due misure il declassamento della notte e' una sottrazione esatta.
  // Con il solo "dopo" era la differenza fra due notti, e ci finivano dentro
  // anche gli iscritti della giornata: per la notte del 28 settembre si e'
  // dovuto stimare, fra cento e trecento.
  //
  // Gli orari qui sono quelli italiani e non quelli del cron, che va a
  // Greenwich: ogni momento ha due programmazioni - una per l'ora legale e una
  // per quella solare - e questo controllo lascia passare solo quella giusta.
  const adesso = new Date().toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour12: false });
  const [ore, minuti] = adesso.split(":").map(Number);
  const momento = ore === 23 && minuti >= 35 ? "marcatura" : ore === 0 && minuti >= 15 && minuti < 55 ? "conteggio" : null;
  if (!momento) return NextResponse.json({ saltato: true, oraItaliana: adesso });

  // Il giorno di Roma: una fotografia delle 00:25 italiane non deve finire sul
  // giorno prima solo perche' il server ragiona in UTC. Quella delle 23:45 si
  // scrive invece sulla riga di DOMANI, perche' appartiene alla nottata che sta
  // cominciando.
  const oggiRoma = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
  const notte =
    momento === "marcatura"
      ? new Date(Date.parse(`${oggiRoma}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      : oggiRoma;

  if (momento === "marcatura") {
    try {
      const [marcati, preReali, preInAttesa] = await Promise.all([
        conta(token, [{ propertyName: "pulizia_stretta_attiva", operator: "EQ", value: "true" }]),
        conta(token, [
          { propertyName: "hs_marketable_status", operator: "EQ", value: "true" },
          { propertyName: "hs_marketable_until_renewal", operator: "NEQ", value: "true" }
        ]),
        conta(token, [
          { propertyName: "hs_marketable_status", operator: "EQ", value: "true" },
          { propertyName: "hs_marketable_until_renewal", operator: "EQ", value: "true" }
        ])
      ]);
      // I campi `reali` e `in_attesa` restano a zero: li scrivera' la
      // fotografia delle 00:25, che e' quella del dopo. Qui si riempie solo il
      // prima, cosi' una riga porta le due facce della stessa nottata.
      await getDb().query(
        `INSERT INTO marketing_snapshot (giorno, reali, in_attesa, marcati_stretto, pre_reali, pre_in_attesa, preso_at)
         VALUES ($1::date, 0, 0, $2, $3, $4, now())
         ON CONFLICT (giorno) DO UPDATE
           SET marcati_stretto = EXCLUDED.marcati_stretto,
               pre_reali = EXCLUDED.pre_reali,
               pre_in_attesa = EXCLUDED.pre_in_attesa`,
        [notte, marcati, preReali, preInAttesa]
      );
      return NextResponse.json({ momento, notte, marcatiDalFlussoStretto: marcati, preReali, preInAttesa });
    } catch (e) {
      console.error("[marketing-snapshot] marcatura:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Conteggio dei marcati non riuscito" }, { status: 500 });
    }
  }

  try {
    const [reali, inAttesa, coda, codaExtra] = await Promise.all([
      conta(token, [
        { propertyName: "hs_marketable_status", operator: "EQ", value: "true" },
        { propertyName: "hs_marketable_until_renewal", operator: "NEQ", value: "true" }
      ]),
      conta(token, [
        { propertyName: "hs_marketable_status", operator: "EQ", value: "true" },
        { propertyName: "hs_marketable_until_renewal", operator: "EQ", value: "true" }
      ]),
      dimensioneLista(token, LISTA_DECLASSABILI),
      dimensioneLista(token, LISTA_DECLASSABILI_EXTRA)
    ]);

    await getDb().query(
      `INSERT INTO marketing_snapshot (giorno, reali, in_attesa, coda, coda_extra, preso_at)
       VALUES ($1::date, $2, $3, $4, $5, now())
       ON CONFLICT (giorno) DO UPDATE
         SET reali = EXCLUDED.reali, in_attesa = EXCLUDED.in_attesa,
             coda = EXCLUDED.coda, coda_extra = EXCLUDED.coda_extra, preso_at = now()`,
      [notte, reali, inAttesa, coda, codaExtra]
    );

    return NextResponse.json({ momento, giorno: notte, reali, inAttesa, coda, codaExtra, totale: reali + inAttesa });
  } catch (e) {
    console.error("[marketing-snapshot]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Fotografia non riuscita" }, { status: 500 });
  }
}
