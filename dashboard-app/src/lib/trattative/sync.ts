// Sincronizzazione delle trattative della pipeline "Appuntamenti (High Ticket)",
// per ricavare Appuntamenti e Consulenze per campagna.
//
// IL PROBLEMA CHE RISOLVE: la data in cui una consulenza e' stata svolta non e'
// leggibile dallo stato attuale della trattativa. Il workflow "Performance
// Tracker - Trattative Svolte" decide su fase_precedente, dealstage e motivo,
// che cambiano a ogni passaggio successivo: guardandoli oggi non si saprebbe
// piu' se e quando l'incontro e' avvenuto. Si legge quindi la CRONOLOGIA delle
// fasi, si applica la regola a ogni transizione in ordine cronologico, e si
// salva la data della PRIMA che la soddisfa.
//
// I CRITERI NON SONO SCRITTI QUI: vengono letti dal workflow via API, cosi' una
// modifica su HubSpot si riflette al sync successivo senza toccare il codice.

import { getDb } from "@/lib/db";
import { campagnaEffettiva } from "@/lib/campagnaEffettiva";

const HUBSPOT_API = "https://api.hubapi.com";
const FLOW_TRATTATIVE_SVOLTE = "4640743658";
export const PIPELINE_APPUNTAMENTI = "433643709";

// "Fase Precedente (Sergente)": e' il cambio di questa proprieta' a innescare il
// workflow, quindi ogni sua voce di cronologia e' una transizione da valutare.
// NON confondere con "provamultiriga", etichettata "Fase precedente", che e' un
// campo di testo libero inutilizzato.
const FASE_PRECEDENTE_SERGENTE = "fase_precedente";

// Le letture con cronologia accettano al massimo 50 input per volta.
const MAX_INPUT_STORICO = 50;

type Voce = { value: string; timestamp: string };
type Filtro = { proprieta: string; operatore: string; valori: string[] };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function chiamaHubSpot<T>(
  token: string,
  url: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {})
    });
    if (res.ok) return res.json();
    if (res.status === 429 && tentativo < 3) {
      await sleep(1000 * (tentativo + 1));
      continue;
    }
    throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  }
  throw new Error("Troppi tentativi");
}

/** I gruppi di criteri del workflow, letti da HubSpot. Sono in OR fra loro. */
export async function leggiCriteriSvolte(token: string): Promise<Filtro[][]> {
  const flow = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/automation/v4/flows/${FLOW_TRATTATIVE_SVOLTE}`);
  const rc = flow.enrollmentCriteria?.refinementCriteria;

  if (rc?.filterBranchOperator && rc.filterBranchOperator !== "OR") {
    throw new Error(
      `I gruppi del workflow sono in ${rc.filterBranchOperator}, non in OR: la valutazione qui assume OR e darebbe risultati sbagliati.`
    );
  }

  return (rc?.filterBranches ?? []).map((b: any) =>
    (b.filters ?? []).map((f: any) => ({
      proprieta: f.property,
      operatore: f.operation.operator,
      valori: f.operation.values ?? (f.operation.value !== undefined ? [String(f.operation.value)] : [])
    }))
  );
}

function gruppoSoddisfatto(filtri: Filtro[], stato: Record<string, string>): boolean {
  for (const f of filtri) {
    const v = stato[f.proprieta] ?? "";
    if (f.operatore === "IS_ANY_OF") {
      if (!f.valori.includes(v)) return false;
    } else if (f.operatore === "IS_NONE_OF") {
      if (f.valori.includes(v)) return false;
    } else if (f.operatore === "IS_KNOWN") {
      if (!v) return false;
    } else {
      // Meglio fermarsi che dichiarare "svolta" una transizione che non
      // sappiamo valutare: un criterio nuovo su HubSpot deve farci accorgere.
      throw new Error(`Operatore non gestito nei criteri del workflow: ${f.operatore} su ${f.proprieta}`);
    }
  }
  return true;
}

function valoreAl(storico: Voce[], istante: number): string {
  let scelto = "";
  let migliore = -Infinity;
  for (const v of storico) {
    const t = new Date(v.timestamp).getTime();
    if (t <= istante && t > migliore) {
      migliore = t;
      scelto = (v.value ?? "").trim();
    }
  }
  return scelto;
}

/**
 * Data della prima consulenza svolta, o null se non e' mai avvenuta.
 *
 * PERCHE' NON SI USA LA PROPRIETA' fase_precedente: e' mantenuta dal workflow
 * "Sergente", creato il 1 agosto 2026, quindi per le trattative precedenti e'
 * semplicemente vuota (misurato: 0% di cronologia da gennaio a luglio, 90% da
 * agosto). Usandola si perderebbero sette mesi di consulenze.
 *
 * La cronologia di dealstage invece c'e' per il 100% delle trattative, e la
 * fase precedente sono le coppie consecutive: quando la trattativa passa da A
 * a B, la fase precedente e' A. L'unica finezza e' che fase_precedente
 * distingue "Ripianificata (No Show)" da "Ripianificata (Trattativa)", mentre
 * dealstage ha una sola "Ripianificata": la variante si ricava dal Motivo in
 * quell'istante, che vale esattamente "Mancata Presenza" o "Trattativa".
 *
 * Ricostruzione verificata dove esistono entrambi (agosto-settembre 2026):
 * coincide nel 97,5% dei confronti.
 */
export function primaSvolta(
  gruppi: Filtro[][],
  storici: Record<string, Voce[]>,
  correnti: Record<string, string>,
  etichettaFase: Map<string, string>
): Date | null {
  const fasi = [...(storici.dealstage ?? [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (let i = 1; i < fasi.length; i++) {
    const t = new Date(fasi[i].timestamp).getTime();
    if (Number.isNaN(t)) continue;

    const motivo = valoreAl(storici.motivo ?? [], t);
    const precedente = etichettaFase.get((fasi[i - 1].value ?? "").trim()) ?? "";
    const faseP =
      precedente === "Ripianificata"
        ? motivo === "Mancata Presenza"
          ? "Ripianificata (No Show)"
          : "Ripianificata (Trattativa)"
        : precedente;

    const stato: Record<string, string> = {
      // hubspot_team_id non ha una cronologia utile: si usa il valore attuale.
      hubspot_team_id: (correnti.hubspot_team_id ?? "").trim(),
      // I criteri confrontano dealstage con gli ID delle fasi e
      // fase_precedente con le etichette: si passano quindi cosi' come sono.
      dealstage: (fasi[i].value ?? "").trim(),
      motivo,
      [FASE_PRECEDENTE_SERGENTE]: faseP
    };

    if (gruppi.some((g) => gruppoSoddisfatto(g, stato))) return new Date(t);
  }
  return null;
}

/**
 * Tutti gli ingressi nella fase "No Show", con la loro data.
 *
 * Si legge dalla cronologia e non dalla fase attuale: un appuntamento disertato
 * viene quasi sempre spostato subito dopo (Persa, Archiviata, Ripianificata), e
 * guardando dove si trova oggi la trattativa non lo si vedrebbe piu'. Una
 * trattativa puo' comparire piu' volte: viene ripianificata e il cliente
 * diserta di nuovo. Misurato: il 53% delle trattative ne ha almeno uno.
 */
/** Due passaggi piu' vicini di cosi' raccontano lo stesso fatto, non due
 *  diserzioni: l'advisor segna il no show e poi ripianifica, a volte subito e
 *  a volte il mattino dopo. */
const STESSA_DISERZIONE_MS = 24 * 60 * 60 * 1000;

export function ingressiNoShow(
  storici: Record<string, Voce[]>,
  idFaseNoShow: string,
  idFaseRipianificata?: string
): Date[] {
  const istanti: number[] = [];

  for (const v of storici.dealstage ?? []) {
    const t = new Date(v.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const fase = (v.value ?? "").trim();

    if (fase === idFaseNoShow) {
      istanti.push(t);
      continue;
    }

    // RIPIANIFICATA CON MOTIVO "MANCATA PRESENZA": e' un no show anche questo.
    // Chi lavora la pratica passando prima per la fase No Show e poi
    // ripianificando viene contato dalla riga sopra; chi va dritto in
    // Ripianificata scrivendo il motivo saltava la fase, e per noi quella
    // diserzione non esisteva. Misurato da giugno: 193 casi con quel motivo,
    // 101 passati anche dalla fase e 92 mai - il 4% dei no show, invisibile.
    //
    // Il motivo si legge AL MOMENTO del passaggio e non oggi: una trattativa
    // ripianificata per mancata presenza e poi ripianificata di nuovo dopo la
    // call porta "Trattativa" come valore corrente, e leggendo quello la prima
    // diserzione sparirebbe.
    if (idFaseRipianificata && fase === idFaseRipianificata) {
      if (valoreAl(storici.motivo ?? [], t) === "Mancata Presenza") istanti.push(t);
    }
  }

  // Si accorpano i passaggi ravvicinati: i 101 che toccano entrambe le fasi
  // devono contare una volta sola.
  istanti.sort((a, b) => a - b);
  const out: Date[] = [];
  for (const t of istanti) {
    const ultimo = out[out.length - 1];
    if (ultimo && t - ultimo.getTime() <= STESSA_DISERZIONE_MS) continue;
    out.push(new Date(t));
  }
  return out;
}

/**
 * Chi era il setter a una certa data.
 *
 * PERCHE' DALLA CRONOLOGIA E NON DAL VALORE ATTUALE. La proprieta' `setter`
 * dice chi e' il setter OGGI. Quando una persona lascia l'azienda le sue
 * pratiche passano a qualcun altro, e leggendo il valore corrente tutto il suo
 * storico sparisce, attribuito a chi le ha ereditate: misurato su luglio, un
 * setter con 13 appuntamenti disertati nel vecchio foglio ne risulta zero
 * leggendo HubSpot oggi. Il 3% delle trattative ha cambiato setter dopo il
 * no-show. Ricostruendo il valore alla data lo scarto complessivo dal foglio
 * scende da 139 a 125 su 716 eventi, e quattordici persone su quarantasette si
 * avvicinano al numero giusto.
 *
 * IL RIPIEGO SUL PROPRIETARIO e' la regola del foglio Operatori, ed e' quella
 * corretta: un Advisor che si prende l'appuntamento da solo spesso non compila
 * il campo setter, ma in quel momento il setter e' lui.
 */
export function setterAllaData(storici: Record<string, Voce[]>, quando: Date): number | null {
  const valore = (voci: Voce[] | undefined): string => {
    if (!voci?.length) return "";
    // HubSpot le restituisce dalla piu' recente alla piu' vecchia.
    const ordinate = [...voci].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    let ultimo = "";
    for (const v of ordinate) {
      if (new Date(v.timestamp).getTime() > quando.getTime()) break;
      ultimo = (v.value ?? "").trim();
    }
    // Se il primo valore e' stato scritto DOPO la data che ci interessa, e'
    // comunque il piu' vicino a quel momento: meglio di niente, ed e' il caso
    // delle trattative create e assegnate nello stesso istante, dove i
    // millisecondi cadono dalla parte sbagliata.
    return ultimo || (ordinate[0].value ?? "").trim();
  };

  const scelto = valore(storici.setter) || valore(storici.hubspot_owner_id);
  if (!scelto) return null;
  const n = Number(scelto);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Id delle trattative da processare.
 * - bootstrap    : tutte quelle CREATE da `daIso` in poi
 * - incrementale : solo quelle MODIFICATE da `daIso` in poi, indipendentemente
 *                  da quando sono state create (una trattativa di gennaio puo'
 *                  essere svolta oggi)
 */
async function* cercaTrattative(
  token: string,
  daIso: string,
  tipo: TipoSyncTrattative
): AsyncGenerator<string[]> {
  const daMs = new Date(daIso).getTime();
  const proprietaData = tipo === "incrementale" ? "hs_lastmodifieddate" : "createdate";
  let ultimoId = 0;

  while (true) {
    const d = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/crm/v3/objects/deals/search`, {
      method: "POST",
      body: {
        limit: 100,
        properties: ["hs_object_id"],
        // Paginazione per id crescente invece che con il cursore "after":
        // evita il tetto di 10.000 risultati per query.
        sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
        filterGroups: [
          {
            filters: [
              { propertyName: "hs_object_id", operator: "GT", value: String(ultimoId) },
              { propertyName: "pipeline", operator: "EQ", value: PIPELINE_APPUNTAMENTI },
              { propertyName: proprietaData, operator: "GTE", value: String(daMs) }
            ]
          }
        ]
      }
    });
    const risultati: Array<{ id: string }> = d.results ?? [];
    if (!risultati.length) return;

    yield risultati.map((r) => r.id);
    ultimoId = Number(risultati[risultati.length - 1].id);
    await sleep(150);
  }
}

/**
 * Il contatto associato a ciascuna trattativa.
 *
 * Serve a sapere se quella persona era stata assegnata subito: il marcatore
 * "_test_instant" sta sulla cronologia del contatto, mentre la trattativa porta
 * il nome campagna com'era alla sua nascita, di solito senza marcatore.
 *
 * Ogni trattativa ha esattamente un contatto: verificato su 300 campioni, zero
 * casi con piu' di uno. Se un giorno ne comparissero due si prende il primo,
 * che e' anche il piu' antico nell'ordine restituito da HubSpot.
 *
 * L'API accetta 200 input per chiamata e risponde in circa 300 ms: sul giro
 * incrementale sono una o due chiamate in tutto.
 */
export async function leggiContatti(token: string, dealIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < dealIds.length; i += 200) {
    const d = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/crm/v4/associations/deals/contacts/batch/read`, {
      method: "POST",
      body: { inputs: dealIds.slice(i, i + 200).map((id) => ({ id })) }
    });
    for (const r of d.results ?? []) {
      const contatto = (r.to ?? [])[0]?.toObjectId;
      if (contatto) out.set(String(r.from?.id), Number(contatto));
    }
  }
  return out;
}

const idCampagne = new Map<string, number>();

async function risolviIdCampagne(nomi: string[]): Promise<void> {
  const mancanti = Array.from(new Set(nomi.filter((n) => n && !idCampagne.has(n))));
  if (!mancanti.length) return;

  const db = getDb();
  await db.query(
    `INSERT INTO campagna (nome) SELECT DISTINCT unnest($1::text[]) ON CONFLICT (nome) DO NOTHING`,
    [mancanti]
  );
  const { rows } = await db.query(`SELECT id, nome FROM campagna WHERE nome = ANY($1::text[])`, [mancanti]);
  for (const r of rows) idCampagne.set(r.nome as string, r.id as number);
}

export type TipoSyncTrattative = "bootstrap" | "incrementale";
export type EsitoTrattative = {
  trattative: number;
  svolte: number;
  /** Ingressi nella fase No Show: una trattativa puo' contribuirne piu' di uno. */
  noShow: number;
  senzaCampagna: number;
  /** true se il tetto e' scattato: restano trattative non processate. */
  troncato: boolean;
};
export type OpzioniTrattative = {
  daIso?: string;
  onProgresso?: (s: EsitoTrattative) => void;
};

// Un giro incrementale gira dentro una funzione Vercel da 60 secondi. A ~34
// trattative/secondo, 1200 sono circa 35s: resta margine per la ricerca
// iniziale e per un eventuale rallentamento. Superato il tetto ci si ferma e lo
// si dichiara, invece di farsi uccidere a meta' lasciando dati incoerenti.
const MAX_INCREMENTALE = 1200;

/**
 * Inizio della finestra per l'incrementale: dall'ultima esecuzione RIUSCITA,
 * meno 30 minuti di margine. Se non ce n'e' mai stata una, si guarda indietro
 * 24 ore. Ancorare all'ultimo successo (e non a "un'ora fa") fa si' che un giro
 * saltato venga recuperato dal successivo, senza buchi.
 */
async function inizioFinestraIncrementale(): Promise<string> {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT iniziato_at FROM sync_log WHERE tipo = 'trattative' AND esito = 'ok'
     ORDER BY iniziato_at DESC LIMIT 1`
  );
  if (rows[0]?.iniziato_at) {
    return new Date(new Date(rows[0].iniziato_at).getTime() - 30 * 60_000).toISOString();
  }
  return new Date(Date.now() - 24 * 3600_000).toISOString();
}

/**
 * Tutto quello che serve per decidere se una transizione e' una consulenza
 * svolta: i criteri del workflow, le proprieta' da leggere, le etichette delle
 * fasi e l'id della fase No Show.
 *
 * E' ESTRATTO PERCHE' HA DUE CHIAMANTI: il giro completo qui sotto e
 * l'aggiornamento della singola trattativa che arriva dal webhook. Tenerne una
 * copia sola e' la ragione per cui i due non possono dare risposte diverse
 * sulla stessa trattativa - che sarebbe l'errore peggiore, perche' nessuno lo
 * noterebbe finche' i numeri di una pagina non smettono di tornare con quelli
 * di un'altra.
 */
export type ContestoSvolte = {
  gruppi: Filtro[][];
  proprieta: string[];
  conStorico: string[];
  etichettaFase: Map<string, string>;
  idFaseNoShow: string;
  /** Serve a riconoscere le diserzioni segnate come Ripianificata con motivo
   *  "Mancata Presenza", che non passano dalla fase No Show. */
  idFaseRipianificata: string;
};

export async function preparaContesto(token: string): Promise<ContestoSvolte> {
  const gruppi = await leggiCriteriSvolte(token);
  if (!gruppi.length) throw new Error("Nessun criterio letto dal workflow: non si puo' stabilire cosa sia svolto.");
  const proprieta = [...new Set(gruppi.flat().map((f) => f.proprieta))];
  // La cronologia serve su dealstage (le transizioni) e motivo (la variante di
  // Ripianificata). fase_precedente NON viene letta: si ricostruisce, vedi
  // primaSvolta().
  // dealstage per le transizioni, motivo per la variante di Ripianificata,
  // setter e hubspot_owner_id per sapere DI CHI era la pratica al momento dei
  // fatti - non oggi. Vedi setterAllaData().
  const conStorico = ["dealstage", "motivo", "setter", "hubspot_owner_id"];

  // Etichette delle fasi: i criteri confrontano fase_precedente con i nomi
  // ("Da Svolgere", "No Show"...), mentre la cronologia contiene gli ID.
  const pipeline = await chiamaHubSpot<any>(
    token,
    `${HUBSPOT_API}/crm/v3/pipelines/deals/${PIPELINE_APPUNTAMENTI}`
  );
  const etichettaFase = new Map<string, string>(
    (pipeline.stages ?? []).map((s: any) => [String(s.id), String(s.label)])
  );
  if (!etichettaFase.size) throw new Error("Nessuna fase letta dalla pipeline: impossibile ricostruire le transizioni.");

  const idFaseNoShow = [...etichettaFase].find(([, label]) => label === "No Show")?.[0];
  if (!idFaseNoShow) throw new Error("Fase 'No Show' non trovata nella pipeline: impossibile contare gli appuntamenti disertati.");

  // Se un giorno la fase venisse rinominata non si interrompe niente: si torna
  // a contare le sole diserzioni che passano dalla fase No Show, com'era prima.
  const idFaseRipianificata = [...etichettaFase].find(([, label]) => label === "Ripianificata")?.[0] ?? "";
  if (!idFaseRipianificata) {
    console.warn("[trattative] fase 'Ripianificata' non trovata: le diserzioni segnate con quel motivo non verranno contate.");
  }

  return { gruppi, proprieta, conStorico, etichettaFase, idFaseNoShow, idFaseRipianificata };
}

/**
 * Ricalcola UNA trattativa e ne riscrive la riga.
 *
 * E' quello che fa il giro completo, su un input di uno: stesse letture, stesse
 * funzioni di calcolo, stesso SQL. Serve al webhook dei workflow HubSpot, che
 * arriva quando una trattativa cambia fase - cioe' nell'istante in cui diventa
 * svolta o disertata - invece di aspettare la ricostruzione notturna di tutto.
 *
 * PERCHE' RICALCOLA INVECE DI PRENDERE "ADESSO". Il workflow scatta a ogni
 * cambio di fase_precedente, e solo alcuni di quei cambi valgono come
 * consulenza svolta: la selezione la fanno i criteri, applicati alla cronologia
 * in ordine. Prendere l'istante della chiamata come data della svolta
 * segnerebbe svolte anche dove non ce ne sono.
 *
 * Restituisce null se la trattativa non e' leggibile o non ha una data di
 * creazione valida, come fa il giro completo.
 */
export async function aggiornaUnaTrattativa(
  token: string,
  dealId: string,
  contesto?: ContestoSvolte
): Promise<{ dealId: number; svolta: Date | null; noShow: number } | null> {
  const { gruppi, proprieta, conStorico, etichettaFase, idFaseNoShow, idFaseRipianificata } =
    contesto ?? (await preparaContesto(token));

  const d = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/crm/v3/objects/deals/batch/read`, {
    method: "POST",
    body: {
      inputs: [{ id: dealId }],
      properties: [...proprieta, "id_campagna_track", "id_campagna_track_last", "createdate"],
      propertiesWithHistory: conStorico
    }
  });

  const r = (d.results ?? [])[0];
  if (!r) return null;

  const creata = new Date(r.properties?.createdate ?? "");
  if (Number.isNaN(creata.getTime())) return null;

  const contatti = await leggiContatti(token, [String(r.id)]);
  const campagna = campagnaEffettiva(
    r.properties?.id_campagna_track,
    r.properties?.id_campagna_track_last,
    creata.getTime()
  );
  const svolta = primaSvolta(gruppi, r.propertiesWithHistory ?? {}, r.properties ?? {}, etichettaFase);
  const setterId = setterAllaData(r.propertiesWithHistory ?? {}, creata);
  const noShow = ingressiNoShow(r.propertiesWithHistory ?? {}, idFaseNoShow, idFaseRipianificata).map((ts) => ({
    ts,
    setterId: setterAllaData(r.propertiesWithHistory ?? {}, ts)
  }));

  await risolviIdCampagne([campagna]);
  const campagnaId = campagna ? idCampagne.get(campagna) ?? null : null;
  const db = getDb();

  await db.query(
    `INSERT INTO trattativa (deal_id, campagna_id, creata_ts, svolta_ts, contact_id, setter_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (deal_id) DO UPDATE
       SET campagna_id = EXCLUDED.campagna_id,
           creata_ts   = EXCLUDED.creata_ts,
           svolta_ts   = EXCLUDED.svolta_ts,
           -- Se l'associazione non arriva si tiene quella gia' salvata,
           -- invece di cancellarla con un NULL. Idem per il setter.
           contact_id  = COALESCE(EXCLUDED.contact_id, trattativa.contact_id),
           setter_id   = COALESCE(EXCLUDED.setter_id, trattativa.setter_id)`,
    [Number(r.id), campagnaId, creata, svolta, contatti.get(String(r.id)) ?? null, setterId]
  );

  // Come nel giro completo: si cancella e si reinserisce, cosi' sparisce anche
  // un no show che non risulta piu' nella cronologia.
  await db.query(`DELETE FROM no_show WHERE deal_id = $1`, [Number(r.id)]);
  if (noShow.length) {
    await db.query(
      `INSERT INTO no_show (deal_id, ts, campagna_id, setter_id)
       SELECT * FROM UNNEST($1::bigint[], $2::timestamptz[], $3::int[], $4::bigint[])
       ON CONFLICT (deal_id, ts) DO UPDATE
         SET campagna_id = EXCLUDED.campagna_id,
             setter_id   = EXCLUDED.setter_id`,
      [
        noShow.map(() => Number(r.id)),
        noShow.map((n) => n.ts),
        noShow.map(() => campagnaId),
        noShow.map((n) => n.setterId)
      ]
    );
  }

  return { dealId: Number(r.id), svolta, noShow: noShow.length };
}

export async function sincronizzaTrattative(
  token: string,
  tipo: TipoSyncTrattative = "bootstrap",
  opzioni: OpzioniTrattative = {}
): Promise<EsitoTrattative> {
  const daIso =
    opzioni.daIso ?? (tipo === "incrementale" ? await inizioFinestraIncrementale() : "2026-01-01");
  const db = getDb();

  const {
    rows: [log]
  } = await db.query(`INSERT INTO sync_log (tipo) VALUES ('trattative') RETURNING id`);

  const { gruppi, proprieta, conStorico, etichettaFase, idFaseNoShow, idFaseRipianificata } = await preparaContesto(token);

  const esito: EsitoTrattative = { trattative: 0, svolte: 0, noShow: 0, senzaCampagna: 0, troncato: false };

  try {
    for await (const blocco of cercaTrattative(token, daIso, tipo)) {
      // Una chiamata per blocco, non una per trattativa.
      const contatti = await leggiContatti(token, blocco);

      for (let i = 0; i < blocco.length; i += MAX_INPUT_STORICO) {
        const gruppoIds = blocco.slice(i, i + MAX_INPUT_STORICO);
        const d = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/crm/v3/objects/deals/batch/read`, {
          method: "POST",
          body: {
            inputs: gruppoIds.map((id) => ({ id })),
            properties: [...proprieta, "id_campagna_track", "id_campagna_track_last", "createdate"],
            propertiesWithHistory: conStorico
          }
        });

        const righe: Array<{
          dealId: number;
          contactId: number | null;
          campagna: string;
          creata: Date;
          svolta: Date | null;
          setterId: number | null;
          noShow: Array<{ ts: Date; setterId: number | null }>;
        }> = [];
        for (const r of d.results ?? []) {
          const creata = new Date(r.properties?.createdate ?? "");
          if (Number.isNaN(creata.getTime())) continue;
          righe.push({
            dealId: Number(r.id),
            contactId: contatti.get(String(r.id)) ?? null,
            campagna: campagnaEffettiva(
              r.properties?.id_campagna_track,
              r.properties?.id_campagna_track_last,
              creata.getTime()
            ),
            creata,
            svolta: primaSvolta(gruppi, r.propertiesWithHistory ?? {}, r.properties ?? {}, etichettaFase),
            // Il setter di quando l'appuntamento e' stato fissato.
            setterId: setterAllaData(r.propertiesWithHistory ?? {}, creata),
            // E per ogni diserzione, quello di quel giorno: fra il primo
            // appuntamento e un no-show di due mesi dopo il lead puo' essere
            // passato di mano.
            noShow: ingressiNoShow(r.propertiesWithHistory ?? {}, idFaseNoShow, idFaseRipianificata).map((ts) => ({
              ts,
              setterId: setterAllaData(r.propertiesWithHistory ?? {}, ts)
            }))
          });
        }
        if (!righe.length) continue;

        await risolviIdCampagne(righe.map((x) => x.campagna));

        await db.query(
          `INSERT INTO trattativa (deal_id, campagna_id, creata_ts, svolta_ts, contact_id, setter_id)
           SELECT * FROM UNNEST($1::bigint[], $2::int[], $3::timestamptz[], $4::timestamptz[], $5::bigint[], $6::bigint[])
           ON CONFLICT (deal_id) DO UPDATE
             SET campagna_id = EXCLUDED.campagna_id,
                 creata_ts   = EXCLUDED.creata_ts,
                 svolta_ts   = EXCLUDED.svolta_ts,
                 -- Se l'associazione non arriva si tiene quella gia' salvata,
                 -- invece di cancellarla con un NULL. Stesso ragionamento per
                 -- il setter: una cronologia vuota non deve azzerare un nome
                 -- che avevamo gia'.
                 contact_id  = COALESCE(EXCLUDED.contact_id, trattativa.contact_id),
                 setter_id   = COALESCE(EXCLUDED.setter_id, trattativa.setter_id)`,
          [
            righe.map((x) => x.dealId),
            righe.map((x) => (x.campagna ? idCampagne.get(x.campagna) ?? null : null)),
            righe.map((x) => x.creata),
            righe.map((x) => x.svolta),
            righe.map((x) => x.contactId),
            righe.map((x) => x.setterId)
          ]
        );

        // I no-show della trattativa vengono riscritti per intero: cancellare e
        // reinserire rende il sync idempotente anche se un evento sparisce
        // dalla cronologia o ne compare uno nuovo.
        const dealIds = righe.map((x) => x.dealId);
        await db.query(`DELETE FROM no_show WHERE deal_id = ANY($1::bigint[])`, [dealIds]);

        const eventiNs = righe.flatMap((x) =>
          x.noShow.map((n) => ({
            dealId: x.dealId,
            ts: n.ts,
            campagnaId: x.campagna ? idCampagne.get(x.campagna) ?? null : null,
            setterId: n.setterId
          }))
        );
        if (eventiNs.length) {
          await db.query(
            `INSERT INTO no_show (deal_id, ts, campagna_id, setter_id)
             SELECT * FROM UNNEST($1::bigint[], $2::timestamptz[], $3::int[], $4::bigint[])
             ON CONFLICT (deal_id, ts) DO UPDATE
               SET campagna_id = EXCLUDED.campagna_id,
                   setter_id   = EXCLUDED.setter_id`,
            [
              eventiNs.map((e) => e.dealId),
              eventiNs.map((e) => e.ts),
              eventiNs.map((e) => e.campagnaId),
              eventiNs.map((e) => e.setterId)
            ]
          );
        }
        esito.noShow += eventiNs.length;

        esito.trattative += righe.length;
        esito.svolte += righe.filter((x) => x.svolta).length;
        esito.senzaCampagna += righe.filter((x) => !x.campagna).length;
        opzioni.onProgresso?.({ ...esito });
        await sleep(120);

        if (tipo === "incrementale" && esito.trattative >= MAX_INCREMENTALE) {
          esito.troncato = true;
          break;
        }
      }
      if (esito.troncato) break;
    }

    await db.query(
      `UPDATE sync_log SET finito_at = now(), contatti = $2, eventi = $3, esito = $4, messaggio = $5 WHERE id = $1`,
      [
        log.id,
        esito.trattative,
        esito.svolte,
        // Un giro troncato NON e' un successo: marcarlo 'ok' sposterebbe in
        // avanti la finestra del giro successivo, lasciando un buco permanente.
        esito.troncato ? "errore" : "ok",
        esito.troncato
          ? `Troncato al tetto di ${MAX_INCREMENTALE}: la finestra da recuperare e' troppo ampia. Rilanciare "npm run bootstrap:trattative".`
          : null
      ]
    );
    return esito;
  } catch (err) {
    await db.query(`UPDATE sync_log SET finito_at = now(), esito = 'errore', messaggio = $2 WHERE id = $1`, [
      log.id,
      err instanceof Error ? err.message : String(err)
    ]);
    throw err;
  }
}
