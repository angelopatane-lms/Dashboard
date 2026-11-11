import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CHIUSURE_TIPOLOGIE, BOOM_TIPOLOGIE } from "@/lib/hubspotRegole";

/**
 * I KPI di un advisor che nascono da un appuntamento fissato da lui stesso.
 *
 * LA DOMANDA. La tabella Advisor dice quanto lavoro ha fatto ciascuno, ma non
 * da dove arriva: un advisor del team Programmi riceve gli appuntamenti dai
 * setter, e quelli che si procura da solo spariscono dentro il totale. Il
 * pulsante "KPI propri" li separa, e su ottobre 2026 la differenza fra le
 * persone e' larga: Giacomo Chiaro 42 appuntamenti propri su 74, Asma Bouchrit
 * 36 su 167.
 *
 * COME SI RICONOSCE "PROPRIO". Sulla trattativa ci sono due proprietari: chi
 * la possiede (l'advisor che tiene la consulenza) e `setter_id`, chi ha
 * procurato l'appuntamento. Quando i due coincidono, l'appuntamento se l'e'
 * fissato l'advisor. Non e' una stima: sono due colonne che la sincronizzazione
 * riempie dalla stessa trattativa.
 *
 * SOLO IL TEAM PROGRAMMI CAMBIA DAVVERO, ed e' la ragione per cui il pulsante
 * non fa danno altrove: gli altri sotto-team i setter non ce li hanno, quindi
 * per loro ogni appuntamento e' gia' proprio e i due numeri coincidono.
 *
 * IL SETTER RISCRITTO, e perche' ci si puo' fidare lo stesso. Fino al 4
 * novembre 2026 il flusso 1423923152 riscriveva `setter` su tutte le trattative
 * associate al contatto, e il danno storico non era mai stato misurato.
 * Misurato l'11 novembre su questa domanda: la quota di consulenze proprie non
 * fa nessun salto intorno al 4 novembre - resta fra il 20% e il 32% ogni mese
 * da giugno - quindi la riscrittura non ha spostato questo numero in modo
 * visibile. Dove un contatto ha una trattativa sola, che e' il caso normale,
 * riscrivere il setter con quello della stessa trattativa non cambia niente.
 *
 * I BOOM PASSANO DALLE ASSOCIAZIONI, perche' l'oggetto Boom porta l'advisor ma
 * non la trattativa. Misurato su ottobre: 222 Boom, tutti e 222 associati a una
 * trattativa, lette in 3 chiamate e 1,1 secondi. L'attribuzione resta quella di
 * sempre - il proprietario del Boom - e l'associazione serve solo a dire se
 * quella vendita nasce da un appuntamento suo.
 */

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";

/** La stessa normalizzazione delle altre rotte, cosi' le righe si incontrano. */
const chiave = (nome: string) => nome.trim().toLowerCase().replace(/\s+/g, " ");

type PerNome = Record<string, number>;

/**
 * CHIUSURE E BOOM SI CONTANO SUI BOOM, non sulle trattative vinte.
 *
 * Misurato l'11 novembre guardando la rotta che disegna le colonne vere
 * (src/app/api/hubspot-boom/route.ts): "Chiusure" e' il NUMERO di Boom con
 * tipologia Acconto o Quota unica, e "Boom" e' la SOMMA DEGLI IMPORTI di
 * Acconto, Rata, Quota unica e Upgrade. Una prima versione di questa rotta
 * contava le trattative vinte: dava numeri plausibili - due, tre, cinque per
 * persona - e sbagliati, e la colonna Boom mostrava "5 EUR" dove ce ne sono
 * 22.893. Due metriche che si somigliano sono peggio di due metriche diverse.
 */
async function boomPropri(
  token: string,
  from: string,
  to: string
): Promise<{ chiusure: PerNome; boom: PerNome; incassoChiusure: PerNome } | null> {
  const fromMs = String(new Date(from).getTime());
  const toMs = String(new Date(to + "T23:59:59.999Z").getTime());

  const boom: Array<{ id: string; owner: string; tipologia: string; importo: number }> = [];
  let after: string | undefined;
  do {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/${BOOM}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "data_di_pagamento", operator: "GTE", value: fromMs },
              { propertyName: "data_di_pagamento", operator: "LTE", value: toMs }
            ]
          }
        ],
        properties: ["hubspot_owner_id", "tipologia_di_incasso", "importo"],
        limit: 100,
        ...(after ? { after } : {})
      })
    });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      results?: Array<{
        id: string;
        properties?: {
          hubspot_owner_id?: string | null;
          tipologia_di_incasso?: string | null;
          importo?: string | null;
        };
      }>;
      paging?: { next?: { after?: string } };
    };
    for (const x of d.results ?? []) {
      boom.push({
        id: x.id,
        owner: (x.properties?.hubspot_owner_id ?? "").trim(),
        tipologia: (x.properties?.tipologia_di_incasso ?? "").trim(),
        importo: parseFloat(x.properties?.importo ?? "0") || 0
      });
    }
    after = d.paging?.next?.after;
  } while (after);
  if (!boom.length) return { chiusure: {}, boom: {}, incassoChiusure: {} };

  // Boom -> trattative, a cento per volta.
  const trattativeDi = new Map<string, string[]>();
  for (let i = 0; i < boom.length; i += 100) {
    const r = await fetch(`${HUBSPOT}/crm/v4/associations/${BOOM}/deals/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ inputs: boom.slice(i, i + 100).map((b) => ({ id: b.id })) })
    });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      results?: Array<{ from?: { id: string }; to?: Array<{ toObjectId: string | number }> }>;
    };
    for (const x of d.results ?? []) {
      const id = x.from?.id;
      if (!id) continue;
      trattativeDi.set(id, (x.to ?? []).map((t) => String(t.toObjectId)));
    }
  }

  // Quali di quelle trattative sono nate da un appuntamento dell'advisor.
  const tutti = [...new Set([...trattativeDi.values()].flat())];
  if (!tutti.length) return { chiusure: {}, boom: {}, incassoChiusure: {} };
  const db = getDb();
  const { rows } = await db.query<{ deal_id: string }>(
    `SELECT deal_id::text FROM trattativa
      WHERE deal_id::text = ANY($1::text[]) AND setter_id IS NOT NULL AND setter_id = proprietario_id`,
    [tutti]
  );
  const propria = new Set(rows.map((r) => r.deal_id));

  // Il nome dell'advisor dal suo id proprietario, dalla stessa tabella che usa
  // il resto della dashboard: nessuna chiamata in piu' all'API dei proprietari.
  const { rows: nomi } = await db.query<{ id: string; nome: string }>(
    `SELECT id::text, nome FROM proprietario`
  );
  const nomeDi = new Map(nomi.map((r) => [r.id, r.nome]));

  const chiusure: PerNome = {};
  const importi: PerNome = {};
  // L'INCASSO DELLE SOLE CHIUSURE, che e' il numeratore della Resa: niente
  // rate e niente upgrade, perche' quelli arrivano su vendite di mesi prima e
  // dividerli per le ore di consulenza di questo mese accosterebbe un ricavo
  // a un lavoro che non lo ha prodotto. E' la stessa regola della colonna
  // Resa nella vista normale.
  const incasso: PerNome = {};
  for (const b of boom) {
    const suoi = trattativeDi.get(b.id) ?? [];
    if (!suoi.some((d) => propria.has(d))) continue;
    const nome = nomeDi.get(b.owner);
    if (!nome) continue;
    const k = chiave(nome);
    if (CHIUSURE_TIPOLOGIE.has(b.tipologia)) {
      chiusure[k] = (chiusure[k] ?? 0) + 1;
      incasso[k] = (incasso[k] ?? 0) + b.importo;
    }
    if (BOOM_TIPOLOGIE.has(b.tipologia)) importi[k] = (importi[k] ?? 0) + b.importo;
  }
  return { chiusure, boom: importi, incassoChiusure: incasso };
}

/**
 * `boom=0` chiede la sola parte veloce: le tre domande al database, senza
 * toccare HubSpot. Serve alla vista "Da azioni del team", che degli appuntamenti
 * ricevuti ha bisogno sempre - e che non deve pagare un secondo di attesa per
 * numeri che in quella vista non mostra.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const conBoom = searchParams.get("boom") !== "0";
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  try {
    const db = getDb();
    /**
     * GLI APPUNTAMENTI RICEVUTI, cioe' quelli che l'advisor ha in mano da
     * chiunque glieli abbia procurati.
     *
     * Misurato l'11 novembre 2026: la colonna Appuntamenti della pagina Advisor
     * non contava questo. La sua fonte aggrega le trattative PER SETTER - vedi
     * app/api/hubspot-trattative/route.ts - quindi su un advisor del team
     * Programmi mostrava soltanto quelli che si era fissato da solo. Roberta
     * Scicchitano risultava con 2 appuntamenti e 22 consulenze nella stessa
     * riga: gliene erano stati procurati 42.
     */
    const [ricevuti, appuntamenti, consulenze] = await Promise.all([
      db.query<{ advisor: string; n: string }>(
        `SELECT p.nome AS advisor, COUNT(*)::text AS n
           FROM trattativa t
           JOIN proprietario p ON p.id = t.proprietario_id
          WHERE t.creata_ts >= $1::date AND t.creata_ts < ($2::date + INTERVAL '1 day')
          GROUP BY 1`,
        [from, to]
      ),
      ...(["creata_ts", "svolta_ts"] as const).map((col) =>
        db.query<{ advisor: string; n: string }>(
          `SELECT p.nome AS advisor, COUNT(*)::text AS n
             FROM trattativa t
             JOIN proprietario p ON p.id = t.proprietario_id
            WHERE t.${col} >= $1::date
              AND t.${col} < ($2::date + INTERVAL '1 day')
              AND t.setter_id IS NOT NULL
              AND t.setter_id = t.proprietario_id
            GROUP BY 1`,
          [from, to]
        )
      )
    ]);

    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    // I BOOM NON FERMANO IL RESTO: se HubSpot non risponde, le altre tre
    // colonne hanno gia' il loro numero e la quarta resta assente, che la
    // tabella sa gia' mostrare come trattino.
    const boom = conBoom && token ? await boomPropri(token, from, to).catch(() => null) : null;

    const mappa = (rows: Array<{ advisor: string; n: string }>): PerNome => {
      const per: PerNome = {};
      for (const r of rows) per[chiave(r.advisor)] = Number(r.n);
      return per;
    };

    return NextResponse.json(
      {
        ricevuti: mappa(ricevuti.rows),
        appuntamenti: mappa(appuntamenti.rows),
        consulenze: mappa(consulenze.rows),
        chiusure: boom?.chiusure ?? null,
        boom: boom?.boom ?? null,
        incassoChiusure: boom?.incassoChiusure ?? null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[advisor-propri]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "KPI propri non leggibili" }, { status: 500 });
  }
}
