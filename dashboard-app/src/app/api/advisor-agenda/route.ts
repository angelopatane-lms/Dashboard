import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// L'agenda di una giornata: i meeting di HubSpot, per persona e per orario.
//
// PERCHE' HUBSPOT E NON GOOGLE CALENDAR. Gli appuntamenti che si vedono sui
// calendari degli advisor li crea HubSpot quando il contatto prenota: hanno
// titolo "Contatto and Advisor", orario, proprietario ed esito. Leggerli da qui
// costa una chiamata con il token che gia' abbiamo, invece di
// un'autorizzazione a livello di dominio Google per ogni calendario.
//
// COSA MANCA, ed e' bene saperlo: gli impegni che un advisor si segna da solo -
// pranzi, blocchi, formazione, ferie - non passano da HubSpot e qui non
// compaiono. Per quelli servirebbe l'interrogazione di sola disponibilita' di
// Google Calendar, che dice quando la persona e' occupata senza dire cosa sta
// facendo. Finche' non c'e', l'agenda mostra il lavoro, non la giornata intera.

/**
 * NESSUNA RISPOSTA MEMORIZZATA.
 *
 * Next.js conserva le risposte delle chiamate in uscita in .next/cache e le
 * riusa. Su dati di un CRM che cambia in continuazione questo significa
 * mostrare il passato senza dirlo: misurato il 16 settembre, il proprietario di
 * una trattativa cambiato alle 06:24 continuava a risultare quello vecchio
 * venticinque minuti dopo, in locale e in produzione, e la card dell'agenda
 * restava nella colonna della persona sbagliata. La stessa richiesta fatta da
 * uno script fuori da Next dava subito il valore nuovo, e svuotando la cache la
 * rotta si allineava all-istante.
 *
 * Non scade in modo prevedibile e non lascia traccia: l-unico segnale era
 * hs_lastmodifieddate fermo al giorno prima dentro la risposta. Meglio pagare
 * ogni volta la chiamata che servire un dato vecchio senza accorgersene.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Un giorno passato fa due giri su HubSpot invece di uno: il tetto di base
// non basta piu' quando la rete e' lenta.
export const maxDuration = 60;

const HUBSPOT_API = "https://api.hubapi.com";

/** Il tipo decide il colore, e lo decidono i dati: e' l'esito del meeting. */
export type TipoEvento = "appuntamento" | "svolta" | "annullato";

/**
 * L'analisi della call, quando c'e'.
 *
 * Arriva dall'oggetto Appuntamento di HubSpot, che un'integrazione riempie
 * leggendo la trascrizione. Non e' una cosa che si puo' dare per scontata: su
 * 4.123 consulenze svolte nel 2026 il record esiste per circa una su dieci, e
 * quando esiste compare in media tre ore e mezza DOPO la call. Sull'agenda di
 * oggi quindi sara' quasi sempre assente, e su quella di ieri no: e' il motivo
 * per cui la scheda si apre solo dove c'e' davvero qualcosa da leggere.
 */
export type AnalisiCall = {
  /** Il riassunto. E' un elenco perche' il campo ne contiene piu' d'uno. */
  riassunti: string[];
  /** Lo scarto fra quello che il contatto si aspettava e quello che offriamo. */
  mismatch: string[];
  obiezione: string;
  urgenza: string;
  problema: string;
  obiettivo: string;
  /**
   * Come e' andato l'advisor, secondo l'analisi della call.
   *
   * SOLO LA FAMIGLIA SU DIECI. Le proprieta' dei punteggi usano due scale
   * diverse - misurato su 600 record, alcune arrivano a 10 e altre si fermano a
   * 5 - e alcune misurano la stessa cosa su entrambe: gestione_obiezioni_score
   * sta su dieci, objection_handling su cinque. Mostrarle insieme farebbe
   * sembrare un 2,5 su 5 peggiore di un 5 su 10, che e' lo stesso valore.
   *
   * Assente quando l'analisi non porta punteggi: allora nella scheda non
   * compare il riquadro, invece di comparire vuoto.
   */
  advisor?: {
    /** Il voto complessivo, da 0 a 10. */
    voto: number;
    /** Le fasi della call, tutte sulla stessa scala. */
    fasi: Array<{ nome: string; punteggio: number }>;
    puntiDiForza: string;
    daMigliorare: string;
  };
};


export type EventoAgenda = {
  operatore: string;
  /** Il nome del contatto: dal titolo si toglie " and <advisor>", che ripete
   *  quello che c'e' gia' scritto in cima alla colonna. */
  titolo: string;
  /** Minuti dalla mezzanotte di Roma. */
  inizioMin: number;
  fineMin: number;
  /** "09:30", gia' pronto da scrivere. */
  inizio: string;
  fine: string;
  tipo: TipoEvento;
  /** Presente solo per gli appuntamenti di cui esiste l'analisi della call. */
  analisi?: AnalisiCall;
  /**
   * Quando la riunione e' stata spostata altrove DOPO che questa fascia era
   * gia' iniziata. Contiene la nuova data, da mostrare sulla card.
   *
   * La card resta anche nel giorno nuovo: e' la stessa riunione vista due
   * volte, una nel momento in cui la fascia e' stata occupata e una in quello
   * in cui si terra'. Toglierla da qui farebbe sparire dal passato del lavoro
   * che e' stato fatto.
   */
  ripianificata?: string;
  /** L'indirizzo della trascrizione su Fireflies, quando si riesce a ricavarlo. */
  trascrizione?: string;
  /** Il file audio della call, da ascoltare direttamente. */
  audio?: string;
  /**
   * L'advisor a cui l'appuntamento era stato prenotato, quando la consulenza
   * l'ha poi tenuta un altro. La card sta nella colonna di chi l'ha gestita -
   * altrimenti l'agenda mostrerebbe occupato chi era libero e libero chi stava
   * lavorando - e questo campo conserva da dove arriva.
   */
  prenotatoPer?: string;
  /** Creato a mano invece che da una pagina di prenotazione. */
  manuale?: boolean;
  /**
   * Chi era in call secondo la registrazione, quando lo sappiamo.
   *
   * Viaggia fino alla scheda perche' questo stato arriva da una deduzione e
   * non da un campo compilato da qualcuno: chi guarda una card verde deve
   * poter vedere su cosa si basa, altrimenti un colore nuovo e' solo un
   * colore di cui fidarsi al buio.
   */
  presenza?: "presentato" | "solo-advisor" | "non-si-sa";
  /**
   * Quanto e' durata la registrazione, in minuti.
   *
   * E' la durata della CALL, non quella dello slot prenotato: le due si
   * assomigliano solo quando tutto fila liscio. Uno slot da mezz'ora con una
   * call da sei minuti racconta qualcosa che l'orario da solo non dice.
   */
  durataMin?: number;
};

const due = (n: number) => String(n).padStart(2, "0");

/**
 * L'istante UTC che a Roma e' quel giorno a quell'ora.
 *
 * Serve perche' HubSpot filtra e risponde in UTC mentre l'agenda si legge in
 * ora italiana: d'estate sono due ore di differenza, e un meeting delle 09:00
 * chiesto in UTC comincerebbe alle 11:00 sullo schermo. Si parte dall'istante
 * come se Roma fosse UTC, si guarda che ora sarebbe davvero a Roma, e si
 * corregge di quella differenza.
 */
function istanteRoma(giorno: string, ore: number, minuti: number): number {
  const tentativo = Date.parse(`${giorno}T${due(ore)}:${due(minuti)}:00Z`);
  const aRoma = new Date(tentativo).toLocaleString("sv-SE", { timeZone: "Europe/Rome" });
  const scarto = Date.parse(`${aRoma.replace(" ", "T")}Z`) - tentativo;
  return tentativo - scarto;
}

/** Ora di Roma di un istante, come "09:30" e come minuti dalla mezzanotte. */
function oraRoma(iso: string): { testo: string; minuti: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const aRoma = new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Rome" });
  const ora = aRoma.split(" ")[1] ?? "";
  const [h, m] = ora.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { testo: `${due(h)}:${due(m)}`, minuti: h * 60 + m };
}

/**
 * IL "SVOLTO" NON PUO' VENIRE DALL'ESITO DEL MEETING.
 *
 * HubSpot ce l'ha, ma nessuno lo compila: misurato su 2.235 meeting fra luglio
 * e settembre 2026, 2.153 sono rimasti "SCHEDULED" per sempre e solo 17 - lo
 * 0,8% - risultano COMPLETED. Colorare di verde quei diciassette avrebbe fatto
 * comparire una tinta una volta ogni cento appuntamenti, con il significato di
 * "qualcuno ha spuntato una casella".
 *
 * La consulenza svolta, in questa dashboard, e' un'altra cosa e sta altrove:
 * e' la trattativa la cui prima transizione di fase soddisfa il workflow
 * "Performance Tracker - Trattative Svolte", precalcolata in trattativa.svolta_ts
 * dal sync. E' lo stesso numero della colonna Consulenze della tabella, quindi
 * le due parti della pagina non possono raccontare due giornate diverse.
 *
 * Il collegamento passa dal CONTATTO: il meeting dice con chi, la trattativa
 * dice se quella persona ha fatto la consulenza quel giorno.
 */
function tipoDa(esito: string | null | undefined): TipoEvento {
  const e = (esito ?? "").trim().toUpperCase();
  if (e === "COMPLETED") return "svolta";
  if (e === "CANCELED" || e === "NO_SHOW") return "annullato";
  return "appuntamento";
}

/**
 * L'appuntamento e' stato creato a mano invece che da una pagina di prenotazione.
 *
 * COME SI RICONOSCE: quando un contatto prenota da una pagina, HubSpot mette da
 * solo l'esito a "SCHEDULED". Se la riunione viene creata a mano nel CRM o
 * arriva dal calendario, quel campo resta vuoto perche' nessuno lo compila.
 *
 * PERCHE' MERITA UN SEGNO E NON UN COLORE. Fino a ieri l'agenda dipingeva queste
 * riunioni di giallo chiamandole "interne", perche' quasi sempre lo erano - la
 * riunione mattutina del team, i workshop. Ma non tutte: su quattordici giorni
 * di settembre, fra le diciannove senza esito ce n'era una con un contatto vero
 * e un orario da consulenza, che finiva in giallo e restava fuori dai conteggi.
 * Il modo in cui una riunione e' nata non dice se sia una consulenza: quello lo
 * dicono il contatto e lo stato, e restano affidati al colore.
 */
const creataAMano = (esito: string | null | undefined): boolean => !(esito ?? "").trim();

/** I contatti di ogni meeting, un'unica chiamata ogni duecento. */
async function contattiDeiMeeting(token: string, ids: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const res = await fetch(`${HUBSPOT_API}/crm/v4/associations/meetings/contacts/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: ids.slice(i, i + 200).map((id) => ({ id })) })
    });
    if (!res.ok) throw new Error(`associazioni ${res.status}`);
    const data = await res.json();
    for (const r of data.results ?? []) {
      const da = String(r.from?.id ?? "");
      const a = (r.to ?? []).map((t: { toObjectId?: string | number }) => Number(t.toObjectId)).filter(Number.isFinite);
      if (da) out.set(da, a);
    }
  }
  return out;
}

/**
 * L'INDIRIZZO DELLA TRASCRIZIONE, RICOSTRUITO.
 *
 * Su HubSpot il contatto porta il link di SCARICAMENTO del file, che e' firmato
 * e vale sei ore: `X-Amz-Expires=21600`. Provato su tre call - una di ieri, una
 * di giugno, una del 2025 - risponde sempre "403 Request has expired". Messo in
 * un'icona manderebbe le persone su una pagina di errore.
 *
 * Dentro quell'indirizzo pero' c'e' l'identificativo della trascrizione:
 *
 *   /01M25ZKTJM9G0AWB5HE43E8FYA/downloads/transcript/jth-hhtk-jmn-...docx
 *
 * Con quello si compone l'indirizzo dell'applicazione Fireflies, che non scade.
 * Verificato aprendone uno: mostra la call giusta.
 *
 * DUE FORME, NON UNA. Sul contatto si trovano oggi due tipi di valore:
 * quello dello Zap, dove l'identificativo e' il PRIMO pezzo del percorso, e
 * quello che scriviamo noi dal webhook, che e' gia' l'indirizzo
 * dell'applicazione e ha l'identificativo per ULTIMO:
 *
 *   https://app.fireflies.ai/view/01M2FPVQNBMF8D6BJZ24DKEB6Q [2026-09-14T...]
 *
 * Cercare solo nel primo pezzo funzionava finche' scriveva lo Zap; da quando
 * scriviamo noi avrebbe reso invisibile in agenda ogni link nuovo, senza dare
 * errore. Si cerca quindi la forma dell'identificativo fra TUTTI i pezzi.
 */
function idTrascrizione(grezzo: string | null | undefined): string | undefined {
  // SI TAGLIA AL PRIMO SPAZIO. Il valore che scriviamo porta in coda la data
  // dell'appuntamento fra parentesi quadre - serve a riconoscere a quale
  // consulenza appartiene un collegamento gia' presente - e new URL() non si
  // ferma allo spazio: se lo tira dentro il percorso, e l'ultimo pezzo diventa
  // "01M2HXYZ...%20[2026-09-15T09:00:00+02:00]", che non passa il controllo di
  // forma. Sul formato dello Zap non si vedeva, perche' li' l'identificativo e'
  // il PRIMO pezzo e il suffisso restava lontano.
  const v = (grezzo ?? "").trim().split(/\s/)[0];
  if (!v.startsWith("http")) return undefined;
  try {
    // Un ULID: ventisei caratteri fra cifre e lettere maiuscole. Il controllo
    // serve a non costruire un indirizzo da un pezzo qualunque del percorso,
    // che porterebbe a una pagina "riunione non trovata".
    return new URL(v).pathname
      .split("/")
      .filter(Boolean)
      // L'estensione si toglie: da quando il collegamento punta al documento
      // che serviamo noi, l'ultimo pezzo e' "<identificativo>.docx".
      .map((p) => p.replace(/\.(docx|txt)$/i, ""))
      .find((p) => /^[0-9A-Z]{20,32}$/.test(p));
  } catch {
    return undefined;
  }
}

const linkTrascrizione = (id: string) => `https://app.fireflies.ai/view/${id}`;

/**
 * Il file audio delle registrazioni, chiesto fresco a Fireflies.
 *
 * NON si usa "Link Audio Fireflies" salvato sul contatto: provato su quattro
 * contatti, risponde 403 - e' su un host che non serve piu' quei file. Quello
 * che l'API restituisce adesso invece e' un indirizzo non firmato che risponde
 * 206 con tipo audio/mp3, quindi si puo' aprire direttamente.
 *
 * Se la chiave non c'e' o Fireflies non risponde si torna una mappa vuota: in
 * agenda spariscono le icone dell'altoparlante, non gli appuntamenti.
 */
async function audioDelleTrascrizioni(
  ids: string[]
): Promise<Map<string, { audio?: string; durataMin?: number }>> {
  const out = new Map<string, { audio?: string; durataMin?: number }>();
  const chiave = process.env.FIREFLIES_API_KEY;
  if (!chiave || !ids.length) return out;
  for (const id of ids) {
    try {
      const res = await fetch("https://api.fireflies.ai/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${chiave}`, "Content-Type": "application/json" },
        // La durata arriva dalla stessa interrogazione: e' un campo in piu'
        // nella risposta, non una chiamata in piu'.
        body: JSON.stringify({ query: `{ transcript(id: "${id}") { audio_url duration } }` })
      });
      if (!res.ok) continue;
      const dati = await res.json();
      const url = dati?.data?.transcript?.audio_url;
      const durata = Number(dati?.data?.transcript?.duration);
      out.set(id, {
        ...(typeof url === "string" && url.startsWith("http") ? { audio: url } : {}),
        ...(Number.isFinite(durata) && durata > 0 ? { durataMin: Math.round(durata) } : {})
      });
    } catch {
      // una registrazione senza audio non e' un motivo per far fallire l'agenda
    }
  }
  return out;
}

/** I campi dell'analisi che finiscono nella scheda. */
const CAMPI_ANALISI = [
  "hs_appointment_name",
  "summary_3lines",
  "commento_mismatch",
  "obiezione_principale",
  "urgency_level",
  "inferno_tema_principale",
  "paradiso_tema_principale",
  // Come e' andato l'advisor. Solo i punteggi sulla scala 0-10: vedi il campo
  // "advisor" di AnalisiCall per il motivo.
  "valutazione_closer_score",
  "discovery_score_closer",
  "rapport_score_closer",
  "gestione_obiezioni_score",
  "presentazione_soluzione_score",
  "chiarezza_cta_score",
  "punti_di_forza_closer",
  "aree_miglioramento_closer"
];

/** Un campo dell'analisi contiene piu' blocchi, uno per riga: qui diventano un elenco. */
const blocchi = (v: string | null | undefined): string[] =>
  (v ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

const ultimo = (v: string | null | undefined): string => {
  const b = blocchi(v);
  return b.length ? b[b.length - 1] : "";
};

/**
 * L'analisi della call dei contatti di giornata.
 *
 * SI PARTE DAI CONTATTI, non dalla data. Il record dell'appuntamento nasce ore
 * o giorni dopo la call, quindi cercarlo per data di creazione non lo
 * troverebbe; il suo nome comincia con la data della call ma e' testo libero, e
 * la ricerca di HubSpot lo spezza in pezzi che non si possono interrogare in
 * modo affidabile. L'associazione al contatto invece e' precisa e c'e' sempre:
 * misurata su tutti i 1.114 record, nessuno ne e' privo.
 *
 * Restituisce una mappa per numero di contatto, perche' e' da li' che l'evento
 * dell'agenda la ritrova.
 */
async function analisiDeiContatti(
  token: string,
  contatti: number[],
  giorno: string
): Promise<Map<number, AnalisiCall>> {
  const out = new Map<number, AnalisiCall>();
  if (!contatti.length) return out;

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 1. quali appuntamenti ha ogni contatto
  const appDiContatto = new Map<number, string[]>();
  for (let i = 0; i < contatti.length; i += 100) {
    const res = await fetch(`${HUBSPOT_API}/crm/v4/associations/contacts/appointments/batch/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ inputs: contatti.slice(i, i + 100).map((id) => ({ id: String(id) })) })
    });
    if (!res.ok) throw new Error(`associazioni appuntamenti ${res.status}`);
    const data = await res.json();
    for (const r of data.results ?? []) {
      const da = Number(r.from?.id);
      const a = (r.to ?? []).map((x: { toObjectId?: string | number }) => String(x.toObjectId)).filter(Boolean);
      if (Number.isFinite(da) && a.length) appDiContatto.set(da, a);
    }
  }

  const idApp = Array.from(new Set(Array.from(appDiContatto.values()).flat()));
  if (!idApp.length) return out;

  // 2. il contenuto di quegli appuntamenti
  const perId = new Map<string, Record<string, string | null>>();
  for (let i = 0; i < idApp.length; i += 100) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/appointments/batch/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ properties: CAMPI_ANALISI, inputs: idApp.slice(i, i + 100).map((id) => ({ id })) })
    });
    if (!res.ok) throw new Error(`appuntamenti ${res.status}`);
    const data = await res.json();
    for (const r of data.results ?? []) perId.set(String(r.id), r.properties ?? {});
  }

  // 3. si tiene solo l'appuntamento di QUESTA giornata: un contatto puo' averne
  //    fatti altri in passato, e mostrare l'analisi di un'altra call sarebbe
  //    peggio che non mostrarne nessuna.
  for (const [contatto, lista] of appDiContatto) {
    for (const id of lista) {
      const p = perId.get(id);
      if (!p) continue;
      if (!(p.hs_appointment_name ?? "").startsWith(`${giorno} `)) continue;
      const riassunti = blocchi(p.summary_3lines);
      const mismatch = blocchi(p.commento_mismatch);
      if (!riassunti.length && !mismatch.length) continue;
      const numero = (v: string | null | undefined): number | null => {
        const n = parseFloat(String(v ?? ""));
        return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
      };
      const voto = numero(p.valutazione_closer_score);
      const fasi = [
        { nome: "Discovery", punteggio: numero(p.discovery_score_closer) },
        { nome: "Rapport", punteggio: numero(p.rapport_score_closer) },
        { nome: "Gestione obiezioni", punteggio: numero(p.gestione_obiezioni_score) },
        { nome: "Presentazione", punteggio: numero(p.presentazione_soluzione_score) },
        { nome: "Chiarezza CTA", punteggio: numero(p.chiarezza_cta_score) }
      ].filter((f): f is { nome: string; punteggio: number } => f.punteggio !== null);

      out.set(contatto, {
        riassunti,
        mismatch,
        obiezione: ultimo(p.obiezione_principale),
        urgenza: ultimo(p.urgency_level),
        problema: ultimo(p.inferno_tema_principale),
        obiettivo: ultimo(p.paradiso_tema_principale),
        ...(voto !== null
          ? {
              advisor: {
                voto,
                fasi,
                puntiDiForza: (p.punti_di_forza_closer ?? "").trim(),
                daMigliorare: (p.aree_miglioramento_closer ?? "").trim()
              }
            }
          : {})
      });
      break;
    }
  }

  return out;
}

/**
 * Il link alla trascrizione dei contatti di giornata.
 *
 * E' una proprieta' sola sul contatto, quindi tiene l'ultima trascrizione e non
 * una per appuntamento. Nella pratica coincidono: misurati gli appuntamenti da
 * giugno, 137 contatti su 140 hanno una sola call. I tre con due call le hanno
 * fatte lo stesso giorno, e somigliano a un appuntamento spostato.
 */
/** Il motivo dell'ultimo fallimento nella lettura delle trascrizioni, esposto
 *  nei conti di controllo: senza, un errore resta invisibile da fuori. */
let ultimoErrore: string | null = null;
/** Quanti contatti sono tornati dalla lettura e quanti avevano il campo
 *  pieno: distingue "HubSpot non da' la proprieta'" da "la da' ma non si
 *  riesce a ricavarne l'identificativo". Senza questa distinzione le due
 *  cause sono indistinguibili da fuori, e si finisce a indovinare. */
let contattiLetti = 0;
let contattiConCampo = 0;

/**
 * Il portale e l-applicazione con cui stiamo parlando.
 *
 * SERVE PERCHE' LO STESSO CODICE, CON LO STESSO CONTATTO, DA' RISULTATI
 * DIVERSI: da qui la proprieta' del collegamento e' piena, dal server e'
 * vuota. Se le due parti stanno usando token di app diverse - una sola delle
 * quali vede quella proprieta' - questo lo rende evidente invece di lasciarlo
 * dedurre. Non espone nulla di riservato: solo il numero del portale.
 */
/**
 * Legge UN contatto indicato a mano e dice soltanto se il collegamento alla
 * trascrizione risulta pieno.
 *
 * Serve a separare due cause che da fuori si somigliano: il server non vede
 * quella proprieta', oppure la vede ma sta guardando contatti diversi da
 * quelli che ci aspettiamo. Restituisce un si o un no, mai il valore.
 */
async function sondaContatto(token: string, id: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=link_trascrizione_fireflies`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { id, stato: res.status };
    const d = await res.json();
    const v = String(d.properties?.link_trascrizione_fireflies ?? "").trim();

    // LA STESSA LETTURA, MA A BLOCCHI. E' l'unica differenza rimasta fra questa
    // sonda, che il campo lo vede, e la lettura di giornata, che lo trova vuoto
    // su tutti. Se qui il campo torna e li' no, la causa e' nella forma della
    // richiesta e non nei permessi.
    const b = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: ["link_trascrizione_fireflies"], inputs: [{ id }] })
    });
    const bj = b.ok ? await b.json() : null;
    const bv = String(bj?.results?.[0]?.properties?.link_trascrizione_fireflies ?? "").trim();

    return {
      id,
      stato: 200,
      campoPieno: Boolean(v),
      lunghezza: v.length,
      risolto: Boolean(idTrascrizione(v)),
      aBlocchi: { stato: b.status, risultati: bj?.results?.length ?? 0, campoPieno: Boolean(bv), lunghezza: bv.length }
    };
  } catch (e) {
    return { id, errore: e instanceof Error ? e.message.slice(0, 120) : "?" };
  }
}

async function portaleCollegato(token: string): Promise<string> {
  try {
    const res = await fetch(`${HUBSPOT_API}/account-info/v3/details`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return `non leggibile (${res.status})`;
    const d = await res.json();
    return String(d.portalId ?? d.hubId ?? "?");
  } catch {
    return "non leggibile";
  }
}

async function trascrizioniDeiContatti(token: string, contatti: number[]): Promise<Map<number, string>> {
  ultimoErrore = null;
  contattiLetti = 0;
  contattiConCampo = 0;
  // Il valore della mappa e' l'IDENTIFICATIVO della trascrizione: da quello si
  // ricavano sia l'indirizzo della pagina sia, con una chiamata, il file audio.
  const out = new Map<number, string>();
  if (!contatti.length) return out;

  for (let i = 0; i < contatti.length; i += 100) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: ["link_trascrizione_fireflies"],
        inputs: contatti.slice(i, i + 100).map((id) => ({ id: String(id) }))
      })
    });
    // UN BLOCCO CHE FALLISCE NON DEVE PORTARSI VIA LA GIORNATA. Prima questo
    // lanciava, e il chiamante lo raccoglieva restituendo una mappa vuota:
    // bastava un errore su una richiesta per lasciare senza trascrizione
    // tutte le card del giorno, e da fuori sembrava che il dato non ci
    // fosse. Si annota il motivo e si prosegue con gli altri blocchi.
    if (!res.ok) {
      ultimoErrore = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      console.error(`[advisor-agenda] trascrizioni, blocco ${i}: ${ultimoErrore}`);
      continue;
    }
    const data = await res.json();
    for (const r of data.results ?? []) {
      contattiLetti += 1;
      if ((r.properties?.link_trascrizione_fireflies ?? "").trim()) contattiConCampo += 1;
      const trascrizione = idTrascrizione(r.properties?.link_trascrizione_fireflies);
      const id = Number(r.id);
      if (trascrizione && Number.isFinite(id)) out.set(id, trascrizione);
    }
  }
  return out;
}

/**
 * Chi ha gestito davvero ciascuna riunione, quando non e' chi l'aveva prenotata.
 *
 * QUANDO UN APPUNTAMENTO PASSA A UN ALTRO ADVISOR - l'overbooking - il nuovo
 * proprietario viene scritto a mano sulla trattativa, mentre la riunione resta
 * intestata all'originale. La discordanza fra i due e' quindi la firma del
 * passaggio, ed e' l'unico modo per vederlo: in HubSpot non esiste un campo che
 * lo dica.
 *
 * Si guarda la TRATTATIVA e non il contatto perche' la trattativa nasce da
 * questo appuntamento e non cambia piu', mentre il proprietario del contatto si
 * muove anche per riassegnazioni commerciali successive - misurato, 8% di
 * discordanza contro 21%.
 *
 * E si aggancia per data di CREAZIONE: il flusso HubSpot crea la trattativa
 * circa sei minuti dopo la riunione, con una dispersione di venti secondi. La
 * data di chiusura invece si sposta quando la trattativa viene vinta.
 */
async function gestoriEffettivi(
  token: string,
  riunioni: Array<{ id: string; creata: number; proprietario: string }>,
  contatti: Map<string, number[]>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const idContatti = Array.from(new Set(Array.from(contatti.values()).flat().map(String)));
  if (!idContatti.length) return out;

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const trattativeDi = new Map<string, string[]>();
  for (let i = 0; i < idContatti.length; i += 100) {
    const res = await fetch(`${HUBSPOT_API}/crm/v4/associations/contacts/deals/batch/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ inputs: idContatti.slice(i, i + 100).map((id) => ({ id })) })
    });
    if (!res.ok) return out;
    const data = await res.json();
    for (const r of data.results ?? []) {
      const lista = (r.to ?? []).map((x: { toObjectId: string | number }) => String(x.toObjectId));
      if (lista.length) trattativeDi.set(String(r.from?.id), lista);
    }
  }

  const idTrattative = Array.from(new Set(Array.from(trattativeDi.values()).flat()));
  const dati = new Map<string, { owner: string; creata: number }>();
  for (let i = 0; i < idTrattative.length; i += 100) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals/batch/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        properties: ["hubspot_owner_id", "createdate"],
        inputs: idTrattative.slice(i, i + 100).map((id) => ({ id }))
      })
    });
    if (!res.ok) return out;
    const data = await res.json();
    for (const r of data.results ?? []) {
      dati.set(String(r.id), {
        owner: String(r.properties?.hubspot_owner_id ?? "").trim(),
        creata: Date.parse(r.properties?.createdate ?? "")
      });
    }
  }

  const QUINDICI_MINUTI = 15 * 60 * 1000;
  for (const r of riunioni) {
    if (!Number.isFinite(r.creata) || !r.proprietario) continue;
    const suoi = (contatti.get(r.id) ?? []).map(String);
    let migliore: { scarto: number; owner: string } | null = null;
    for (const c of suoi) {
      for (const idT of trattativeDi.get(c) ?? []) {
        const d = dati.get(idT);
        if (!d || !Number.isFinite(d.creata) || !d.owner) continue;
        const scarto = Math.abs(d.creata - r.creata);
        if (scarto <= QUINDICI_MINUTI && (!migliore || scarto < migliore.scarto)) {
          migliore = { scarto, owner: d.owner };
        }
      }
    }
    if (migliore && migliore.owner !== r.proprietario) out.set(r.id, migliore.owner);
  }
  return out;
}

/**
 * I contatti che quel giorno hanno fatto una consulenza.
 *
 * L'alias serve alle persone che sono state unite in HubSpot: la trattativa
 * puo' portare il vecchio identificativo, mentre il meeting porta sempre quello
 * buono, e senza risolverlo la consulenza non si aggancerebbe.
 */
async function contattiConConsulenza(dalle: number, alle: number): Promise<Set<number>> {
  const r = await getDb().query(
    `SELECT DISTINCT COALESCE(a.nuovo_id, t.contact_id) AS id
       FROM trattativa t
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND t.svolta_ts >= $1::timestamptz
        AND t.svolta_ts <  $2::timestamptz`,
    [new Date(dalle).toISOString(), new Date(alle).toISOString()]
  );
  return new Set(r.rows.map((x: { id: number }) => Number(x.id)).filter(Number.isFinite));
}

/**
 * I contatti che quel giorno hanno disertato l'appuntamento.
 *
 * PERCHE' NON DALL'ESITO DEL MEETING. HubSpot ha il campo apposta - vale
 * NO_SHOW o CANCELED - ma non lo compila nessuno: su 396 riunioni di settembre
 * un solo NO_SHOW e quattro CANCELED, mentre i no show reali sono piu' della
 * meta' degli appuntamenti. Colorare di grigio quei cinque avrebbe mostrato una
 * diserzione ogni ottanta.
 *
 * Il dato vero sta nella tabella no_show, alimentata dal sync a partire dal
 * workflow di HubSpot: nello stesso periodo sono 183 contatti, una ventina al
 * giorno. E' la stessa scelta gia' fatta per le consulenze svolte, che non
 * vengono da COMPLETED ma da trattativa.svolta_ts.
 *
 * Il collegamento passa dalla trattativa, perche' no_show registra il deal e
 * non il contatto.
 */
/**
 * Chi era in call, per riunione, letto dalle voci nella registrazione.
 *
 * PERCHE' SERVE ANCHE AVENDO GIA' svolte E disertati: quei due arrivano dalle
 * trattative, che l'advisor sposta a fine giornata - misurato sui no show di
 * settembre, fra le 18:00 e le 19:46. Per tutto il pomeriggio l'agenda non sa
 * cosa sia successo la mattina. Le voci lo dicono due minuti dopo la call.
 *
 * Il calcolo non e' qui: lo fa il sync quando abbina la registrazione, e qui
 * si legge soltanto. Vedi chiEraInCall().
 */
async function presenzeDelleRiunioni(
  ids: string[]
): Promise<Map<string, { esito: string; trascrizione: string }>> {
  if (!ids.length) return new Map();
  const r = await getDb().query(
    `SELECT riunione_id, esito, trascrizione FROM presenza_call WHERE riunione_id = ANY($1::text[])`,
    [ids]
  );
  return new Map(
    r.rows.map((x: { riunione_id: string; esito: string; trascrizione: string }) => [
      String(x.riunione_id),
      { esito: String(x.esito), trascrizione: String(x.trascrizione ?? "") }
    ])
  );
}

async function contattiConNoShow(dalle: number, alle: number): Promise<Set<number>> {
  const r = await getDb().query(
    `SELECT DISTINCT COALESCE(a.nuovo_id, t.contact_id) AS id
       FROM no_show n
       JOIN trattativa t ON t.deal_id = n.deal_id
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND n.ts >= $1::timestamptz
        AND n.ts <  $2::timestamptz`,
    [new Date(dalle).toISOString(), new Date(alle).toISOString()]
  );
  return new Set(r.rows.map((x: { id: number }) => Number(x.id)).filter(Number.isFinite));
}

/**
 * Chi sono i proprietari, per numero.
 *
 * Si sfoglia fino in fondo invece di chiedere i primi cento: gli utenti attivi
 * oggi sono 76, e il giorno che diventano 101 i meeting del centunesimo
 * resterebbero senza nome e sparirebbero dall'agenda in silenzio. Gli
 * archiviati non si chiedono: chi non lavora piu' qui non ha una colonna.
 */
async function leggiProprietari(token: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let after: string | undefined;

  do {
    const url = new URL(`${HUBSPOT_API}/crm/v3/owners`);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return map;
    const data = await res.json();
    for (const o of data.results ?? []) {
      map[String(o.id)] = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
    }
    after = data.paging?.next?.after;
  } while (after);

  return map;
}

type RiunioneSpostata = {
  /** L'orario che aveva in questo giorno. */
  inizio: number;
  fine: number;
  /** Dove si trova adesso, per scriverlo sulla card. */
  nuovoInizio: number;
  properties: Record<string, string | null>;
};

/**
 * Le riunioni che ERANO in questo giorno e sono state spostate altrove.
 *
 * PERCHE' SERVONO. L'agenda mette ogni card sull'orario ATTUALE della riunione.
 * Quando un advisor ripianifica, la riunione si sposta e la card la segue: il
 * giorno in cui ha lavorato resta vuoto, e il giorno nuovo mostra un
 * appuntamento "da fare" che in realta' e' gia' stato tenuto una volta.
 * Misurato sul periodo 1 settembre - 15 ottobre: 522 riunioni, 54 con un
 * cambio d'orario, 19 spostate dopo l'inizio della fascia - undici di una
 * persona sola. Sono due o tre call al giorno che sparivano dal passato.
 *
 * DOPO L'INIZIO, NON DOPO LA FINE. Se la riunione viene spostata quando la sua
 * fascia e' gia' cominciata, quella fascia e' stata occupata: l'advisor era li'.
 * Vale sia per la ripianificata dopo una trattativa - la call si e' tenuta -
 * sia per quella dopo un no show, che si segna dopo dieci minuti di attesa e
 * non a fine ora. Spostata PRIMA dell'inizio invece la fascia e' stata liberata
 * in anticipo, e in quel giorno non deve comparire niente.
 *
 * SOLO SUI GIORNI PASSATI. Su oggi e sul futuro non c'e' niente da recuperare,
 * e l'agenda di oggi e' quella che si apre di continuo: le due chiamate in piu'
 * si pagano solo quando si va a guardare indietro.
 *
 * Si cercano fra le riunioni MODIFICATE da quel giorno in poi e che oggi stanno
 * dopo di esso: una riunione che era li' e non c'e' piu' e' per forza stata
 * toccata da allora. Chi viene spostato all'indietro sfugge - non e' mai
 * capitato nel campione - e in cambio la ricerca resta stretta.
 */
async function riunioniSpostate(
  token: string,
  dalle: number,
  alle: number
): Promise<Map<string, RiunioneSpostata>> {
  const out = new Map<string, RiunioneSpostata>();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // I valori della cronologia arrivano come date ISO, non come millisecondi:
  // Number() su "2026-09-15T13:00:00Z" da' NaN, e la riga verrebbe scartata in
  // silenzio.
  const quando = (v: unknown): number => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1e11) return n;
    return Date.parse(String(v));
  };

  const candidati: string[] = [];
  let after: string | undefined;
  do {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/meetings/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              // Modificata da quel giorno in poi: una riunione che era li' e
              // non c'e' piu' e' per forza stata toccata da allora.
              { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(dalle) },
              // Oggi sta dopo quel giorno: se stesse dentro sarebbe gia'
              // nell'elenco principale.
              { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(alle) },
              // CREATA PRIMA DELLA FINE DI QUEL GIORNO. Non e' un'euristica: una
              // riunione nata dopo non puo' essere stata in quel giorno. Toglie
              // di mezzo tutto cio' che e' stato fissato nel frattempo, che su
              // una settimana e' la maggior parte.
              { propertyName: "hs_createdate", operator: "LTE", value: String(alle) }
            ]
          }
        ],
        properties: ["hs_meeting_start_time"],
        limit: 100,
        ...(after ? { after } : {})
      })
    });
    if (!res.ok) return out;
    const data = await res.json();
    candidati.push(...(data.results ?? []).map((r: { id: string }) => String(r.id)));
    after = data.paging?.next?.after;
  } while (after);

  if (!candidati.length) return out;

  for (let i = 0; i < candidati.length; i += 50) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/meetings/batch/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        // Le stesse proprieta' della ricerca principale: cosi' la riunione
        // recuperata entra nell'elenco gia' completa, senza una seconda
        // lettura solo per titolo e proprietario.
        properties: [
          "hs_meeting_title",
          "hs_meeting_start_time",
          "hs_meeting_end_time",
          "hubspot_owner_id",
          "hs_meeting_outcome",
          "hs_createdate"
        ],
        propertiesWithHistory: ["hs_meeting_start_time", "hs_meeting_end_time"],
        inputs: candidati.slice(i, i + 50).map((id) => ({ id }))
      })
    });
    if (!res.ok) return out;
    const data = await res.json();

    for (const r of data.results ?? []) {
      const storia = (r.propertiesWithHistory?.hs_meeting_start_time ?? []) as Array<{
        value: string;
        timestamp: string;
      }>;
      if (storia.length < 2) continue;

      // Dalla piu' vecchia alla piu' recente: ogni voce e' un valore, e la voce
      // successiva dice quando quel valore e' stato sostituito.
      const ordinata = [...storia].sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
      );

      for (let k = 0; k + 1 < ordinata.length; k++) {
        const inizio = quando(ordinata[k].value);
        const sostituito = Date.parse(ordinata[k + 1].timestamp);
        if (!Number.isFinite(inizio) || !Number.isFinite(sostituito)) continue;
        if (inizio < dalle || inizio >= alle) continue;
        if (sostituito < inizio) continue;

        const fineStoria = (r.propertiesWithHistory?.hs_meeting_end_time ?? []) as Array<{
          value: string;
          timestamp: string;
        }>;
        const fineOrdinata = [...fineStoria].sort(
          (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
        );
        // La fine di allora sta nella stessa posizione della cronologia: le due
        // proprieta' cambiano insieme. Se manca si da' mezz'ora, come fa il
        // resto della rotta per le riunioni senza fine.
        const fine = quando(fineOrdinata[k]?.value);
        out.set(String(r.id), {
          inizio,
          fine: Number.isFinite(fine) && fine > inizio ? fine : inizio + 30 * 60 * 1000,
          nuovoInizio: quando(r.properties?.hs_meeting_start_time),
          properties: r.properties ?? {}
        });
        break;
      }
    }
  }

  return out;
}

const DURATA_MEMORIA_MS = 60 * 1000;
let memoria: { chiave: string; scade: number; corpo: unknown } | null = null;

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });

  const giorno = req.nextUrl.searchParams.get("giorno") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
    return NextResponse.json({ error: "Parametro giorno mancante o malformato" }, { status: 400 });
  }

  // Un minuto di memoria: l'agenda cambia durante la giornata - un
  // appuntamento si sposta, uno si conclude - quindi non si tiene a lungo come
  // i totali mensili, ma basta a non rileggere HubSpot a ogni respiro.
  const chiave = giorno;
  if (memoria && memoria.chiave === chiave && memoria.scade > Date.now()) {
    return NextResponse.json(memoria.corpo, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const proprietari = await leggiProprietari(token);

    const dalle = istanteRoma(giorno, 0, 0);
    const alle = dalle + 24 * 60 * 60 * 1000;

    // IL RECUPERO PARTE SUBITO, non dopo: non dipende dalla ricerca principale
    // - gli servono solo le due date - e cosi' i due viaggi a HubSpot si
    // sovrappongono invece di sommarsi. Su un giorno passato erano una decina
    // di secondi buoni.
    const promessaSpostate = alle <= Date.now()
      ? riunioniSpostate(token, dalle, alle).catch((err) => {
          console.error("[advisor-agenda] ripianificate", err instanceof Error ? err.message : err);
          return new Map<string, RiunioneSpostata>();
        })
      : Promise.resolve(new Map<string, RiunioneSpostata>());

    const grezzi: Array<{ id: string; properties: Record<string, string | null> }> = [];
    let after: string | undefined;
    do {
      const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/meetings/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(dalle) },
                { propertyName: "hs_meeting_start_time", operator: "LT", value: String(alle) }
              ]
            }
          ],
          properties: [
            "hs_meeting_title",
            "hs_meeting_start_time",
            "hs_meeting_end_time",
            "hubspot_owner_id",
            "hs_meeting_outcome",
            "hs_createdate"
          ],
          limit: 100,
          ...(after ? { after } : {})
        })
      });
      if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
      const data = await res.json();
      grezzi.push(...(data.results ?? []));
      after = data.paging?.next?.after;
    } while (after);

    // LE RIPIANIFICATE, rimesse nella fascia che avevano occupato. Entrano
    // nell'elenco come tutte le altre - stesso id, quindi stessi contatti,
    // stessa trattativa, stesso stato - ma con l'orario di allora. La card
    // resta anche nel giorno nuovo: e' la stessa riunione vista due volte.
    const spostate = await promessaSpostate;

    if (spostate.size) {
      const gia = new Set(grezzi.map((r) => r.id));
      for (const [id, q] of spostate) {
        if (gia.has(id)) continue;
        grezzi.push({
          id,
          properties: {
            ...q.properties,
            // L'orario e' quello di allora: e' la fascia che questa persona ha
            // occupato, ed e' il posto in cui la card deve tornare.
            hs_meeting_start_time: new Date(q.inizio).toISOString(),
            hs_meeting_end_time: new Date(q.fine).toISOString()
          }
        });
      }
    }

    // Le due letture che dicono quali appuntamenti si sono davvero svolti.
    // Se una delle due non risponde, gli appuntamenti restano "fissati": e'
    // meno informazione, non informazione sbagliata.
    const [contatti, svolte, disertati, presenze] = await Promise.all([
      contattiDeiMeeting(token, grezzi.map((r) => r.id)).catch((err) => {
        console.error("[advisor-agenda] associazioni", err instanceof Error ? err.message : err);
        return new Map<string, number[]>();
      }),
      contattiConConsulenza(dalle, alle).catch((err) => {
        console.error("[advisor-agenda] consulenze", err instanceof Error ? err.message : err);
        return new Set<number>();
      }),
      contattiConNoShow(dalle, alle).catch((err) => {
        console.error("[advisor-agenda] no show", err instanceof Error ? err.message : err);
        return new Set<number>();
      }),
      presenzeDelleRiunioni(grezzi.map((r) => r.id)).catch((err) => {
        console.error("[advisor-agenda] presenze", err instanceof Error ? err.message : err);
        return new Map<string, { esito: string; trascrizione: string }>();
      })
    ]);

    // L'analisi si chiede dopo, perche' serve sapere prima chi sono i contatti
    // di giornata. Se non risponde, l'agenda resta quella di sempre: le schede
    // non si aprono, ma nessun appuntamento sparisce.
    const gestori = await gestoriEffettivi(
      token,
      grezzi.map((r) => ({
        id: r.id,
        creata: Date.parse(r.properties.hs_createdate ?? ""),
        proprietario: String(r.properties.hubspot_owner_id ?? "").trim()
      })),
      contatti
    ).catch((err) => {
      console.error("[advisor-agenda] gestori effettivi", err instanceof Error ? err.message : err);
      return new Map<string, string>();
    });

    const diGiornata = Array.from(new Set(Array.from(contatti.values()).flat()));
    const [analisi, trascrizioni] = await Promise.all([
      analisiDeiContatti(token, diGiornata, giorno).catch((err) => {
        console.error("[advisor-agenda] analisi call", err instanceof Error ? err.message : err);
        return new Map<number, AnalisiCall>();
      }),
      trascrizioniDeiContatti(token, diGiornata).catch((err) => {
        console.error("[advisor-agenda] trascrizioni", err instanceof Error ? err.message : err);
        return new Map<number, string>();
      })
    ]);

    let senzaPersona = 0;
    let svolteTrovate = 0;
    const eventi: EventoAgenda[] = [];
    const idDiEvento: Array<string | undefined> = [];

    for (const r of grezzi) {
      const p = r.properties;
      const idPrenotato = (p.hubspot_owner_id ?? "").trim();
      const nomePrenotato = idPrenotato ? proprietari[idPrenotato] ?? "" : "";

      // LA COLONNA E' DI CHI HA TENUTO LA CONSULENZA, non di chi l'aveva
      // prenotata: quando un appuntamento passa a un altro advisor, mettere la
      // card nella colonna dell'originale farebbe risultare occupato chi non
      // stava facendo niente e libero chi stava lavorando, e sbaglierebbe i
      // conteggi di entrambi.
      const idEffettivo = gestori.get(r.id) ?? idPrenotato;
      const nomeEffettivo = idEffettivo ? proprietari[idEffettivo] ?? "" : "";

      // Se il nuovo proprietario non e' fra gli attivi - un utente archiviato,
      // per esempio - si resta su quello prenotato invece di perdere la riga.
      const operatore = nomeEffettivo || nomePrenotato;
      if (!operatore) {
        senzaPersona += 1;
        continue;
      }
      const prenotatoPer = nomeEffettivo && nomeEffettivo !== nomePrenotato ? nomePrenotato : "";

      const da = oraRoma(p.hs_meeting_start_time ?? "");
      if (!da) continue;
      const a = oraRoma(p.hs_meeting_end_time ?? "");

      // Un meeting senza fine, o che scavalca la mezzanotte, prende mezz'ora:
      // meglio un blocco corto di uno che si allunga fino a fondo giornata.
      const fineMin = a && a.minuti > da.minuti ? a.minuti : Math.min(da.minuti + 30, 24 * 60);

      const titolo = (p.hs_meeting_title ?? "").trim();
      // Il titolo dice "Contatto and <advisor prenotato>", quindi si ripulisce
      // con quel nome anche quando la card finisce in un'altra colonna.
      const nelTitolo = nomePrenotato || operatore;
      const senzaAdvisor = titolo
        .replace(new RegExp(`\\s+and\\s+${nelTitolo.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$`, "i"), "")
        .trim();

      let tipo = tipoDa(p.hs_meeting_outcome);
      const suoiContatti = contatti.get(r.id) ?? [];

      // L'ORDINE DELLE FONTI, dalla piu' forte alla piu' debole.
      //
      // 1. CHI PARLA NELLA REGISTRAZIONE, quando dice che il cliente c'era. E'
      //    un'osservazione diretta e arriva subito, mentre le trattative
      //    arrivano a sera. Vince anche su un no show gia' segnato, perche'
      //    quel caso l'abbiamo guardato: una consulenza del 7 settembre
      //    risultava disertata mentre la trascrizione porta il cliente che
      //    saluta per nome e parla per 42 battute in 12 minuti. La
      //    registrazione aveva ragione.
      // 2. LE TRATTATIVE, che restano la fonte per tutto cio' che Fireflies
      //    non ha visto - e oggi e' la maggioranza, perche' su sette
      //    postazioni su undici l'estensione non cattura.
      // 3. LE VOCI QUANDO DICONO CHE C'ERA SOLO L'ADVISOR: vale meno del
      //    punto 2 perche' una trattativa segnata svolta e' un'affermazione
      //    di una persona, e in quel conflitto preferiamo crederle.
      //
      // Il quarto stato, "non-si-sa", non compare qui apposta: quando la
      // registrazione non ha frasi non si conclude niente e si scende al
      // punto 2. E' cio' che impedisce agli advisor le cui postazioni non
      // catturano di riempirsi di no show inventati.
      const presenza = presenze.get(r.id)?.esito;
      if (presenza === "presentato") {
        if (tipo !== "svolta") svolteTrovate += 1;
        tipo = "svolta";
      } else if (suoiContatti.some((c) => svolte.has(c))) {
        if (tipo !== "svolta") svolteTrovate += 1;
        tipo = "svolta";
      } else if (presenza === "solo-advisor") {
        tipo = "annullato";
      } else if (suoiContatti.some((c) => disertati.has(c))) {
        tipo = "annullato";
      }

      const suoi = contatti.get(r.id) ?? [];
      const analisiSua = suoi.map((c) => analisi.get(c)).find(Boolean);
      // PRIMA IL NOSTRO DATO, POI QUELLO DI HUBSPOT.
      //
      // L'identificativo della trascrizione lo decide il nostro abbinamento e lo
      // salviamo in presenza_call: leggerlo da li' e' diretto, sta nel database
      // che stiamo gia' interrogando e non dipende da nessuno.
      //
      // La proprieta' sul contatto resta come riserva, e serve ancora: le righe
      // in presenza_call esistono solo da quando il webhook e' in funzione,
      // mentre le giornate precedenti hanno il collegamento solo su HubSpot.
      //
      // Non e' una preferenza di stile. Oggi la lettura a blocchi da HubSpot ha
      // restituito quarantadue contatti tutti senza quel campo, mentre lo stesso
      // contatto letto da solo - stesso token, stessa richiesta, stessa funzione
      // - il campo ce l'aveva. Su ieri invece ne tornavano sette su trentasei.
      // Non ho una spiegazione di quel comportamento; ho pero' un dato nostro
      // che non ne ha bisogno.
      const idTrascrizioneSua =
        presenze.get(r.id)?.trascrizione || suoi.map((c) => trascrizioni.get(c)).find(Boolean);

      eventi.push({
        operatore,
        titolo: senzaAdvisor || titolo || "Senza titolo",
        inizioMin: da.minuti,
        fineMin,
        inizio: da.testo,
        fine: a ? a.testo : "",
        tipo,
        ...(analisiSua ? { analisi: analisiSua } : {}),
        ...(idTrascrizioneSua ? { trascrizione: linkTrascrizione(idTrascrizioneSua) } : {}),
        ...(prenotatoPer ? { prenotatoPer } : {}),
        ...(spostate.has(r.id)
          ? {
              ripianificata: new Date(spostate.get(r.id)!.nuovoInizio).toLocaleDateString("it-IT", {
                timeZone: "Europe/Rome",
                day: "2-digit",
                month: "2-digit"
              })
            }
          : {}),
        ...(creataAMano(p.hs_meeting_outcome) ? { manuale: true } : {}),
        ...(presenza ? { presenza: presenza as "presentato" | "solo-advisor" | "non-si-sa" } : {})
      });
      idDiEvento.push(idTrascrizioneSua);
    }

    // L'audio si chiede solo per le trascrizioni che compaiono davvero in
    // giornata - oggi una manciata - e l'agenda tiene comunque un minuto di
    // memoria, quindi non si ripete a ogni respiro.
    const audio = await audioDelleTrascrizioni([
      ...new Set(idDiEvento.filter((x): x is string => Boolean(x)))
    ]);
    eventi.forEach((e, i) => {
      const id = idDiEvento[i];
      const d = id ? audio.get(id) : undefined;
      if (d?.audio) e.audio = d.audio;
      if (d?.durataMin) e.durataMin = d.durataMin;
    });

    eventi.sort((x, y) => x.inizioMin - y.inizioMin);
    console.log(
      `[advisor-agenda] ${giorno}: ${eventi.length} eventi, ${new Set(eventi.map((e) => e.operatore)).size} persone, ` +
        `${eventi.filter((e) => e.tipo === "svolta").length} svolte (${svolteTrovate} dalle trattative), ` +
        `${eventi.filter((e) => e.tipo === "annullato").length} disertate, ` +
        `${eventi.filter((e) => e.analisi).length} con analisi, ` +
        `${eventi.filter((e) => e.trascrizione).length} con trascrizione, ` +
        `${eventi.filter((e) => e.audio).length} con audio, ` +
        `${eventi.filter((e) => e.prenotatoPer).length} passati a un altro advisor` +
        (senzaPersona ? `, ${senzaPersona} senza proprietario` : "")
    );

    // CONTI DI CONTROLLO. Quando in agenda manca qualcosa, da fuori non si
    // distingue fra "il dato non c'e'" e "il dato c'e' ma si perde per
    // strada": questi numeri dicono a quale anello si e' rotta la catena
    // senza dover leggere i log del server. Viaggiano dentro il corpo perche'
    // devono restare veri anche quando la risposta arriva dalla memoria.
    const conti = {
      riunioni: grezzi.length,
      contattiAssociati: diGiornata.length,
      trascrizioniRisolte: trascrizioni.size,
      analisiTrovate: analisi.size,
      presenzeLette: presenze.size,
      contattiLetti,
      contattiConCampo,
      portale: await portaleCollegato(token),
      ...(req.nextUrl.searchParams.get("sonda")
        ? {
            sonda: {
              ...(await sondaContatto(token, req.nextUrl.searchParams.get("sonda") as string)),
              // Il contatto compare fra quelli letti per la giornata? Se la sonda
              // lo vede pieno ma qui risulta assente, non e' un problema di
              // permessi: stiamo leggendo un altro insieme di contatti.
              inGiornata: diGiornata.includes(Number(req.nextUrl.searchParams.get("sonda")))
            }
          }
        : {}),
      ...(ultimoErrore ? { erroreTrascrizioni: ultimoErrore } : {})
    };

    const corpo = { giorno, eventi, conti };
    memoria = { chiave, scade: Date.now() + DURATA_MEMORIA_MS, corpo };
    return NextResponse.json(corpo, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[advisor-agenda]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "HubSpot non raggiungibile" }, { status: 502 });
  }
}
