import { getDb } from "@/lib/db";

/**
 * Quanti lead sono davvero assegnabili, non quanti ce ne sono.
 *
 * IL PROBLEMA. L'app dichiara il serbatoio grezzo: tutti i contatti senza
 * proprietario con una campagna e un telefono. L'8 ottobre 2026 fra serie A e
 * serie B facevano 38.299, e i contatti davvero assegnabili erano 525 - due
 * ordini di grandezza di differenza. E' il motivo per cui una persona riceveva
 * blocchi da 4 e da 3 lead mentre la pagina diceva migliaia, e per cui
 * comparivano i "Nessun lead disponibile nel pool" con il serbatoio apparente
 * pieno.
 *
 * COSA TAGLIA DAVVERO. Quasi tutto lo fa l'eta' massima - venti giorni - che da
 * sola porta 38.299 a 534. Gli altri filtri misurati sul serbatoio vero valgono
 * una manciata: zero clienti, quattro dentro la finestra webinar, cinque senza
 * campagna. Per questo il conto si puo' fare da qui con due ricerche, senza
 * coinvolgere l'app.
 *
 * SI CHIAMANO ASSEGNABILI E NON DISPONIBILI. Restano fuori i filtri Sergente
 * sulla provenienza, l'esclusione campagne scelta dall'interfaccia e la riserva
 * serie A, che vivono nel codice dell'app. E' un massimo, non una promessa: il
 * numero vero e' questo o meno, mai di piu'.
 */

const HUBSPOT = "https://api.hubapi.com";

/** L'eta' massima del serbatoio principale, la stessa dell'app. */
const GIORNI_MAX = 20;

/**
 * IL SECONDO SERBATOIO NON SI CONTA, ED E' UNA SCELTA MISURATA.
 *
 * I tetti d'eta' dell'app sono due: venti giorni sul serbatoio principale,
 * quarantacinque su quello esteso da cui `fetch_fallback_leads` completa la
 * richiesta quando il primo non basta. Il 10 ottobre 2026 questa pagina ha
 * cominciato a dichiarare anche il secondo - 3.379 e 4.146 contro 1.097 e 855 -
 * e poche ore dopo l'abbiamo tolto, perche' il numero rispondeva a una domanda
 * che nessuno fa.
 *
 * IL CONTO CHE L'HA DECISO, su `lead_assignments`: dal 22 maggio al 10 ottobre
 * sono stati assegnati 33.810 lead, di cui 5.000 oltre i venti giorni - cioe'
 * dal serbatoio esteso, perche' il principale li rifiuta. Ma nelle tre
 * settimane precedenti al 10 ottobre quel numero e' ZERO, tutti i giorni: con
 * millenovecento contatti pescabili e cinquecento richieste al giorno, il
 * ripiego non scatta mai.
 *
 * QUANDO TORNERA' A SERVIRE si vedra' da solo: il giorno in cui gli
 * assegnabili scendono sotto la domanda, il ripiego ricomincia a lavorare e
 * questo numero torna a dire qualcosa. Rimetterlo e' una costante e due
 * ricerche - c'e' tutto nella storia di questo file.
 */

/**
 * Quanto vale un conteggio prima di rifarlo.
 *
 * La sezione interroga l'app ogni minuto mentre qualcuno la guarda: rifare due
 * ricerche HubSpot a ogni giro sarebbe spendere il budget di tutti - condiviso
 * con decine di flussi Zapier su un tetto di 19 al secondo - per un numero che
 * si muove di poche unita' al minuto.
 */
const FRESCHEZZA_MINUTI = 5;

/** Un campione ogni dieci minuti basta a ricostruire l'andamento della giornata. */
const CAMPIONE_MINUTI = 10;

/**
 * NULL E NON ZERO, FINO IN FONDO.
 *
 * `quanti()` torna null quando HubSpot non ha risposto, e fino al 10 ottobre
 * 2026 quel null diventava zero proprio qui all'uscita (`a ?? 0`). Risultato
 * visto in pagina: "POOL SERIE B — 0, assegnabili su 31.895", cioe' una
 * ricerca andata storta travestita da serbatoio esaurito. Il null arriva fino
 * a chi disegna, che sa gia' cosa farne: mostra il grezzo, come prima di
 * questi conteggi.
 */
export type Assegnabili = {
  serieA: number | null;
  serieB: number | null;
  presoAt: string;
};

export type StatoApp = {
  pool_a?: unknown;
  pool_b?: unknown;
  riserva?: unknown;
  riserva_max?: unknown;
  assegnati_oggi?: unknown;
  persone_oggi?: unknown;
  sistema_acceso?: unknown;
  modalita_live?: unknown;
};

function intero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * I CINQUE FILTRI DELLA RICERCA SONO GLI STESSI DELL'APP, piu' l'eta'.
 *
 * Sei in tutto, che e' il massimo che HubSpot accetta per gruppo: il settimo
 * da' un 400. Ci sono cascato misurando, aggiungendo lifecyclestage a questi -
 * ed e' la ragione per cui i filtri che restano si applicano nel codice e non
 * qui dentro.
 */
/**
 * I CINQUE FILTRI COMUNI, senza la data: quella cambia fra i due gruppi.
 */
function comuni(serie: string) {
  return [
    { propertyName: "dispatch_outcome", operator: "CONTAINS_TOKEN", value: `*${serie}*` },
    { propertyName: "hubspot_owner_id", operator: "NOT_HAS_PROPERTY" },
    { propertyName: "countdown", operator: "NOT_HAS_PROPERTY" },
    { propertyName: "id_campagna_refresh", operator: "HAS_PROPERTY" },
    { propertyName: "phone", operator: "HAS_PROPERTY" }
  ];
}

/**
 * DUE GRUPPI, PERCHE' LE DATE SONO DUE.
 *
 * L'app non guarda solo quando il contatto e' NATO: gli basta che sia recente
 * una fra `createdate` e `recent_conversion_date` - lo dice la riga 64 di
 * lead_assigner.py e lo fa nel codice, non nel filtro della ricerca. Qui si
 * guardava solo la prima, e su questo portale e' quella che conta meno: i lead
 * assegnabili sono quasi tutti contatti vecchi che si sono re-iscritti.
 *
 * Misurato il 10 ottobre 2026, a venti giorni: per serie A la data di nascita
 * ne trovava 198 e quella di riconversione 1.074, per un totale di 1.084. La
 * pagina dichiarava un quinto del serbatoio vero, e su quel numero si stava
 * per decidere di allargare i tetti - cioe' si stava per curare il sintomo
 * sbagliato.
 *
 * Due gruppi di filtri in OR sono il modo di HubSpot per dire "almeno una
 * delle due": i contatti che soddisfano entrambe si contano una volta sola.
 */
function gruppi(serie: string, daMs: number) {
  const quando = String(daMs);
  return [
    { filters: [...comuni(serie), { propertyName: "createdate", operator: "GTE", value: quando }] },
    {
      filters: [
        ...comuni(serie),
        { propertyName: "recent_conversion_date", operator: "GTE", value: quando }
      ]
    }
  ];
}

async function quanti(token: string, serie: string, daMs: number): Promise<number | null> {
  const r = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ filterGroups: gruppi(serie, daMs), limit: 1 })
  });
  if (!r.ok) {
    // NULL E NON ZERO: un serbatoio vuoto e un serbatoio non misurato si
    // leggono diversissimi, e mostrare zero farebbe pensare che non c'e' piu'
    // niente da assegnare.
    console.error(`[pool] ${serie}: HubSpot ${r.status}`);
    return null;
  }
  const d = (await r.json()) as { total?: number };
  return typeof d.total === "number" ? d.total : null;
}

/**
 * Gli assegnabili, riusando l'ultimo conteggio finche' e' fresco.
 *
 * Il conteggio e la fotografia dell'andamento sono la stessa riga: calcolare e
 * conservare sono lo stesso gesto, e tenerli separati vorrebbe dire due
 * meccanismi che possono divergere.
 */
export async function assegnabili(token: string, stato?: StatoApp): Promise<Assegnabili | null> {
  const db = getDb();

  const { rows: ultime } = await db.query<{
    preso_at: Date;
    assegnabili_a: number | null;
    assegnabili_b: number | null;
  }>(
    `SELECT preso_at, assegnabili_a, assegnabili_b FROM assegnazione_pool
      ORDER BY preso_at DESC LIMIT 1`
  );

  const u = ultime[0];
  const fresco =
    u?.assegnabili_a != null &&
    Date.now() - new Date(u.preso_at).getTime() < FRESCHEZZA_MINUTI * 60_000;

  if (fresco) {
    return {
      serieA: u.assegnabili_a,
      serieB: u.assegnabili_b,
      presoAt: new Date(u.preso_at).toISOString()
    };
  }

  const da = new Date();
  da.setHours(0, 0, 0, 0);
  da.setDate(da.getDate() - GIORNI_MAX);

  const [a, b] = await Promise.all([
    quanti(token, "serie_a", da.getTime()),
    quanti(token, "serie_b", da.getTime())
  ]);
  if (a === null && b === null) return null;

  // Si scrive un campione solo se l'ultimo e' abbastanza vecchio: la sezione
  // chiama ogni minuto, e una riga al minuto per ogni scheda aperta sarebbe
  // rumore invece di storia.
  const vecchioAbbastanza =
    !u || Date.now() - new Date(u.preso_at).getTime() > CAMPIONE_MINUTI * 60_000;

  if (vecchioAbbastanza) {
    await db.query(
      `INSERT INTO assegnazione_pool
         (preso_at, pool_a, pool_b, riserva, riserva_max, assegnati_oggi,
          persone_oggi, sistema_acceso, modalita_live, assegnabili_a, assegnabili_b)
       VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (preso_at) DO NOTHING`,
      [
        intero(stato?.pool_a),
        intero(stato?.pool_b),
        intero(stato?.riserva),
        intero(stato?.riserva_max),
        intero(stato?.assegnati_oggi),
        intero(stato?.persone_oggi),
        typeof stato?.sistema_acceso === "boolean" ? stato.sistema_acceso : null,
        typeof stato?.modalita_live === "boolean" ? stato.modalita_live : null,
        a,
        b
      ]
    );
  }

  return { serieA: a, serieB: b, presoAt: new Date().toISOString() };
}
