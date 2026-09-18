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
import { PIPELINE_APPUNTAMENTI } from "@/lib/trattative/sync";
import {
  abbina,
  giornoRoma,
  stessoNome,
  type Abbinamento,
  type Registrazione,
  type Riunione
} from "@/lib/abbinamento";
import { leggiFrasi, leggiNomiCitati, leggiTrascrizioni, leggiVoci, linkTrascrizione } from "@/lib/fireflies";
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
/** Il formato che l'applicazione dell'analisi sa scaricare: il nostro .docx. */
function eScaricabile(valore: string | undefined | null): boolean {
  return /\/api\/trascrizione\/[0-9A-Z]+\.docx/i.test(String(valore ?? ""));
}

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

/** La voce dell'account condiviso con cui il Notetaker entra in call: non e'
 *  un cliente, e va tolta prima di cercare nomi. */
const VOCE_DEL_BOT = "advisor leone group";

/** Una consulenza vera dura almeno questo. Sotto, e' il bot che entra in una
 *  stanza vuota e se ne va: nel campione sono registrazioni da uno a tre
 *  minuti, e cercargli un cliente non ha senso. */
const DURATA_MINIMA_ORFANA = 10;

/** Quanto lontano puo' stare l'appuntamento dalla call che lo ha onorato. Tre
 *  settimane: un advisor che rimanda rimanda di giorni, non di mesi. */
const DISTANZA_MASSIMA_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Le registrazioni rimaste senza appuntamento, agganciate PER NOME.
 *
 * PERCHE' SERVE. L'abbinamento normale accosta una registrazione a un
 * appuntamento confrontando stanza e orario. Ma capita che la call si tenga in
 * un giorno diverso da quello fissato senza che nessuno sposti l'appuntamento:
 * l'advisor rimanda, si risentono tre giorni dopo nella stessa stanza, e in
 * calendario resta la data vecchia. Dagli orari quella registrazione non
 * appartiene a niente e si perde - niente trascrizione sul contatto, niente
 * analisi della call, e la consulenza non risulta da nessuna parte.
 *
 * Misurato su settembre: 175 registrazioni, 63 senza appuntamento, di cui 29
 * lunghe piu' di dieci minuti. Consulenze vere, una anche di 110 minuti.
 *
 * COME SI RICONOSCE IL CLIENTE. Dalla registrazione stessa: Fireflies scrive
 * chi parla, e quel nome si cerca fra i contatti. Quando la ricerca restituisce
 * una persona sola e il nome combacia davvero, l'appuntamento e' il suo - a
 * patto che sia nella stessa stanza e non troppo lontano nel tempo.
 *
 * NON SI INDOVINA MAI. Se il nome in call e' troncato - Meet mostra quello che
 * la persona ha scritto, e "marcel ma" restituisce cinque contatti diversi - la
 * registrazione resta orfana. Meglio perderne una che mettere la consulenza di
 * un estraneo sulla scheda di qualcun altro.
 */
/**
 * LE CONSULENZE FUORI CRM, salvate perche' le legga chi ne ha bisogno.
 *
 * COSA SONO. Registrazioni lunghe, in una stanza che sappiamo di chi e', con un
 * cliente che parla - e nessun appuntamento a cui agganciarsi, ne' per orario
 * ne' per nome. L'advisor ha tenuto la call e ha registrato la vendita creando
 * la trattativa gia' vinta, senza che l'appuntamento esistesse: senza questa
 * tabella quell'ora di lavoro non comparirebbe da nessuna parte.
 *
 * PERCHE' SI SCRIVONO QUI. L'agenda le ricavava da sola interrogando Fireflies
 * a ogni apertura, ma la tabella Advisor copre settimane e rifare quel calcolo
 * su un mese vorrebbe dire decine di chiamate a ogni caricamento. Scritte una
 * volta sola, i due numeri non possono piu' divergere.
 *
 * E SI CANCELLANO DA SOLE. Se qualcuno crea la riunione mancante - capita, a
 * ore di distanza - al giro dopo quella registrazione risulta abbinata e la
 * riga sparisce: da li' in poi la consulenza la racconta la card vera, e
 * contarla due volte sarebbe peggio che non contarla affatto.
 */
/**
 * IL CLIENTE E LA SUA TRATTATIVA, per una consulenza che sul CRM non esiste.
 *
 * Il nome arriva dalla voce che Fireflies ha etichettato, e si cerca fra i
 * contatti: se ne risponde uno solo, e il nome combacia davvero, e' lui. Due
 * omonimi e si lascia perdere - attribuire una consulenza alla persona
 * sbagliata non si vede e non si corregge.
 *
 * LA TRATTATIVA SI SCEGLIE CON LA DATA DI CHIUSURA. Un cliente puo' avere piu'
 * pratiche aperte, e senza appuntamento niente dice a quale appartiene la call.
 * Su una trattativa ripianificata pero' un'automazione scrive in "Data di
 * chiusura" IL GIORNO della consulenza nuova: se coincide con il giorno della
 * registrazione, e' quella. Il giorno da solo non basterebbe a mettere una card
 * in agenda - manca l'ora - ma qui l'ora la da' la registrazione, e il giorno
 * serve solo a scegliere fra due pratiche.
 */
async function clienteEPratica(
  token: string,
  nome: string,
  quando: number
): Promise<{ contatto: number | null; deal: number | null }> {
  const parti = nome.trim().split(/\s+/).filter((x) => x.length > 1);
  if (parti.length < 2) return { contatto: null, deal: null };

  // DUE RICERCHE, E IN QUEST'ORDINE.
  //
  // Prima il filtro preciso su nome e cognome: e' quello che distingue una
  // persona dai suoi omonimi. Su "Chiara Gilardi" il portale ne ha tre - due
  // con nome e cognome scritti tutti dentro il campo del nome - e la ricerca
  // larga le restituiva tutte e tre, lasciando la consulenza senza cliente
  // perche' fra tre non si sceglie.
  //
  // La ricerca larga resta come seconda, perche' trova chi ha il nome scritto
  // in modo un po' diverso da come Fireflies l'ha sentito. Anche li' vale la
  // stessa regola: se risponde piu' di una persona si lascia perdere.
  const cerca = async (corpo: unknown): Promise<Oggetto[]> =>
    (await hubspot<Pagina<Oggetto>>(token, "/crm/v3/objects/contacts/search", corpo).catch(() => null))
      ?.results ?? [];

  const combacia = (lista: Oggetto[]): Oggetto[] => {
    const perId = new Map<string, Oggetto>();
    for (const x of lista) {
      const suo = `${x.properties?.firstname ?? ""} ${x.properties?.lastname ?? ""}`.trim();
      if (stessoNome(nome, suo)) perId.set(String(x.id), x);
    }
    return [...perId.values()];
  };

  const preciso = combacia(
    await cerca({
      filterGroups: [
        {
          filters: [
            { propertyName: "firstname", operator: "CONTAINS_TOKEN", value: parti[0] },
            { propertyName: "lastname", operator: "CONTAINS_TOKEN", value: parti[parti.length - 1] }
          ]
        }
      ],
      properties: ["firstname", "lastname"],
      limit: 5
    })
  );

  const candidati =
    preciso.length === 1
      ? preciso
      : combacia(await cerca({ query: nome, properties: ["firstname", "lastname"], limit: 5 }));
  if (candidati.length !== 1) return { contatto: null, deal: null };
  const contatto = Number(candidati[0].id);
  if (!Number.isFinite(contatto)) return { contatto: null, deal: null };

  const giorno = giornoRoma(quando);
  const ass = await hubspot<{ results?: Array<{ toObjectId: number }> }>(
    token,
    `/crm/v4/objects/contacts/${contatto}/associations/deals`
  ).catch(() => null);
  const idDeal = (ass?.results ?? []).map((x) => String(x.toObjectId));
  if (!idDeal.length) return { contatto, deal: null };

  const lette = await hubspot<{ results?: Oggetto[] }>(token, "/crm/v3/objects/deals/batch/read", {
    properties: ["closedate", "pipeline"],
    inputs: idDeal.slice(0, 100).map((id) => ({ id }))
  }).catch(() => null);

  for (const d of lette?.results ?? []) {
    if (d.properties.pipeline !== PIPELINE_APPUNTAMENTI) continue;
    const chiusura = Date.parse(d.properties.closedate ?? "");
    if (!Number.isFinite(chiusura)) continue;
    if (giornoRoma(chiusura) === giorno) return { contatto, deal: Number(d.id) };
  }
  return { contatto, deal: null };
}

async function salvaFuoriCrm(opzioni: {
  token: string;
  chiaveFireflies: string;
  orfane: Registrazione[];
  abbinate: string[];
  riunioni: Riunione[];
  da: Date;
  a: Date;
}): Promise<void> {
  const { token, chiaveFireflies, orfane, abbinate, riunioni, da, a } = opzioni;
  const db = getDb();

  // CHI LAVORA IN QUALE STANZA, A MAGGIORANZA e non alla prima riunione che
  // capita. Una stanza e' di chi ci riceve tutti i giorni, ma su dieci giorni
  // ci passa anche qualche appuntamento di un collega: prendendo la prima
  // riunione trovata, una consulenza finiva sotto il nome sbagliato - visto
  // subito, la call del 17 settembre attribuita a un advisor che non era il suo.
  //
  // Si contano gli advisor A CUI LA RIUNIONE E' INTESTATA, non quelli che poi
  // l'hanno gestita: la stanza segue il calendario di chi la possiede, mentre il
  // passaggio a un collega e' proprio il caso che sposta le eccezioni.
  const conteggio = new Map<string, Map<string, number>>();
  for (const m of riunioni) {
    const chi = m.advisorPrenotato || m.advisorEffettivo;
    if (!m.stanza || !chi) continue;
    if (!conteggio.has(m.stanza)) conteggio.set(m.stanza, new Map());
    const per = conteggio.get(m.stanza)!;
    per.set(chi, (per.get(chi) ?? 0) + 1);
  }
  const padroneDi = new Map<string, string>();
  for (const [stanza, per] of conteggio) {
    const vincitore = [...per].sort((x, y) => y[1] - x[1])[0];
    if (vincitore) padroneDi.set(stanza, vincitore[0]);
  }

  const righe: Array<{
    id: string;
    advisor: number;
    stanza: string;
    inizio: Date;
    durata: number;
    cliente: string;
    contatto: number | null;
    deal: number | null;
  }> = [];

  for (const r of orfane) {
    if (r.durataMin < DURATA_MINIMA_ORFANA) continue;
    const advisor = Number(padroneDi.get(r.stanza) ?? "");
    if (!Number.isFinite(advisor) || advisor <= 0) continue;

    // Le voci: per le orfane il recupero per nome ha gia' chiesto le frasi, e
    // quelle bastano. Si chiede a Fireflies solo se mancano.
    let voci = [
      ...new Set((r.frasi ?? []).map((f) => (f.voce ?? "").trim()).filter(Boolean))
    ];
    if (!voci.length) {
      voci = await leggiVoci(chiaveFireflies, r.id).catch(() => [] as string[]);
      await attesa(250);
    }
    const cliente = voci.find(
      (v) => v.toLowerCase() !== VOCE_DEL_BOT && !/^speaker \d+$/i.test(v)
    );
    if (!cliente) continue;

    const { contatto, deal } = await clienteEPratica(token, cliente, r.inizio);
    righe.push({
      id: r.id,
      advisor,
      stanza: r.stanza,
      inizio: new Date(r.inizio),
      durata: Math.round(r.durataMin),
      cliente,
      contatto,
      deal
    });
  }

  // Prima si tolgono quelle del periodo che ora hanno un appuntamento, poi si
  // riscrivono le attuali: cosi' il giro e' ripetibile e non lascia residui.
  if (abbinate.length) {
    await db.query(`DELETE FROM consulenza_fuori_crm WHERE trascrizione = ANY($1::text[])`, [abbinate]);
  }
  if (righe.length) {
    await db.query(
      `INSERT INTO consulenza_fuori_crm
         (trascrizione, advisor_id, stanza, inizio_ts, durata_min, cliente, contatto_id, deal_id)
       SELECT * FROM UNNEST($1::text[], $2::bigint[], $3::text[], $4::timestamptz[], $5::int[], $6::text[], $7::bigint[], $8::bigint[])
       ON CONFLICT (trascrizione) DO UPDATE
         SET advisor_id = EXCLUDED.advisor_id,
             stanza     = EXCLUDED.stanza,
             inizio_ts  = EXCLUDED.inizio_ts,
             durata_min = EXCLUDED.durata_min,
             cliente    = EXCLUDED.cliente,
             -- Il contatto e la pratica si tengono se gia' noti: una ricerca
             -- che non risponde non deve cancellare un aggancio riuscito.
             contatto_id = COALESCE(EXCLUDED.contatto_id, consulenza_fuori_crm.contatto_id),
             deal_id     = COALESCE(EXCLUDED.deal_id, consulenza_fuori_crm.deal_id),
             aggiornato_at = now()`,
      [
        righe.map((x) => x.id),
        righe.map((x) => x.advisor),
        righe.map((x) => x.stanza),
        righe.map((x) => x.inizio),
        righe.map((x) => x.durata),
        righe.map((x) => x.cliente),
        righe.map((x) => x.contatto),
        righe.map((x) => x.deal)
      ]
    );
  }
  console.log(
    `[trascrizioni] consulenze fuori CRM nel periodo ${da.toISOString().slice(0, 10)} - ` +
      `${a.toISOString().slice(0, 10)}: ${righe.length}`
  );
}

async function recuperaPerNome(opzioni: {
  token: string;
  chiaveFireflies: string;
  orfane: Registrazione[];
  riunioniGiaUsate: Set<string>;
}): Promise<Abbinamento[]> {
  const { token, chiaveFireflies, orfane, riunioniGiaUsate } = opzioni;
  const out: Abbinamento[] = [];

  const candidate = orfane.filter((r) => r.durataMin >= DURATA_MINIMA_ORFANA);
  if (!candidate.length) return out;

  for (const reg of candidate) {
    if (!reg.frasi) {
      try {
        reg.frasi = await leggiFrasi(chiaveFireflies, reg.id);
      } catch {
        reg.frasi = [];
      }
      await attesa(280);
    }

    const voci = [
      ...new Set(
        (reg.frasi ?? [])
          .map((f) => (f.voce ?? "").trim())
          .filter((v) => v && v.toLowerCase() !== VOCE_DEL_BOT && !/^speaker \d+$/i.test(v))
      )
    ];
    if (!voci.length) continue;

    // Un solo contatto su tutte le voci, o si lascia perdere.
    const trovati = new Map<string, string>();
    for (const voce of voci) {
      try {
        const d = await hubspot<Pagina<Oggetto>>(token, "/crm/v3/objects/contacts/search", {
          query: voce,
          properties: ["firstname", "lastname"],
          limit: 5
        });
        for (const c of d.results ?? []) {
          const nome = `${c.properties?.firstname ?? ""} ${c.properties?.lastname ?? ""}`.trim();
          if (nome && stessoNome(voce, nome)) trovati.set(String(c.id), nome);
        }
      } catch {
        // una ricerca che non risponde non deve fermare il giro
      }
      await attesa(220);
    }
    if (trovati.size !== 1) continue;

    const [contattoId, nomeContatto] = [...trovati][0];

    let riunioni: string[] = [];
    try {
      const d = await hubspot<{ results?: Array<{ toObjectId: number }> }>(
        token,
        `/crm/v4/objects/contacts/${contattoId}/associations/meetings`
      );
      riunioni = (d.results ?? []).map((x) => String(x.toObjectId));
    } catch {
      continue;
    }
    if (!riunioni.length) continue;

    // L'appuntamento di quel contatto: stessa stanza, non gia' assegnato a
    // un'altra registrazione, il piu' vicino nel tempo.
    let migliore: Riunione | null = null;
    try {
      const d = await hubspot<{ results?: Oggetto[] }>(token, "/crm/v3/objects/meetings/batch/read", {
        properties: [
          "hs_meeting_location",
          "hs_video_conference_url",
          "hs_meeting_start_time",
          "hs_meeting_end_time",
          "hubspot_owner_id"
        ],
        inputs: riunioni.map((id) => ({ id }))
      });
      for (const m of d.results ?? []) {
        if (riunioniGiaUsate.has(String(m.id))) continue;
        const stanza = stanzaDa(m.properties);
        if (stanza !== reg.stanza) continue;
        const inizio = Date.parse(m.properties.hs_meeting_start_time ?? "");
        if (!Number.isFinite(inizio)) continue;
        if (Math.abs(inizio - reg.inizio) > DISTANZA_MASSIMA_MS) continue;
        const fine = Date.parse(m.properties.hs_meeting_end_time ?? "");
        const advisor = String(m.properties.hubspot_owner_id ?? "").trim();
        if (!migliore || Math.abs(inizio - reg.inizio) < Math.abs(migliore.inizio - reg.inizio)) {
          migliore = {
            id: String(m.id),
            stanza,
            inizio,
            fine: Number.isFinite(fine) && fine > inizio ? fine : inizio + 30 * MIN,
            advisorPrenotato: advisor,
            advisorEffettivo: advisor,
            contattoId,
            contattoNome: nomeContatto
          };
        }
      }
    } catch {
      continue;
    }
    if (!migliore) continue;

    riunioniGiaUsate.add(migliore.id);
    out.push({
      registrazione: reg,
      riunione: migliore,
      criterio: "nome",
      scartoMin: Math.round((reg.inizio - migliore.inizio) / MIN),
      // Nessuna sovrapposizione: e' proprio il motivo per cui questa
      // registrazione era rimasta orfana.
      sovrapposizioneMin: 0,
      daSec: 0,
      aSec: reg.durataMin * 60
    });
    await attesa(160);
  }

  return out;
}

  const { abbinamenti, registrazioniSenzaRiunione } = abbina(registrazioni, riunioni);

  // CHI ESCE DALLA STANZA DEVE SAPERE CON CHI HA PARLATO.
  //
  // Il criterio "overbooking" e' l'unico che accosta una registrazione a una
  // riunione di un'ALTRA stanza: lo fa quando l'appuntamento e' stato passato a
  // un altro advisor, che lo tiene nella propria. Li' non c'e' nessuna
  // sovrapposizione di orari a fare da controllo - le due stanze non si
  // confrontano - e basta che nella finestra ci sia una sola riunione passata a
  // quell'advisor perche' venga presa.
  //
  // COSA E' SUCCESSO IL 17 SETTEMBRE. Un advisor ha tenuto alle 10:00 nella sua
  // stanza una consulenza che sul CRM non esisteva. Nella stessa finestra aveva
  // ricevuto l'appuntamento di un'altra cliente, e la registrazione le e'
  // finita addosso: trascrizione e audio della call di una persona scritti
  // sulla scheda di un'altra, senza che niente lo segnalasse.
  //
  // Ora si guarda chi parla. Se la registrazione porta un nome di cliente e
  // quel nome non e' quello della riunione, l'abbinamento si toglie e la
  // registrazione torna orfana - dove il recupero per nome, che la stanza la
  // controlla, potra' occuparsene. Se invece nessuna voce ha un nome (capita:
  // Fireflies scrive "Speaker 2") si lascia com'era, perche' sull'assenza non
  // si conclude niente.
  const daControllare = abbinamenti.filter((x) => x.criterio === "overbooking" && x.riunione.contattoNome);
  for (const x of daControllare) {
    const voci = await leggiVoci(chiaveFireflies, x.registrazione.id).catch(() => [] as string[]);
    const clienti = voci.filter(
      (v) => v.toLowerCase() !== VOCE_DEL_BOT && !/^speaker \d+$/i.test(v)
    );
    await attesa(250);
    if (!clienti.length) continue;
    if (clienti.some((v) => stessoNome(v, x.riunione.contattoNome!))) continue;

    const i = abbinamenti.indexOf(x);
    if (i >= 0) abbinamenti.splice(i, 1);
    registrazioniSenzaRiunione.push(x.registrazione);
    console.log(
      `[trascrizioni] overbooking scartato: in call ${clienti.join(", ")}, ` +
        `sulla riunione ${x.riunione.contattoNome}`
    );
  }

  // SECONDO PASSAGGIO, sulle sole rimaste orfane: si cerca il cliente per nome
  // dentro la registrazione. Vedi recuperaPerNome().
  const perNome = await recuperaPerNome({
    token,
    chiaveFireflies,
    orfane: registrazioniSenzaRiunione,
    riunioniGiaUsate: new Set(abbinamenti.map((x) => x.riunione.id))
  }).catch((e) => {
    console.warn("[trascrizioni] recupero per nome non riuscito:", e instanceof Error ? e.message : e);
    return [] as Abbinamento[];
  });
  if (perNome.length) {
    console.log(`[trascrizioni] ${perNome.length} registrazioni orfane agganciate per nome`);
    abbinamenti.push(...perNome);
  }

  // LE CONSULENZE CHE RESTANO SENZA NESSUN APPUNTAMENTO si salvano in banca
  // dati: le leggono l'agenda e la tabella Advisor, che altrimenti conterebbero
  // cose diverse. Vedi salvaFuoriCrm().
  if (scrivi) {
    await salvaFuoriCrm({
      token,
      chiaveFireflies,
      orfane: registrazioniSenzaRiunione.filter(
        (r) => !abbinamenti.some((x) => x.registrazione.id === r.id)
      ),
      abbinate: abbinamenti.map((x) => x.registrazione.id),
      riunioni,
      da,
      a
    }).catch((e) => {
      console.error("[trascrizioni] consulenze fuori CRM non salvate:", e instanceof Error ? e.message : e);
    });
  }

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
      // L'ECCEZIONE: se quello salvato NON e' scaricabile si riscrive comunque.
      // Il confronto per consulenza serve a non creare doppioni oscillando fra
      // due formati ogni notte, ma un indirizzo che l'applicazione non sa
      // leggere non ha mai prodotto nessun record - quindi non c'e' niente da
      // duplicare, e lasciarlo li' vuol dire non avere l'analisi per sempre.
      // Una volta riscritto e' nel formato giusto e il confronto torna a
      // valere.
      const gia = appuntamentoDi(attuale.link_trascrizione_fireflies);
      if (
        Number.isFinite(gia) &&
        Math.abs(gia - x.riunione.inizio) < TOLLERANZA_STESSA_CONSULENZA &&
        eScaricabile(attuale.link_trascrizione_fireflies)
      ) {
        invariati++;
        continue;
      }

      // MEGLIO NON SCRIVERE CHE SCRIVERE UN INDIRIZZO CHE NESSUNO SA LEGGERE.
      // Senza FIREFLIES_WEBHOOK_SECRET si ripiega sulla pagina di Fireflies, e
      // l'applicazione dell'analisi da una pagina non ricava niente: il
      // collegamento sembra a posto, l'analisi non arriva mai, e il confronto
      // qui sopra - che guarda la consulenza e non la stringa - impedisce a
      // ogni giro successivo di correggerlo. E' successo il 16 settembre
      // lanciando il giro da un computer dove il segreto non c'e': ventiquattro
      // contatti con un indirizzo inservibile.
      const indirizzo = indirizzoTrascrizione(x.registrazione.id);
      if (!eScaricabile(indirizzo)) {
        console.warn(
          "[trascrizioni] FIREFLIES_WEBHOOK_SECRET non impostato: il collegamento non viene scritto " +
            "(sarebbe una pagina, e l'analisi non partirebbe)."
        );
        invariati++;
        continue;
      }

      const proprieta: Record<string, string> = {
        link_trascrizione_fireflies: `${indirizzo} [${quando}]`
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
