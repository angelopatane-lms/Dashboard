// Collega le registrazioni di Fireflies ai contatti di HubSpot.
//
// COSA SOSTITUISCE: il flusso Zapier "Flusso Importa Link Fireflies su
// Hubspot", che faceva la stessa cosa cercando la riunione con l'orario della
// registrazione arrotondato alla mezz'ora. Quel criterio ne trovava il 57%, e
// dal 25 ottobre avrebbe smesso di funzionare del tutto perche' il fuso orario
// era scritto a mano nel codice come "+02:00".
//
// COME SI AGGANCIA: la logica di abbinamento sta in src/lib/abbinamento.ts, con
// le misure che l'hanno guidata. Qui c'e' solo il contorno - leggere le due
// sorgenti, arricchire le riunioni, scrivere il risultato.

import { getDb } from "@/lib/db";
import { registraPresenze } from "@/lib/trascrizioni/presenze";
import {
  abbina,
  type Abbinamento,
  type Registrazione,
  type Riunione
} from "@/lib/abbinamento";
import { leggiFrasi, leggiNomiCitati, leggiTrascrizioni, linkTrascrizione } from "@/lib/fireflies";
import { gettoneTrascrizione } from "@/lib/gettoneTrascrizione";

const HUBSPOT = "https://api.hubapi.com";
const MIN = 60_000;

/** La trattativa nasce da un flusso circa sei minuti dopo la riunione: misurata
 *  mediana 378 secondi, novantesimo percentile 399. Quindici minuti di finestra
 *  sono abbondanti e non arrivano a toccare la prenotazione successiva. */
const FINESTRA_TRATTATIVA = 15 * MIN;

/** Due consulenze dello stesso contatto distano almeno una mezz'ora, quindi
 *  entro questa tolleranza si tratta sempre dello stesso appuntamento. */
const TOLLERANZA_STESSA_CONSULENZA = 30 * MIN;

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * L'indirizzo che finisce sulla scheda del contatto.
 *
 * NON E' LA PAGINA DI FIREFLIES, ed e' una scelta obbligata. Quel campo lo
 * legge l'applicazione che produce l'analisi della call, e lo fa SCARICANDO
 * un file: il flusso Zapier ci scriveva un indirizzo di download generato dal
 * connettore Fireflies, un .docx firmato e valido sei ore. Da quando quel
 * flusso e' spento abbiamo scritto la pagina - stabile e adatta a chi la apre
 * per leggerla - e da una pagina quell'applicazione non ricava niente: dal 14
 * settembre le analisi si sono fermate.
 *
 * Qui si torna a un file, ma servito da noi: stesso formato, stesso modo di
 * consumarlo, e un indirizzo che non scade piu' dopo sei ore - che era anche
 * il motivo per cui certe analisi non venivano mai prodotte.
 *
 * LA NOSTRA AGENDA NON PASSA DA QUI: legge l'identificativo dal database e
 * ricava la pagina e l'audio per conto suo. Questo campo serve solo a quella
 * applicazione.
 */
function indirizzoTrascrizione(id: string): string {
  const segreto = process.env.FIREFLIES_WEBHOOK_SECRET;
  // Senza segreto non si puo' firmare: si ripiega sulla pagina, che almeno
  // resta apribile da una persona.
  if (!segreto) return linkTrascrizione(id);
  const base = process.env.APP_URL ?? "https://dashboard-smoky-eight-94.vercel.app";
  return `${base}/api/trascrizione/${id}.docx?t=${gettoneTrascrizione(id, segreto)}`;
}

export type EsitoSync = {
  periodo: { da: string; a: string };
  riunioni: number;
  registrazioni: number;
  abbinate: number;
  perCriterio: Record<string, number>;
  scritti: number;
  invariati: number;
  falliti: number;
  /** Registrazioni oltre i quindici minuti rimaste senza appuntamento. */
  orfane: number;
  /** Quanti appuntamenti hanno ricevuto un verdetto su chi era in call. */
  presenze: { nuove: number; gia: number; falliti: number };
};

async function hubspot<T>(token: string, percorso: string, corpo?: unknown, tentativi = 6): Promise<T> {
  for (let i = 0; i < tentativi; i++) {
    const res = await fetch(`${HUBSPOT}${percorso}`, {
      method: corpo ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(corpo ? { body: JSON.stringify(corpo) } : {})
    });
    if (res.status === 429) {
      await attesa(1200 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} su ${percorso}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
  throw new Error(`HubSpot continua a rispondere 429 su ${percorso}`);
}

type Pagina<T> = { results?: T[]; paging?: { next?: { after?: string } } };
type Oggetto = { id: string; properties: Record<string, string | null> };

const stanzaDa = (p: Record<string, string | null>): string | null =>
  `${p.hs_meeting_location ?? ""} ${p.hs_video_conference_url ?? ""}`.match(
    /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/
  )?.[1] ?? null;

/**
 * Quanto puo' tardare uno spostamento e valere ancora per la fascia di prima.
 *
 * Ventiquattro ore coprono i casi reali con margine: misurati due, uno spostato
 * tre minuti prima che arrivasse il webhook e uno sedici ore dopo, il mattino
 * seguente. Si contano dall'ORARIO DELL'APPUNTAMENTO e non da adesso: cosi' la
 * regola dice "una riunione spostata entro un giorno dalla sua fascia
 * appartiene ancora a quella fascia", e il webhook - che gira di continuo - e
 * il giro notturno vedono la stessa cosa.
 */
const SPOSTAMENTO_TOLLERATO_MS = 24 * 60 * 60 * 1000;

/**
 * Le riunioni che ERANO nel periodo e sono state spostate altrove.
 *
 * PERCHE' SENZA DI QUESTE SI PERDONO REGISTRAZIONI. L'abbinamento cerca le
 * riunioni per orario ATTUALE. Quando un advisor riaggancia e subito
 * ripianifica, la riunione si sposta prima che Fireflies consegni la
 * trascrizione, e quella registrazione non trova piu' nessuna fascia a cui
 * appartenere: resta orfana per sempre, perche' anche il giro notturno cerca
 * allo stesso modo.
 *
 * Successo davvero il 15 settembre, su due call di seguito della stessa
 * persona: la riunione delle 15:00 spostata alle 16:09 e il webhook arrivato
 * alle 16:12 - persa per tre minuti - e quella delle 16:00 spostata alle 17:28
 * con la trascrizione consegnata da Fireflies solo il mattino dopo. Colpisce
 * proprio chi usa di piu' la ripianificazione.
 *
 * SPOSTATA DOPO L'INIZIO della fascia: se succede prima, quella fascia e' stata
 * liberata e non c'e' nessuna call da agganciare.
 */
async function riunioniSpostateDa(token: string, da: Date, a: Date): Promise<Oggetto[]> {
  // I valori della cronologia sono date ISO, non millisecondi: Number() su
  // "2026-09-15T13:00:00Z" da' NaN e la riga verrebbe scartata in silenzio.
  const quando = (v: unknown): number => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1e11) return n;
    return Date.parse(String(v));
  };

  const candidati: string[] = [];
  let dopo: string | undefined;
  do {
    const d = await hubspot<Pagina<Oggetto>>(token, "/crm/v3/objects/meetings/search", {
      filterGroups: [
        {
          filters: [
            // Toccata da quando comincia il periodo: una riunione che era li' e
            // non c'e' piu' e' per forza stata modificata da allora.
            { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(da.getTime()) },
            // Oggi sta dopo il periodo. Se stesse dentro la troverebbe gia'
            // leggiRiunioni().
            { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(a.getTime()) },
            // Nata prima della fine del periodo: una riunione creata dopo non
            // puo' esserci stata dentro. Non e' un'euristica, e toglie di mezzo
            // tutto quello che e' stato fissato nel frattempo.
            { propertyName: "hs_createdate", operator: "LTE", value: String(a.getTime()) }
          ]
        }
      ],
      properties: ["hs_meeting_start_time"],
      limit: 100,
      ...(dopo ? { after: dopo } : {})
    });
    candidati.push(...(d.results ?? []).map((r) => String(r.id)));
    dopo = d.paging?.next?.after;
    await attesa(160);
  } while (dopo);

  if (!candidati.length) return [];

  const out: Oggetto[] = [];
  for (let i = 0; i < candidati.length; i += 50) {
    const d = await hubspot<{
      results?: Array<Oggetto & { propertiesWithHistory?: Record<string, Array<{ value: string; timestamp: string }>> }>;
    }>(token, "/crm/v3/objects/meetings/batch/read", {
      properties: [
        "hs_meeting_location",
        "hs_video_conference_url",
        "hs_meeting_start_time",
        "hs_meeting_end_time",
        "hs_createdate",
        "hubspot_owner_id"
      ],
      propertiesWithHistory: ["hs_meeting_start_time", "hs_meeting_end_time"],
      inputs: candidati.slice(i, i + 50).map((id) => ({ id }))
    });

    for (const r of d.results ?? []) {
      const storia = r.propertiesWithHistory?.hs_meeting_start_time ?? [];
      if (storia.length < 2) continue;
      const ordinata = [...storia].sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));

      for (let k = 0; k + 1 < ordinata.length; k++) {
        const inizio = quando(ordinata[k].value);
        const spostata = Date.parse(ordinata[k + 1].timestamp);
        if (!Number.isFinite(inizio) || !Number.isFinite(spostata)) continue;
        if (inizio < da.getTime() || inizio >= a.getTime()) continue;
        if (spostata < inizio || spostata > inizio + SPOSTAMENTO_TOLLERATO_MS) continue;

        const fineStoria = r.propertiesWithHistory?.hs_meeting_end_time ?? [];
        const fineOrdinata = [...fineStoria].sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));
        const fine = quando(fineOrdinata[k]?.value);

        // La riunione torna nell'elenco con l'orario di allora: da qui in poi
        // vale per tutto come una qualunque del periodo.
        out.push({
          id: String(r.id),
          properties: {
            ...r.properties,
            hs_meeting_start_time: new Date(inizio).toISOString(),
            hs_meeting_end_time: new Date(
              Number.isFinite(fine) && fine > inizio ? fine : inizio + 30 * 60 * 1000
            ).toISOString()
          }
        });
        break;
      }
    }
    await attesa(130);
  }

  return out;
}

async function leggiRiunioni(token: string, da: Date, a: Date): Promise<Oggetto[]> {
  const out: Oggetto[] = [];
  let dopo: string | undefined;
  do {
    const d = await hubspot<Pagina<Oggetto>>(token, "/crm/v3/objects/meetings/search", {
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(da.getTime()) },
            { propertyName: "hs_meeting_start_time", operator: "LT", value: String(a.getTime()) }
          ]
        }
      ],
      properties: [
        "hs_meeting_location",
        "hs_video_conference_url",
        "hs_meeting_start_time",
        "hs_meeting_end_time",
        "hs_createdate",
        "hubspot_owner_id"
      ],
      limit: 100,
      ...(dopo ? { after: dopo } : {})
    });
    out.push(...(d.results ?? []));
    dopo = d.paging?.next?.after;
    await attesa(160);
  } while (dopo);
  return out;
}

/** Associazioni a blocchi: una chiamata ogni cento invece di una per oggetto. */
async function associazioni(
  token: string,
  da: string,
  verso: string,
  ids: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await hubspot<{
      results?: Array<{ from: { id: string }; to: Array<{ toObjectId: string | number }> }>;
    }>(token, `/crm/v4/associations/${da}/${verso}/batch/read`, {
      inputs: ids.slice(i, i + 100).map((id) => ({ id }))
    });
    for (const r of d.results ?? []) {
      const lista = (r.to ?? []).map((t) => String(t.toObjectId));
      if (lista.length) out.set(String(r.from.id), lista);
    }
    await attesa(150);
  }
  return out;
}

async function leggiOggetti(
  token: string,
  tipo: string,
  ids: string[],
  proprieta: string[]
): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await hubspot<{ results?: Oggetto[] }>(token, `/crm/v3/objects/${tipo}/batch/read`, {
      properties: proprieta,
      inputs: ids.slice(i, i + 100).map((id) => ({ id }))
    });
    for (const r of d.results ?? []) out.set(String(r.id), r.properties);
    await attesa(150);
  }
  return out;
}

async function aggiornaContatto(
  token: string,
  id: string,
  proprieta: Record<string, string>
): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: proprieta })
    });
    if (res.status === 429) {
      await attesa(1200 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} sul contatto ${id}: ${(await res.text()).slice(0, 160)}`);
    return;
  }
  throw new Error(`HubSpot continua a rispondere 429 sul contatto ${id}`);
}

/**
 * Un istante in ora di Roma con il suo offset vero, es. "+02:00" d'estate e
 * "+01:00" d'inverno.
 *
 * L'offset si CALCOLA: il flusso Zapier lo aveva scritto a mano come "+02:00",
 * e dal primo cambio d'ora avrebbe dichiarato un'ora sbagliata su ogni
 * appuntamento.
 */
function isoRoma(ms: number): string {
  const locale = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })
    .format(new Date(ms))
    .replace(" ", "T");
  const scarto = Math.round((Date.parse(`${locale}Z`) - ms) / MIN);
  const segno = scarto >= 0 ? "+" : "-";
  const ore = String(Math.floor(Math.abs(scarto) / 60)).padStart(2, "0");
  const minuti = String(Math.abs(scarto) % 60).padStart(2, "0");
  return `${locale}${segno}${ore}:${minuti}`;
}

/** L'appuntamento a cui si riferisce un valore gia' scritto, dalla data fra
 *  parentesi quadre. */
const appuntamentoDi = (valore: string | null | undefined): number => {
  const dentro = (valore ?? "").match(/\[([^\]]+)\]/)?.[1]?.trim();
  const t = dentro ? Date.parse(dentro) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/** Le riunioni del periodo, arricchite con l'advisor effettivo e il contatto. */
async function riunioniArricchite(token: string, da: Date, a: Date): Promise<Riunione[]> {
  const [inFinestra, spostate] = await Promise.all([
    leggiRiunioni(token, da, a),
    riunioniSpostateDa(token, da, a).catch((e) => {
      console.warn("[trascrizioni] riunioni spostate non leggibili:", e instanceof Error ? e.message : e);
      return [] as Oggetto[];
    })
  ]);
  // Le spostate non possono essere gia' nell'elenco - la ricerca le prende
  // proprio perche' oggi stanno fuori dal periodo - ma il controllo costa
  // niente e protegge da una finestra che si sovrappone.
  const gia = new Set(inFinestra.map((r) => r.id));
  const grezze = [...inFinestra, ...spostate.filter((r) => !gia.has(r.id))];
  if (spostate.length) {
    console.log(`[trascrizioni] ${spostate.length} riunioni recuperate dopo uno spostamento`);
  }
  const contattiDi = await associazioni(token, "meetings", "contacts", grezze.map((r) => r.id));
  const idContatti = [...new Set([...contattiDi.values()].flat())];
  const [anagrafica, trattativeDi] = await Promise.all([
    leggiOggetti(token, "contacts", idContatti, ["firstname", "lastname"]),
    associazioni(token, "contacts", "deals", idContatti)
  ]);
  const idTrattative = [...new Set([...trattativeDi.values()].flat())];
  const trattative = await leggiOggetti(token, "deals", idTrattative, ["hubspot_owner_id", "createdate"]);

  const out: Riunione[] = [];
  for (const g of grezze) {
    const stanza = stanzaDa(g.properties);
    const inizio = Date.parse(g.properties.hs_meeting_start_time ?? "");
    if (!stanza || !Number.isFinite(inizio)) continue;
    const fine = Date.parse(g.properties.hs_meeting_end_time ?? "");
    const creata = Date.parse(g.properties.hs_createdate ?? "");
    const prenotato = String(g.properties.hubspot_owner_id ?? "").trim();
    const contatto = (contattiDi.get(g.id) ?? [])[0];

    // La trattativa giusta e' quella nata insieme a questa riunione: si aggancia
    // per data di CREAZIONE e non di chiusura, perche' una trattativa vinta
    // viene rinominata e le si sposta la chiusura, mentre l'istante in cui il
    // flusso l'ha creata non cambia mai. Copertura misurata: 85% contro 66%.
    let effettivo = prenotato;
    if (contatto && Number.isFinite(creata)) {
      let migliore: { scarto: number; owner: string } | null = null;
      for (const idT of trattativeDi.get(contatto) ?? []) {
        const t = trattative.get(idT);
        const nata = Date.parse(t?.createdate ?? "");
        if (!t || !Number.isFinite(nata)) continue;
        const scarto = Math.abs(nata - creata);
        if (scarto <= FINESTRA_TRATTATIVA && (!migliore || scarto < migliore.scarto)) {
          migliore = { scarto, owner: String(t.hubspot_owner_id ?? "").trim() };
        }
      }
      if (migliore?.owner) effettivo = migliore.owner;
    }

    const p = contatto ? anagrafica.get(contatto) : undefined;
    out.push({
      id: g.id,
      stanza,
      inizio,
      fine: Number.isFinite(fine) && fine > inizio ? fine : inizio + 30 * MIN,
      advisorPrenotato: prenotato,
      advisorEffettivo: effettivo,
      contattoId: contatto,
      contattoNome: p ? `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim() : undefined
    });
  }
  return out;
}

/** Quali consulenze si sono davvero svolte, con gli alias risolti. */
async function segnaSvolte(riunioni: Riunione[], da: Date, a: Date): Promise<void> {
  const db = getDb();
  const [svolte, alias] = await Promise.all([
    db.query<{ id: string }>(
      `SELECT DISTINCT COALESCE(x.nuovo_id, t.contact_id)::text AS id
         FROM trattativa t
         LEFT JOIN alias_contatto x ON x.vecchio_id = t.contact_id
        WHERE t.contact_id IS NOT NULL
          AND t.svolta_ts >= $1::timestamptz AND t.svolta_ts < $2::timestamptz`,
      [da.toISOString(), a.toISOString()]
    ),
    db.query<{ vecchio: string; nuovo: string }>(
      "SELECT vecchio_id::text AS vecchio, nuovo_id::text AS nuovo FROM alias_contatto"
    )
  ]);
  const canonico = new Map(alias.rows.map((r) => [r.vecchio, r.nuovo]));
  const risolvi = (id: string) => {
    let v = id;
    for (let i = 0; i < 5 && canonico.has(v); i++) v = canonico.get(v)!;
    return v;
  };
  const insieme = new Set(svolte.rows.map((r) => r.id));
  for (const m of riunioni) if (m.contattoId) m.svolta = insieme.has(risolvi(m.contattoId));
}

/**
 * Il giro completo: legge, abbina e - se richiesto - scrive.
 *
 * PERCHE' PIU' GIORNI E NON SOLO IERI: una registrazione puo' arrivare in
 * ritardo, perche' il caricamento dal browser dell'advisor resta in coda e
 * riparte anche molte ore dopo. Rileggere qualche giorno all'indietro li
 * recupera; riscrivere non fa danno perche' il confronto e' sulle consulenze.
 */
export async function sincronizzaTrascrizioni(opzioni: {
  token: string;
  chiaveFireflies: string;
  da: Date;
  a: Date;
  scrivi: boolean;
  /** Quanti contatti aggiornare al massimo: serve per le prove. */
  max?: number;
}): Promise<{ esito: EsitoSync; abbinamenti: Abbinamento[] }> {
  const { token, chiaveFireflies, da, a, scrivi } = opzioni;

  const [riunioni, trascrizioni] = await Promise.all([
    riunioniArricchite(token, da, a),
    leggiTrascrizioni(chiaveFireflies, da, a)
  ]);
  await segnaSvolte(riunioni, da, a).catch((e) => {
    // Senza il dato delle consulenze svolte il criterio "piu-slot" diventa piu'
    // prudente, non sbagliato: meglio proseguire che fermare tutto il giro.
    console.error("[trascrizioni] consulenze svolte non leggibili:", e instanceof Error ? e.message : e);
  });

  const registrazioni: Registrazione[] = trascrizioni
    .filter((t) => t.stanza)
    .map((t) => ({ id: t.id, stanza: t.stanza!, inizio: t.inizio, durataMin: t.durataMin }));

  // Le frasi servono solo dove una registrazione copre piu' appuntamenti, i
  // nomi solo dove l'abbinamento non e' riuscito: si chiedono a chi serve.
  const primo = abbina(registrazioni, riunioni);
  for (const r of primo.registrazioniSenzaRiunione) {
    if (r.durataMin < 10) continue;
    try {
      r.nomi = await leggiNomiCitati(chiaveFireflies, r.id);
    } catch {
      r.nomi = [];
    }
    await attesa(250);
  }
  for (const x of primo.abbinamenti) {
    const copre = riunioni.filter(
      (m) =>
        m.stanza === x.registrazione.stanza &&
        Math.min(x.registrazione.inizio + x.registrazione.durataMin * MIN, m.fine) -
          Math.max(x.registrazione.inizio, m.inizio) >=
          10 * MIN
    );
    // SI CONTANO GLI APPUNTAMENTI, NON GLI ORARI DISTINTI. Prima si contavano
    // gli orari, e due clienti prenotati sulla STESSA ora davano uno solo:
    // proprio il caso in cui la registrazione finisce su entrambe le schede e
    // una delle due riceve la consulenza di un estraneo. Le frasi servono
    // anche li', perche' e' da chi parla che si capisce di chi sia la call.
    if (copre.length < 2) continue;
    const r = registrazioni.find((y) => y.id === x.registrazione.id);
    if (!r || r.frasi) continue;
    try {
      r.frasi = await leggiFrasi(chiaveFireflies, r.id);
    } catch {
      r.frasi = [];
    }
    await attesa(280);
  }

  const { abbinamenti, registrazioniSenzaRiunione } = abbina(registrazioni, riunioni);

  const perCriterio: Record<string, number> = {};
  for (const x of abbinamenti) perCriterio[x.criterio] = (perCriterio[x.criterio] ?? 0) + 1;

  // CHI C'ERA IN CALL, solo quando si sta scrivendo davvero: una prova a vuoto
  // deve restare senza effetti, e questo lascia righe nel nostro database.
  let presenze = { nuove: 0, gia: 0, falliti: 0 };
  if (scrivi) {
    presenze = await registraPresenze(chiaveFireflies, abbinamenti, registrazioni).catch((e) => {
      // Non e' il mestiere principale di questo giro: se fallisce, i
      // collegamenti su HubSpot si scrivono lo stesso.
      console.error("[trascrizioni] presenze non registrate:", e instanceof Error ? e.message : e);
      return { nuove: 0, gia: 0, falliti: 0 };
    });
  }

  let scritti = 0;
  let invariati = 0;
  let falliti = 0;

  if (scrivi) {
    const daFare = abbinamenti.slice(0, opzioni.max ?? abbinamenti.length);
    const audioDi = new Map(trascrizioni.map((t) => [t.id, t.audio]));
    const attuali = await leggiOggetti(
      token,
      "contacts",
      [...new Set(daFare.map((x) => x.riunione.contattoId).filter(Boolean))] as string[],
      ["link_trascrizione_fireflies", "link_audio_fireflies"]
    );

    for (const x of daFare) {
      const contatto = x.riunione.contattoId;
      if (!contatto) continue;
      const quando = isoRoma(x.riunione.inizio);
      const attuale = attuali.get(contatto) ?? {};

      // SI CONFRONTANO LE CONSULENZE, NON LE STRINGHE. Su HubSpot un'applicazione
      // crea un record nell'oggetto Appuntamento a ogni aggiornamento del
      // collegamento: riscrivere lo stesso appuntamento con un indirizzo di
      // formato diverso - come quello che scriveva Zapier - creerebbe un
      // doppione a ogni giro notturno, da cancellare a mano.
      const gia = appuntamentoDi(attuale.link_trascrizione_fireflies);
      if (Number.isFinite(gia) && Math.abs(gia - x.riunione.inizio) < TOLLERANZA_STESSA_CONSULENZA) {
        invariati++;
        continue;
      }

      const proprieta: Record<string, string> = {
        link_trascrizione_fireflies: `${indirizzoTrascrizione(x.registrazione.id)} [${quando}]`
      };
      const audio = audioDi.get(x.registrazione.id);
      if (audio) proprieta.link_audio_fireflies = `${audio} [${quando}]`;

      const daScrivere = Object.fromEntries(
        Object.entries(proprieta).filter(([campo, valore]) => (attuale[campo] ?? "") !== valore)
      );
      if (!Object.keys(daScrivere).length) {
        invariati++;
        continue;
      }
      try {
        await aggiornaContatto(token, contatto, daScrivere);
        scritti++;
      } catch (e) {
        falliti++;
        console.error("[trascrizioni] scrittura fallita:", e instanceof Error ? e.message : e);
      }
      await attesa(120);
    }
  }

  return {
    esito: {
      periodo: { da: da.toISOString(), a: a.toISOString() },
      riunioni: riunioni.length,
      registrazioni: registrazioni.length,
      abbinate: abbinamenti.length,
      perCriterio,
      scritti,
      invariati,
      falliti,
      orfane: registrazioniSenzaRiunione.filter((r) => r.durataMin > 15).length,
      presenze
    },
    abbinamenti
  };
}
