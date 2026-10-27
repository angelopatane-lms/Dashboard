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
 * COSA TAGLIA DAVVERO. Quasi tutto lo fa l'eta' massima - venti giorni alla
 * misura dell'8 ottobre, trenta da ieri - che da sola porta 38.299 a 534. Gli altri filtri misurati sul serbatoio vero valgono
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

/**
 * L'eta' massima del serbatoio principale, la stessa dell'app.
 *
 * TRENTA E NON PIU' VENTI dal 21 ottobre 2026: l'app ha alzato la finestra
 * (`MAX_LEAD_AGE_DAYS`) perche' a venti giorni la serie B era scesa a due
 * candidati su venti e la sala riceveva "Nessun lead disponibile nel pool".
 * Questa costante deve inseguire quella: conta su una finestra diversa e il
 * riquadro misura un serbatoio che non e' quello da cui l'app pesca.
 */
const GIORNI_MAX = 30;

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
  /** L'elenco delle campagne sospese, come lo dichiara l'app: nomi separati
   *  da virgola. Serve a togliere dagli assegnabili i lead che l'app non
   *  peschera' mai - vedi `sospesi()`. */
  campagne_sospese?: unknown;
  campagne_sospese_attivo?: unknown;
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

/**
 * Quante pagine al massimo per ogni interrogazione dell'ingresso forzato.
 *
 * E' LO STESSO TETTO DELL'ASSEGNATORE, non un numero scelto qui: l'app legge
 * cinque pagine per interrogazione e da quelle pesca. Contarne di piu'
 * direbbe un numero che l'app non puo' raggiungere, cioe' la stessa bugia -
 * al contrario - che questo file esiste per non raccontare.
 */
const INGRESSO_PAGINE_MAX = 5;

/** Le campagne a ingresso forzato, lette dall'app. Elenco vuoto = regola spenta. */
async function campagneIngresso(): Promise<string[]> {
  const token = process.env.LMS_ASSEGNAZIONI_TOKEN;
  if (!token) return [];
  const indirizzo =
    process.env.LMS_INGRESSO_URL ||
    "https://lms.217.154.117.118.nip.io/dispatch-api/ingresso-forzato";
  try {
    const r = await fetch(indirizzo, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
    if (!r.ok) return [];
    const d = (await r.json()) as { attivo?: boolean; campagne?: string[] };
    return d.attivo ? d.campagne ?? [] : [];
  } catch {
    // SI TORNA L'ELENCO VUOTO E NON SI FALLISCE: se l'app non risponde, il
    // riquadro mostra il conteggio di sempre invece di non mostrare niente.
    return [];
  }
}

/**
 * I contatti che entrano SOLO grazie all'ingresso forzato.
 *
 * PERCHE' NON BASTA UN `total`. Il conteggio normale di serie A chiede
 * `dispatch_outcome` e nessun countdown; questi contatti entrano proprio
 * perche' quelle due condizioni non le rispettano. Ma nelle stesse campagne
 * ci sono anche contatti regolari, gia' contati: sommare i totali li
 * conterebbe due volte. Quindi si enumerano e si tiene solo chi il conteggio
 * normale NON poteva prendere.
 *
 * DUE INTERROGAZIONI PER CAMPAGNA, come altrove: la freschezza e' la piu'
 * recente fra creazione e ultima conversione, e due gruppi in OR darebbero un
 * ordinamento su cui il cursore delle pagine non e' stabile.
 */
async function ingressoForzato(token: string, daMs: number): Promise<number> {
  const campagne = await campagneIngresso();
  if (!campagne.length) return 0;
  const quando = String(daMs);
  const visti = new Set<string>();
  let inPiu = 0;

  for (const campagna of campagne) {
    for (const campo of ["createdate", "recent_conversion_date"]) {
      let dopo: string | undefined;
      for (let pagina = 0; pagina < INGRESSO_PAGINE_MAX; pagina++) {
        const r = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  { propertyName: "id_campagna_refresh", operator: "EQ", value: campagna },
                  { propertyName: "hubspot_owner_id", operator: "NOT_HAS_PROPERTY" },
                  { propertyName: "phone", operator: "HAS_PROPERTY" },
                  { propertyName: campo, operator: "GTE", value: quando }
                ]
              }
            ],
            properties: ["dispatch_outcome", "countdown"],
            sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
            limit: 100,
            after: dopo
          })
        });
        if (!r.ok) {
          console.error(`[pool/ingresso] ${campagna}/${campo}: HubSpot ${r.status}`);
          break;
        }
        const d = (await r.json()) as {
          results?: Array<{ id: string; properties?: { dispatch_outcome?: string; countdown?: string } }>;
          paging?: { next?: { after?: string } };
        };
        for (const c of d.results ?? []) {
          if (visti.has(c.id)) continue;
          visti.add(c.id);
          const outcome = (c.properties?.dispatch_outcome ?? "").trim().toLowerCase();
          const countdown = String(c.properties?.countdown ?? "").trim();
          // GIA' CONTATO ALTROVE: un outcome che parla di serie, senza
          // countdown, e' gia' dentro il conteggio di serie A o in quello di
          // serie B. Sommarlo qui lo conterebbe due volte, e su serie_b lo
          // farebbe comparire in tutti e due i riquadri.
          //
          // E' LA STESSA CONDIZIONE CHE USA L'ASSEGNATORE per decidere chi
          // prendere con l'ingresso forzato. Devono restare uguali: se qui si
          // contasse piu' largo di quanto l'app pesca, il riquadro
          // prometterebbe lead che non esistono.
          if (outcome.includes("serie") && !countdown) continue;
          inPiu++;
        }
        dopo = d.paging?.next?.after;
        if (!dopo) break;
      }
    }
  }
  return inPiu;
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

/** Le campagne sospese dichiarate dall'app, in minuscolo. Vuoto = regola spenta. */
function elencoSospese(stato?: StatoApp): string[] {
  if (!stato || stato.campagne_sospese_attivo === false) return [];
  return String(stato.campagne_sospese ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Quanti, fra quelli contati da `quanti`, stanno in una campagna sospesa.
 *
 * PERCHE' SI SOTTRAGGONO. `quanti` conta chi passa i filtri della RICERCA, che
 * sono gli stessi dell'app. Ma l'app, dopo, scarta in Python i lead delle
 * campagne sospese - e sono la maggioranza. Misurato il 27 ottobre 2026 con
 * `scripts/serbatoio-vero.ts`: su 2.195 contatti di serie A letti dalla
 * ricerca, **1.755 erano di campagne sospese** e ne restavano 428. La pagina
 * dichiarava 2.268: cinque volte il serbatoio vero, e su quel numero si
 * decide se riaprire le campagne o allargare i tetti.
 *
 * SEI FILTRI ESATTI, non sette: `id_campagna_refresh IN [...]` prende il posto
 * di `HAS_PROPERTY` invece di aggiungersi. HubSpot ne accetta sei per gruppo e
 * il settimo da' 400 - che qui tornerebbe `null` e lascerebbe il numero
 * gonfio. L'elenco dei nomi conta come UN filtro, qualunque sia la sua
 * lunghezza.
 *
 * ZERO SE NON SI PUO' MISURARE, non null: un conteggio in meno mancato non
 * deve cancellare quello principale, che e' buono. Il numero resta ottimista
 * come prima, non diventa assente.
 */
async function sospesi(
  token: string, serie: string, daMs: number, elenco: string[]
): Promise<number> {
  if (!elenco.length) return 0;
  const conSospese = (filtri: ReturnType<typeof comuni>) =>
    filtri.map((f) =>
      f.propertyName === "id_campagna_refresh"
        ? { propertyName: "id_campagna_refresh", operator: "IN", values: elenco }
        : f
    );
  const quando = String(daMs);
  const corpo = {
    filterGroups: [
      { filters: [...conSospese(comuni(serie)), { propertyName: "createdate", operator: "GTE", value: quando }] },
      { filters: [...conSospese(comuni(serie)), { propertyName: "recent_conversion_date", operator: "GTE", value: quando }] }
    ],
    limit: 1
  };
  const r = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(corpo)
  });
  if (!r.ok) {
    console.error(`[pool] sospesi ${serie}: HubSpot ${r.status}`);
    return 0;
  }
  const d = (await r.json()) as { total?: number };
  return typeof d.total === "number" ? d.total : 0;
}

/**
 * Quanti, fra quelli contati da `quanti`, stanno in una campagna ICMD.
 *
 * PERCHE' SI SOTTRAGGONO. Non si distribuiscono mai: l'assegnatore li scarta
 * due volte, una sullo storico e una sulla campagna, e per la stessa ragione
 * non compaiono nel menu delle categorie. Il riquadro invece li contava, e
 * sono tanti: misurato il 27 ottobre 2026, dei 769 contatti di serie A che la
 * ricerca restituiva dopo aver tolto le campagne sospese, **402 erano ICMD** -
 * piu' della meta' di un numero su cui si decide se riaprire campagne o
 * spostare il mix.
 *
 * UN TOKEN, NON UN PREFISSO: `CONTAINS_TOKEN` confronta una parola intera e
 * `_` separa le parole, quindi "icmd" prende `icmd_14_workshop_ottobre` e non
 * prende `lms_div_coach_icmdizzato`. Sei filtri esatti come in `sospesi()`:
 * l'elenco prende il posto di `HAS_PROPERTY` invece di aggiungersi.
 *
 * ZERO SE NON SI PUO' MISURARE, non null: come per le sospese, un conteggio in
 * meno mancato non deve cancellare quello principale, che e' buono.
 */
async function icmd(token: string, serie: string, daMs: number): Promise<number> {
  const conIcmd = (filtri: ReturnType<typeof comuni>) =>
    filtri.map((f) =>
      f.propertyName === "id_campagna_refresh"
        ? { propertyName: "id_campagna_refresh", operator: "CONTAINS_TOKEN", value: "icmd" }
        : f
    );
  const quando = String(daMs);
  const corpo = {
    filterGroups: [
      { filters: [...conIcmd(comuni(serie)), { propertyName: "createdate", operator: "GTE", value: quando }] },
      { filters: [...conIcmd(comuni(serie)), { propertyName: "recent_conversion_date", operator: "GTE", value: quando }] }
    ],
    limit: 1
  };
  const r = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(corpo)
  });
  if (!r.ok) {
    console.error(`[pool] icmd ${serie}: HubSpot ${r.status}`);
    return 0;
  }
  const d = (await r.json()) as { total?: number };
  return typeof d.total === "number" ? d.total : 0;
}

/** Un nome di campagna ICMD, con la stessa regola del token. */
const PARE_ICMD = (nome: string) => /(^|_)icmd(_|$)/.test(nome);

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

  const sospese = elencoSospese(stato);
  const [a, b, inPiu, sospA, sospB, icmdA, icmdB] = await Promise.all([
    quanti(token, "serie_a", da.getTime()),
    quanti(token, "serie_b", da.getTime()),
    // L'INGRESSO FORZATO ENTRA NEL CONTO DI SERIE A, perche' e' li' che
    // l'assegnatore li mette. Senza questa riga il riquadro direbbe 660
    // mentre l'app ne pesca 1.500, e il numero che si guarda per decidere
    // sarebbe quello sbagliato.
    //
    // ZERO E NON NULL SE NON RIESCE: un conteggio in piu' che non si e'
    // potuto fare non deve cancellare quello principale, che e' buono.
    ingressoForzato(token, da.getTime()).catch(() => 0),
    sospesi(token, "serie_a", da.getTime(), sospese).catch(() => 0),
    sospesi(token, "serie_b", da.getTime(), sospese).catch(() => 0),
    // GLI ICMD SI SOTTRAGGONO SOLO SE NON SONO GIA' FRA LE SOSPESE, altrimenti
    // gli stessi contatti uscirebbero dal conto due volte e il numero
    // diventerebbe pessimista invece che esatto. Dal menu non ci possono
    // finire - gli ICMD ne sono fuori - ma il campo e' testo libero.
    sospese.some(PARE_ICMD) ? 0 : icmd(token, "serie_a", da.getTime()).catch(() => 0),
    sospese.some(PARE_ICMD) ? 0 : icmd(token, "serie_b", da.getTime()).catch(() => 0)
  ]);
  if (a === null && b === null) return null;

  // VIA I SOSPESI, che l'app non pesca. Mai sotto zero: i due conteggi sono
  // due interrogazioni diverse e in mezzo qualcosa puo' cambiare, quindi la
  // differenza potrebbe venire negativa per un contatto o due.
  //
  // RESTA UN TETTO, non la cifra esatta: l'app scarta anche per stato non
  // pescabile, lifecycle cliente, "NR +11 Volte", webinar in corso e - dal 27
  // ottobre 2026 - per chi era in BIN prima che lo stato venisse svuotato.
  // Misurate quel giorno, quelle regole toglievano altri 12 contatti sulla
  // serie A e 71 sulla B: poco rispetto ai 1.755 delle campagne, e ognuna
  // costerebbe un'interrogazione in piu' su un token condiviso con Zapier.
  const meno = (n: number | null, s: number) => (n === null ? null : Math.max(n - s, 0));
  const assA = meno(meno(a, sospA), icmdA);
  const assB = meno(meno(b, sospB), icmdB);

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
        assA === null ? null : assA + inPiu,
        assB
      ]
    );
  }

  // LA STESSA SOMMA CHE SI E' SALVATA. Tenere due conti diversi - uno nel
  // database e uno sullo schermo - vuol dire che un giorno il grafico e il
  // riquadro diranno due numeri, e nessuno sapra' quale dei due guardare.
  return {
    serieA: assA === null ? null : assA + inPiu,
    serieB: assB,
    presoAt: new Date().toISOString()
  };
}
