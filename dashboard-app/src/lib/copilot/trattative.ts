import { getDb } from "@/lib/db";

/**
 * Le trattative dei chatter, rilanciate a Sales Copilot quando cambiano fase.
 *
 * PERCHE' DA QUI E NON DA UN FLUSSO HUBSPOT. Il flusso nativo si poteva fare -
 * iscrizione su "Setter e' uno dei chatter", azione webhook - ma tre cose lo
 * rendevano fragile. L'elenco dei chatter sarebbe stato scritto a mano dentro
 * un flusso, e ogni chatter nuovo un giorno in cui nessuno se ne accorge. I
 * dati per agganciare il lead (email, telefono) stanno sul CONTATTO e non
 * sulla trattativa, dove l'email e' compilata 8 volte su 94: servivano azioni
 * di copia su proprieta' create apposta. E un invio fallito restava un errore
 * dentro la cronologia di un flusso, cioe' invisibile.
 *
 * DA QUI INVECE: chi e' chatter lo dice la fotografia dei team (la stessa che
 * usa la Dashboard, quindi un chatter nuovo entra da solo), il contatto lo
 * leggiamo noi, e ogni invio lascia una riga - con la risposta di Copilot
 * dentro - che permette di rimandare quello che non e' passato.
 *
 * L'INNESCO E' GIA' IN PRODUZIONE: il webhook di HubSpot che ci avvisa a ogni
 * cambio di fase (/api/webhook/hubspot/trattativa, 83 chiamate il 13 ottobre
 * 2026). Non aggiungiamo un secondo canale a HubSpot: ci appoggiamo a quello
 * che c'e', che e' anche il motivo per cui questo arriva in tempo reale e non
 * al prossimo giro di sincronizzazione, che gira sei volte al giorno.
 */

const COPILOT = "https://salescopilot.it/api/v1/hubspot/deals";
const HUBSPOT = "https://api.hubapi.com";

/**
 * SOLO LA PIPELINE APPUNTAMENTI (HIGH TICKET), come dice la scheda data a
 * Copilot il 14 ottobre 2026. Prima passava qualunque trattativa di un
 * chatter, e a loro sono arrivate una Vinta della Low Ticket e una Consulenza
 * Prenotata della Evergreen Webinar: fasi che non sapevano leggere. Per
 * mandare anche altre pipeline basta togliere il filtro: il campo `pipeline`
 * viaggia comunque nel corpo.
 */
const PIPELINE_HIGH_TICKET = "433643709";

/** Il sotto-team che fa di una persona un chatter, come su HubSpot. */
const TEAM_CHATTER = "Chatter";

/** Quanto aspettare prima di riprovare un invio fallito. */
const RIPROVA_DOPO_MINUTI = 10;

export type EsitoInvio = {
  mandata: boolean;
  /** Non era da mandare (altra pipeline): non e' un errore e non si rimanda. */
  ignorata?: boolean;
  /** Una riga da mettere nei registri: dice sempre perche'. */
  riga: string;
};

/**
 * Rilancia una trattativa, se e' di un chatter.
 *
 * NON FA NIENTE PER TUTTE LE ALTRE, ed e' la condizione piu' importante del
 * file: a Copilot interessano i lead che hanno lavorato loro. Mandare tutto
 * sarebbe anche piu' semplice, ma riempirebbe il loro archivio di trattative
 * che non possono agganciare a nessuno.
 */
export async function rilanciaACopilot(dealId: string, tokenHubspot: string): Promise<EsitoInvio> {
  const db = getDb();

  const { rows } = await db.query<{
    deal_id: string;
    fase: string | null;
    fase_ts: Date | null;
    setter_id: string | null;
    contact_id: string | null;
  }>(
    `SELECT deal_id::text, fase, fase_ts, setter_id::text, contact_id::text
       FROM trattativa WHERE deal_id = $1`,
    [dealId]
  );
  const t = rows[0];
  if (!t) return { mandata: false, riga: `${dealId}: non in tabella, niente da rilanciare` };
  if (!t.setter_id) return { mandata: false, riga: `${dealId}: senza setter` };

  if (!(await eChatter(t.setter_id, tokenHubspot))) {
    return { mandata: false, riga: `${dealId}: il setter non e' un chatter` };
  }

  const corpo = await componi(dealId, t, tokenHubspot);
  // Si salta solo se la pipeline e' NOTA e diversa: se la lettura della
  // trattativa non e' riuscita si manda lo stesso, come prima del filtro.
  if (corpo.pipeline && corpo.pipeline !== PIPELINE_HIGH_TICKET) {
    return { mandata: false, ignorata: true, riga: `${dealId}: pipeline ${corpo.pipeline}, non e' la High Ticket` };
  }
  return await manda(dealId, t, corpo);
}

/**
 * Quel setter e' un chatter?
 *
 * DUE IDENTIFICATIVI DIVERSI, E NON COINCIDONO SEMPRE. Il campo `setter` della
 * trattativa porta l'id del PROPRIETARIO, la fotografia dei team porta l'id
 * dell'UTENTE: per quasi tutti sono lo stesso numero, per Bartolo Giordanengo
 * no - proprietario 1722494666, utente 63034338. Confrontandoli direttamente,
 * le sue trattative non sarebbero mai state rilanciate, e nessuno se ne sarebbe
 * accorto: non c'e' errore, c'e' una condizione che non scatta.
 *
 * IL PONTE SONO GLI OWNER DI HUBSPOT, che portano tutti e due i numeri piu'
 * l'email. Si prova prima l'id utente e poi l'email, perche' un id non si
 * scrive male e un'email cambia di rado - ma qualcosa deve pur reggere il peso,
 * e il nome non lo regge (lo abbiamo imparato il 13 ottobre con una collega
 * rinominata a meta' giornata).
 */
let cacheOwner: { quando: number; per: Map<string, { userId: string; email: string }> } | null = null;

async function eChatter(setterId: string, token: string): Promise<boolean> {
  if (!cacheOwner || Date.now() - cacheOwner.quando > 30 * 60_000) {
    const per = new Map<string, { userId: string; email: string }>();
    let dopo: string | undefined;
    for (let p = 0; p < 12; p++) {
      const u = new URL(`${HUBSPOT}/crm/v3/owners`);
      u.searchParams.set("limit", "100");
      if (dopo) u.searchParams.set("after", dopo);
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!r.ok) break;
      const d = (await r.json()) as {
        results?: Array<{ id: string; userId?: number | string; email?: string }>;
        paging?: { next?: { after?: string } };
      };
      for (const o of d.results ?? []) {
        per.set(String(o.id), { userId: String(o.userId ?? ""), email: String(o.email ?? "") });
      }
      dopo = d.paging?.next?.after;
      if (!dopo) break;
    }
    cacheOwner = { quando: Date.now(), per };
  }

  const chi = cacheOwner.per.get(String(setterId));
  const { rows } = await getDb().query(
    `SELECT 1 FROM utente_team_adesso
      WHERE genere = 'secondario' AND team_nome = $1
        AND (user_id = $2 OR (email <> '' AND lower(email) = lower($3)) OR user_id = $4)`,
    [TEAM_CHATTER, chi?.userId ?? "", chi?.email ?? "", String(setterId)]
  );
  return rows.length > 0;
}

/**
 * Il corpo da mandare: la trattativa piu' i recapiti del CONTATTO.
 *
 * I RECAPITI SONO LA PARTE CHE CONTA. Copilot aggancia il lead per email,
 * telefono o profilo Instagram; senza, salva la trattativa e non la collega a
 * nessuno - `matched: 0`, cioe' tutto il giro per niente. Misurato il 13
 * ottobre 2026 su sessanta trattative di chatter: il contatto collegato aveva
 * l'email in 60 casi su 60 e il telefono in 60 su 60, l'Instagram in 3.
 */
export async function componi(
  dealId: string,
  t: { fase: string | null; fase_ts: Date | null; setter_id: string | null; contact_id: string | null },
  token: string
): Promise<Record<string, string>> {
  const corpo: Record<string, string> = { hs_object_id: dealId };
  if (t.fase) corpo.dealstage = t.fase;
  if (t.setter_id) corpo.setter = t.setter_id;
  // Serve a loro per scartare un webhook arrivato in ritardo con dati vecchi.
  if (t.fase_ts) corpo.hs_lastmodifieddate = String(new Date(t.fase_ts).getTime());

  const deal = await leggi(
    `${HUBSPOT}/crm/v3/objects/deals/${dealId}?properties=dealname,amount,closedate,dealstage,pipeline,hubspot_owner_id,hs_lastmodifieddate`,
    token
  );
  for (const campo of [
    "dealname",
    "amount",
    "closedate",
    "dealstage",
    "pipeline",
    "hubspot_owner_id",
    "hs_lastmodifieddate"
  ]) {
    const v = deal?.properties?.[campo];
    if (v) corpo[campo] = String(v);
  }

  if (t.contact_id) {
    const c = await leggi(
      `${HUBSPOT}/crm/v3/objects/contacts/${t.contact_id}?properties=email,phone,mobilephone,` +
        `profilo_instagram,link_trascrizione_fireflies,link_audio_fireflies`,
      token
    );
    const p = c?.properties ?? {};
    // I NOMI CONTENGONO email/telefono/instagram DI PROPOSITO: e' cosi' che
    // Copilot li riconosce, qualunque prefisso abbiano.
    if (p.email) corpo.email_contatto = String(p.email);
    const tel = p.phone || p.mobilephone;
    if (tel) corpo.telefono_contatto = String(tel);
    if (p.profilo_instagram) corpo.instagram_contatto = String(p.profilo_instagram);

    // IL LINK FIREFLIES, CHE DA NOI NON E' UN LINK FIREFLIES.
    //
    // Su HubSpot quella proprieta' contiene un indirizzo della NOSTRA
    // dashboard - /api/trascrizione/<id>.do - con dentro l'id della
    // trascrizione. Copilot riconosce i link app.fireflies.ai, oppure l'id
    // nudo purche' il campo si chiami fireflies_qualcosa: si manda l'id, che e'
    // la parte che non dipende da come serviamo noi le trascrizioni.
    //
    // A COSA SERVE A LORO: hanno circa 930 registrazioni che non riescono ad
    // attaccare a nessun lead. Questo e' il filo che le lega.
    const id = idFireflies(p.link_trascrizione_fireflies ?? p.link_audio_fireflies ?? "");
    if (id) {
      corpo.fireflies_id = id;
      corpo.fireflies_url = `https://app.fireflies.ai/view/${id}`;
    }
  }
  return corpo;
}

/**
 * L'id di una trascrizione dentro un indirizzo, qualunque forma abbia.
 *
 * Si accettano sia i nostri link (/api/trascrizione/<id>.do) sia quelli di
 * Fireflies (app.fireflies.ai/view/<id>), perche' quella proprieta' su HubSpot
 * la scrivono flussi diversi e non e' detto che domani abbia la stessa forma.
 * Se non si riconosce niente si restituisce stringa vuota: meglio non mandare
 * il campo che mandarne uno sbagliato, che loro proverebbero ad agganciare.
 */
function idFireflies(valore: string): string {
  const t = String(valore).trim();
  if (!t) return "";
  const m = /([0-9A-Z]{20,32})/i.exec(t.replace(/\.do/i, ""));
  return m ? m[1] : "";
}

async function leggi(url: string, token: string): Promise<{ properties?: Record<string, string> } | null> {
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!r.ok) return null;
    return (await r.json()) as { properties?: Record<string, string> };
  } catch {
    return null;
  }
}

/**
 * L'invio vero, e la riga che resta.
 *
 * SENZA CHIAVE NON E' UN ERRORE DA BUTTARE: si segna "in attesa di chiave" e
 * la riga resta da rimandare. Il giorno in cui la chiave arriva, il
 * rinvio recupera da solo tutto quello che nel frattempo e' passato di fase.
 */
async function manda(
  dealId: string,
  t: { fase: string | null; fase_ts: Date | null },
  corpo: Record<string, string>
): Promise<EsitoInvio> {
  const chiave = process.env.SALESCOPILOT_WEBHOOK_KEY;
  if (!chiave) {
    await annota(dealId, t, "senza-chiave", null, "SALESCOPILOT_WEBHOOK_KEY non impostata");
    return { mandata: false, riga: `${dealId}: in attesa della chiave Copilot` };
  }

  try {
    const r = await fetch(COPILOT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chiave}`,
        "Content-Type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify(corpo)
    });
    const testo = (await r.text()).slice(0, 500);
    let agganciate: number | null = null;
    try {
      agganciate = (JSON.parse(testo) as { matched?: number }).matched ?? null;
    } catch {
      /* la risposta non e' JSON: resta nel messaggio */
    }
    const ok = r.ok;
    await annota(dealId, t, ok ? "ok" : "errore", agganciate, `HTTP ${r.status} ${testo}`);
    return {
      mandata: ok,
      // AGGANCIATE 0 SI DICE, anche quando la chiamata e' andata bene: vuol
      // dire che Copilot ha salvato la trattativa senza sapere di chi e', ed e'
      // il modo in cui questo giro diventa inutile senza che nessuno se ne
      // accorga.
      riga: `${dealId}: HTTP ${r.status}${agganciate === null ? "" : `, agganciate ${agganciate}`}`
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await annota(dealId, t, "errore", null, m);
    return { mandata: false, riga: `${dealId}: invio non riuscito (${m})` };
  }
}

async function annota(
  dealId: string,
  t: { fase: string | null; fase_ts: Date | null },
  esito: string,
  agganciate: number | null,
  messaggio: string
): Promise<void> {
  try {
    await getDb().query(
      `INSERT INTO copilot_trattativa_invio (deal_id, fase, fase_ts, esito, agganciate, messaggio)
       VALUES ($1::bigint, $2, $3, $4, $5, $6)`,
      [dealId, t.fase, t.fase_ts, esito, agganciate, messaggio.slice(0, 1000)]
    );
  } catch (e) {
    console.error("[copilot/trattative] non sono riuscito ad annotare", e);
  }
}

/**
 * Rimanda quello che non e' passato.
 *
 * SI CHIAMA DALLO STESSO WEBHOOK, ogni volta che arriva un cambio di fase:
 * cosi' un errore di rete o una chiave mancante si recuperano da soli al
 * primo movimento successivo, senza un cron - che su questo piano Vercel non
 * si potrebbe comunque avere piu' di una volta al giorno.
 *
 * UNA SOLA PER TRATTATIVA, LA PIU' RECENTE: Copilot tiene lo stato piu' nuovo,
 * quindi rimandare i passaggi intermedi di una trattativa gia' superata non
 * aggiunge niente e consuma chiamate.
 */
export async function rimandaInSospeso(tokenHubspot: string, quante = 5): Promise<string[]> {
  if (!process.env.SALESCOPILOT_WEBHOOK_KEY) return [];
  const { rows } = await getDb().query<{ deal_id: string }>(
    `SELECT DISTINCT ON (deal_id) deal_id::text
       FROM copilot_trattativa_invio
      WHERE esito <> 'ok'
        AND inviato_at < now() - ($1 || ' minutes')::interval
        AND deal_id NOT IN (
          SELECT deal_id FROM copilot_trattativa_invio WHERE esito = 'ok'
        )
      ORDER BY deal_id, inviato_at DESC
      LIMIT $2`,
    [String(RIPROVA_DOPO_MINUTI), quante]
  );
  const righe: string[] = [];
  for (const r of rows) {
    const e = await rilanciaACopilot(r.deal_id, tokenHubspot);
    righe.push(`rinvio ${e.riga}`);
  }
  return righe;
}


/**
 * Lo storico: le trattative dei chatter gia' passate, mandate in blocco.
 *
 * PERCHE' SERVE. Il rilancio parte quando una trattativa CAMBIA, quindi di
 * tutto quello che e' successo prima Copilot non sa niente - al 14 ottobre 2026
 * ne avevano ricevute tre. Senza lo storico, le circa 930 registrazioni che
 * hanno in archivio restano senza un lead a cui attaccarsi.
 *
 * SI MANDA A LOTTI DI CENTO perche' e' il loro limite dichiarato, e con un
 * respiro fra un lotto e l'altro: una notte abbiamo gia' fatto rifiutare
 * diciotto richieste al loro server, e non e' il caso di rifarlo.
 *
 * NON SOSTITUISCE IL RILANCIO: questo e' il passato, quello e' il presente.
 * Mandare due volte la stessa trattativa non crea problemi - lo dicono loro, e
 * ogni invio porta `hs_lastmodifieddate`, che fa vincere il piu' recente.
 */
export async function storicoACopilot(
  da: string,
  tokenHubspot: string,
  opzioni: { lotto?: number; massimo?: number; respiroMs?: number } = {}
): Promise<{ trattative: number; lotti: number; agganciate: number; errori: number }> {
  const chiave = process.env.SALESCOPILOT_WEBHOOK_KEY;
  if (!chiave) throw new Error("SALESCOPILOT_WEBHOOK_KEY non impostata");
  const lotto = opzioni.lotto ?? 100;
  const respiro = opzioni.respiroMs ?? 1500;

  const { rows } = await getDb().query<{
    deal_id: string;
    fase: string | null;
    fase_ts: Date | null;
    setter_id: string | null;
    contact_id: string | null;
  }>(
    `SELECT deal_id::text, fase, fase_ts, setter_id::text, contact_id::text
       FROM trattativa
      WHERE creata_ts >= $1::date AND setter_id IS NOT NULL
      ORDER BY creata_ts`,
    [da]
  );

  // Chi e' chatter si chiede una volta per setter, non una per trattativa.
  const sonoChatter = new Map<string, boolean>();
  const nostre: typeof rows = [];
  for (const t of rows) {
    const id = String(t.setter_id);
    if (!sonoChatter.has(id)) sonoChatter.set(id, await eChatter(id, tokenHubspot));
    if (sonoChatter.get(id)) nostre.push(t);
  }
  if (opzioni.massimo) nostre.splice(opzioni.massimo);

  let agganciate = 0;
  let errori = 0;
  let lotti = 0;
  for (let i = 0; i < nostre.length; i += lotto) {
    const pezzo = nostre.slice(i, i + lotto);
    const corpi = [];
    for (const t of pezzo) {
      const corpo = await componi(t.deal_id, t, tokenHubspot);
      if (!corpo.pipeline || corpo.pipeline === PIPELINE_HIGH_TICKET) corpi.push(corpo);
    }
    if (!corpi.length) {
      lotti++;
      continue;
    }
    try {
      const r = await fetch(COPILOT, {
        method: "POST",
        headers: { Authorization: `Bearer ${chiave}`, "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(corpi)
      });
      const testo = (await r.text()).slice(0, 500);
      const esito = r.ok ? "ok" : "errore";
      let n: number | null = null;
      try {
        n = (JSON.parse(testo) as { matched?: number }).matched ?? null;
      } catch {
        /* non JSON */
      }
      if (n) agganciate += n;
      if (!r.ok) errori += pezzo.length;
      for (const t of pezzo) {
        await annota(t.deal_id, t, esito, n, `storico, lotto di ${pezzo.length}: HTTP ${r.status} ${testo.slice(0, 120)}`);
      }
      console.log(`[storico] lotto ${lotti + 1}: ${pezzo.length} trattative, HTTP ${r.status}, agganciate ${n ?? "?"}`);
    } catch (e) {
      errori += pezzo.length;
      const m = e instanceof Error ? e.message : String(e);
      for (const t of pezzo) await annota(t.deal_id, t, "errore", null, `storico: ${m}`);
      console.error(`[storico] lotto ${lotti + 1} non riuscito: ${m}`);
    }
    lotti++;
    if (i + lotto < nostre.length) await new Promise((ok) => setTimeout(ok, respiro));
  }
  return { trattative: nostre.length, lotti, agganciate, errori };
}
