import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";
import { PIPELINE_APPUNTAMENTI } from "@/lib/trattative/sync";

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
/**
 * NON C'E' UNO STATO "ANNULLATO", e non e' una dimenticanza.
 *
 * Quando un cliente disdice, l'evento viene tolto da Google Calendar e
 * l'integrazione cancella la riunione su HubSpot: non resta traccia, e in
 * agenda non c'e' nessuna card da colorare. Verificato con una prova diretta.
 *
 * L'unico segnale possibile sarebbe hs_meeting_outcome = CANCELED, ma quel
 * campo non lo mantiene nessuno: su 542 riunioni di settembre, 494 sono ferme
 * a SCHEDULED e le quattro CANCELED sono tre record di prova piu' una messa a
 * mano dal telefono. Uno stato che si accende una volta in tre mesi non aiuta
 * a leggere una giornata.
 */
export type TipoEvento = "appuntamento" | "svolta" | "no_show";

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
  /**
   * Quando la call si e' tenuta in questo giorno ma l'APPUNTAMENTO e' fissato
   * altrove. Contiene la data dell'appuntamento.
   *
   * Succede quando l'advisor rimanda la consulenza e si risentono giorni dopo
   * nella stessa stanza, senza spostare la data in calendario: la card
   * comparirebbe solo nel giorno vuoto, e il giorno in cui si e' lavorato
   * davvero non mostrerebbe niente.
   */
  appuntamentoDel?: string;
  /**
   * LA CARD NON VIENE DA UNA RIUNIONE: e' ricavata dalla registrazione, perche'
   * sul CRM quell'appuntamento non esiste proprio.
   *
   * Rientra nella stessa casistica di `appuntamentoDel` - "assente su CRM" - e
   * si disegna allo stesso modo: la fascia non era nel piano. La differenza e'
   * che li' l'appuntamento esiste ma sta in un altro giorno, qui non esiste.
   */
  senzaRiunione?: true;
  /**
   * L'APPUNTAMENTO ESISTE SOLO SULLA TRATTATIVA: in calendario non e' stato
   * creato niente.
   *
   * Succede quando l'advisor rimanda la consulenza spostando la fase della
   * trattativa - che per il CRM e' la cosa che conta - senza spostare anche la
   * riunione. L'agenda legge le riunioni, quindi quella fascia restava vuota e
   * la consulenza spariva da tutti e due i sistemi.
   */
  soloSulCrm?: true;
  /**
   * LA CONSULENZA HA CHIUSO: contiene la data in cui la trattativa e' stata
   * vinta.
   *
   * Non e' lo stato dell'appuntamento - quello lo dice gia' il colore - ma
   * l'esito commerciale, che e' un'altra cosa e arriva quasi sempre dopo: la
   * consulenza e' di martedi', il contratto si chiude giovedi'. Per questo la
   * card puo' diventare "vinta" giorni dopo essere diventata verde.
   */
  vinta?: string;
  /**
   * DOVE STA LA TRATTATIVA ADESSO: "Semina", "No Show", "Ripianificata
   * (Trattativa)".
   *
   * Non e' lo stato della card - quello lo dice il colore, e riguarda questa
   * fascia - ma dove e' arrivata la pratica del cliente. Le due cose divergono
   * di continuo: una consulenza svolta ieri puo' avere la trattativa in Semina
   * da stamattina, e chi guarda la scheda vuole sapere tutte e due.
   */
  esito?: string;
  /**
   * LA PRATICA E' STATA PERSA, e la perdita e' arrivata da questa consulenza in
   * poi.
   *
   * Speculare a `vinta`: stessa natura - l'esito commerciale, non lo stato della
   * fascia - e stesso vincolo, che il movimento non sia anteriore al giorno
   * dell'appuntamento. Una trattativa persa prima non riguarda una consulenza
   * che doveva ancora tenersi.
   */
  persa?: true;
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
  // L'esito sulla riunione e' quasi sempre vuoto. Quando c'e', CANCELED e
  // NO_SHOW dicono la stessa cosa a chi legge l'agenda: quella fascia non ha
  // prodotto una consulenza.
  if (e === "CANCELED" || e === "NO_SHOW") return "no_show";
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
): Promise<Map<string, { audio?: string; durataMin?: number; sparita?: true }>> {
  const out = new Map<string, { audio?: string; durataMin?: number; sparita?: true }>();
  const chiave = process.env.FIREFLIES_API_KEY;
  if (!chiave || !ids.length) return out;

  // CINQUE ALLA VOLTA, NON UNA DIETRO L'ALTRA. Fireflis vuole una chiamata per
  // trascrizione, e in fila indiana il costo si somma: misurato, dieci secondi
  // e mezzo su una giornata piena - da sola, piu' di tutto il resto della
  // rotta. Erano poche finche' le registrazioni agganciate erano poche; da
  // quando ne recuperiamo anche di spostate e orfane sono diventate tante.
  //
  // Otto alla volta: il piano Business regge sessanta chiamate al minuto e
  // un'agenda piena ne chiede una ventina, quindi si sta larghi. Provato anche
  // a chiederle tutte in una sola interrogazione GraphQL con gli alias:
  // funziona, ma Fireflies le elabora comunque in fila - cinque insieme
  // costano quanto cinque separate - quindi non guadagna niente.
  const ALLA_VOLTA = 8;
  for (let i = 0; i < ids.length; i += ALLA_VOLTA) {
    await Promise.all(
      ids.slice(i, i + ALLA_VOLTA).map(async (id) => {
        try {
          const res = await fetch("https://api.fireflies.ai/graphql", {
            method: "POST",
            headers: { Authorization: `Bearer ${chiave}`, "Content-Type": "application/json" },
            // La durata arriva dalla stessa interrogazione: e' un campo in piu'
            // nella risposta, non una chiamata in piu'.
            body: JSON.stringify({ query: `{ transcript(id: "${id}") { audio_url duration } }` })
          });
          if (!res.ok) return;
          const dati = await res.json();

          // LA REGISTRAZIONE CANCELLATA, e solo quella.
          //
          // Quando qualcuno elimina una registrazione dall'archivio di Fireflies
          // il collegamento resta scritto in banca dati e porta a una pagina che
          // non esiste: meglio togliere il pulsante che offrirlo morto. Misurato
          // il 19 settembre: tre registrazioni cancellate in cinque giorni, tutte
          // call brevi - tredici, ventuno e ventisei minuti.
          //
          // SERVE IL CODICE DELL'ERRORE, non basta che la risposta sia vuota.
          // Quando si chiedono troppe trascrizioni di fila Fireflies risponde
          // con transcript a null anche per quelle che esistono: fidandosi di
          // quel null si cancellerebbero i pulsanti buoni - provato, 49
          // "sparite" su 96 diventate 3 rifacendo la misura con calma. Solo
          // `object_not_found` dice davvero che l'oggetto non c'e' piu'.
          const codici = (dati?.errors ?? []).map(
            (e: { extensions?: { code?: string }; code?: string }) =>
              String(e?.extensions?.code ?? e?.code ?? "")
          );
          if (codici.includes("object_not_found")) {
            out.set(id, { sparita: true });
            return;
          }

          const risposta = dati?.data?.transcript;
          if (!risposta) return;

          const url = risposta?.audio_url;
          const durata = Number(risposta?.duration);
          out.set(id, {
            ...(typeof url === "string" && url.startsWith("http") ? { audio: url } : {}),
            ...(Number.isFinite(durata) && durata > 0 ? { durataMin: Math.round(durata) } : {})
          });
        } catch {
          // una registrazione senza audio non e' un motivo per far fallire l'agenda
        }
      })
    );
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

/** La data fra parentesi quadre nel campo del contatto: dice a QUALE
 *  appuntamento appartiene quella registrazione. Senza, una registrazione
 *  finirebbe su qualunque card passata dello stesso cliente. */
function appuntamentoDelLink(valore: string | null | undefined): number {
  const dentro = String(valore ?? "").match(/\[([^\]]+)\]/)?.[1]?.trim();
  const t = dentro ? Date.parse(dentro) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

async function trascrizioniDeiContatti(
  token: string,
  contatti: number[]
): Promise<Map<number, { id: string; appuntamento: number }>> {
  ultimoErrore = null;
  contattiLetti = 0;
  contattiConCampo = 0;
  // Il valore della mappa e' l'IDENTIFICATIVO della trascrizione: da quello si
  // ricavano sia l'indirizzo della pagina sia, con una chiamata, il file audio.
  const out = new Map<number, { id: string; appuntamento: number }>();
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
      if (trascrizione && Number.isFinite(id)) {
        out.set(id, {
          id: trascrizione,
          appuntamento: appuntamentoDelLink(r.properties?.link_trascrizione_fireflies)
        });
      }
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
 * Le consulenze dei contatti di giornata, CON LA LORO DATA.
 *
 * NON PIU' SOLO QUELLE SEGNATE DENTRO IL GIORNO GUARDATO. La data e' l'istante
 * in cui l'advisor sposta di fase la trattativa, non l'ora della call: chi
 * conferma gli esiti la mattina dopo lasciava la card azzurra per sempre.
 * Misurato il 17 settembre su un caso: consulenza del 16 alle 11:00, trattativa
 * portata a Persa alle 09:05 del giorno dopo, sincronizzata alle 09:23 - il
 * dato era in banca dati, ma cadeva fuori dal 16 e la card restava "fissato".
 *
 * I no show questa tolleranza ce l'avevano gia': la finestra e la scelta di
 * quale esito vale sono ora le stesse per entrambi - vedi esitoPiuVicino().
 *
 * L'alias serve alle persone che sono state unite in HubSpot: la trattativa
 * puo' portare il vecchio identificativo, mentre il meeting porta sempre quello
 * buono, e senza risolverlo la consulenza non si aggancerebbe.
 */
type Consulenza = { svolta: number; vinta: number | null };

async function consulenzeDeiContatti(dalle: number, alle: number): Promise<Map<number, Consulenza[]>> {
  const out = new Map<number, Consulenza[]>();
  const r = await getDb().query<{ id: string; ts: string; vinta: string | null }>(
    `SELECT COALESCE(a.nuovo_id, t.contact_id) AS id, t.svolta_ts AS ts, t.vinta_ts AS vinta
       FROM trattativa t
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND t.svolta_ts >= $1::timestamptz
        AND t.svolta_ts <  $2::timestamptz`,
    [
      new Date(dalle - FINESTRA_ESITI_MS).toISOString(),
      new Date(alle + FINESTRA_ESITI_MS).toISOString()
    ]
  );
  for (const x of r.rows) {
    const id = Number(x.id);
    const t = new Date(x.ts).getTime();
    if (!Number.isFinite(id) || !Number.isFinite(t)) continue;
    const v = x.vinta ? new Date(x.vinta).getTime() : NaN;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push({ svolta: t, vinta: Number.isFinite(v) ? v : null });
  }
  return out;
}

/** L'orario arrotondato alla mezz'ora piu' vicina, in minuti dalla mezzanotte. */
function allaMezzOra(minuti: number): number {
  return Math.max(0, Math.min(24 * 60, Math.round(minuti / 30) * 30));
}

/**
 * LE PRATICHE DEI CONTATTI DI GIORNATA, con la fase in cui stanno adesso.
 *
 * Serve alla scheda che si apre cliccando una card: li' si vuole sapere dove e'
 * arrivata la trattativa - Semina, No Show, Vinta - che e' un'altra cosa dal
 * colore della card. Si legge dalla nostra tabella, quindi non costa una
 * chiamata a HubSpot.
 *
 * La data di creazione serve a scegliere: un cliente puo' avere piu' pratiche, e
 * quella di questo appuntamento e' la nata insieme a lui.
 */
async function praticheDeiContatti(
  contatti: number[]
): Promise<Map<number, Array<{ fase: string; motivo: string; creata: number; quando: number }>>> {
  const out = new Map<number, Array<{ fase: string; motivo: string; creata: number; quando: number }>>();
  if (!contatti.length) return out;
  const { rows } = await getDb().query<{
    id: string;
    fase: string | null;
    motivo: string | null;
    creata: Date | null;
    quando: Date | null;
  }>(
    `SELECT COALESCE(a.nuovo_id, t.contact_id) AS id, t.fase, t.motivo,
            t.creata_ts AS creata, t.fase_ts AS quando
       FROM trattativa t
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE COALESCE(a.nuovo_id, t.contact_id) = ANY($1::bigint[])
        AND t.fase IS NOT NULL`,
    [contatti]
  );
  for (const r of rows) {
    const id = Number(r.id);
    if (!Number.isFinite(id)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push({
      fase: String(r.fase ?? ""),
      motivo: String(r.motivo ?? ""),
      creata: r.creata ? r.creata.getTime() : NaN,
      quando: r.quando ? r.quando.getTime() : NaN
    });
  }
  return out;
}

/**
 * Che cosa dice una fase, quando il cambio e' del giorno stesso.
 *
 * Si ragiona sulle ETICHETTE e non sugli identificativi, che sono numeri senza
 * significato e cambierebbero in silenzio: le etichette si leggono dalla
 * pipeline a ogni richiesta, quindi una rinomina si vede subito.
 *
 * "Ripianificata" da sola non dice niente e va letta col motivo: o la consulenza
 * si e' tenuta e se ne fissa un'altra, o il cliente non si e' presentato. "Da
 * Svolgere" e "Archiviata" non concludono niente: la prima e' l'attesa, la
 * seconda un riordino d'archivio che puo' arrivare mesi dopo.
 */
function esitoDaFase(etichetta: string, motivo: string): TipoEvento | null {
  const f = etichetta.trim().toLowerCase();
  const m = motivo.trim().toLowerCase();
  if (f === "no show") return "no_show";
  if (f === "ripianificata") {
    if (m === "mancata presenza") return "no_show";
    return m ? "svolta" : null;
  }
  if (["vinta", "persa", "semivinta", "semina"].includes(f)) return "svolta";
  return null;
}

/** Le etichette delle fasi della pipeline Appuntamenti, per numero. */
async function etichetteDelleFasi(token: string): Promise<Map<string, string>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/pipelines/deals/${PIPELINE_APPUNTAMENTI}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return new Map();
  const dati = await res.json();
  return new Map<string, string>(
    (dati.stages ?? []).map((x: { id: string; label: string }) => [String(x.id), String(x.label)])
  );
}

/**
 * GLI ESITI SEGNATI SULLA TRATTATIVA NEL GIORNO GUARDATO.
 *
 * IL CASO. Una fascia passata resta azzurra quando nessuno ha segnato niente,
 * ma anche quando l'advisor ha spostato la trattativa in una fase che il calcolo
 * delle consulenze svolte non cattura: Persa, Semina, Semivinta. Misurato il 17
 * settembre - su sette card azzurre, cinque avevano la trattativa gia' andata
 * avanti e una sola era davvero da esitare.
 *
 * LA REGOLA E' IL GIORNO. Se la fase e' cambiata nello stesso giorno della
 * fascia, quell'esito e' il suo. Se e' cambiata prima riguarda un appuntamento
 * precedente e la card resta com'e': di un "no show" di due giorni fa non si sa
 * se volesse dire "annullato", e in quel caso l'advisor avrebbe dovuto
 * cancellare riunione e trattativa.
 */
async function esitiDelGiorno(
  dalle: number,
  alle: number
): Promise<Map<number, Array<{ ts: number; fase: string; motivo: string }>>> {
  const out = new Map<number, Array<{ ts: number; fase: string; motivo: string }>>();
  const { rows } = await getDb().query<{ id: string; ts: Date; fase: string | null; motivo: string | null }>(
    `SELECT COALESCE(a.nuovo_id, t.contact_id) AS id, t.fase_ts AS ts, t.fase, t.motivo
       FROM trattativa t
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND t.fase_ts >= $1::timestamptz
        AND t.fase_ts <  $2::timestamptz`,
    [new Date(dalle).toISOString(), new Date(alle).toISOString()]
  );
  for (const r of rows) {
    const id = Number(r.id);
    if (!Number.isFinite(id)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push({ ts: r.ts.getTime(), fase: String(r.fase ?? ""), motivo: String(r.motivo ?? "") });
  }
  return out;
}

/**
 * GLI APPUNTAMENTI CHE ESISTONO SOLO SULLA TRATTATIVA.
 *
 * Quando un advisor rimanda una consulenza sposta la fase della trattativa a
 * Ripianificata e indica quando si terra'. Quel "quando" finisce nella Data di
 * chiusura, e dal 18 settembre 2026 porta anche l'ora, perche' il CRM ora la
 * pretende. Se pero' nessuno sposta anche la riunione in calendario, l'agenda -
 * che le riunioni le legge da li' - mostra una fascia vuota: per il CRM
 * l'appuntamento c'e', per Google no, e quel giorno nessuno lo aspetta.
 *
 * La card che ne esce e' azzurra come ogni appuntamento da tenersi, e
 * tratteggiata perche' in calendario non esiste. Dura un'ora, che e' la misura
 * di tutte le consulenze: la trattativa non dice quanto durera'.
 *
 * NIENTE CARD DOPPIE: se quel cliente e' gia' in agenda quel giorno - perche' la
 * riunione e' stata spostata davvero - questa si tace.
 */
async function appuntamentiSoloSulCrm(
  token: string,
  dalle: number,
  alle: number,
  proprietari: Record<string, string>
): Promise<EventoAgenda[]> {
  const { rows } = await getDb().query<{
    deal_id: string;
    quando: Date;
    proprietario_id: string | null;
    contact_id: string | null;
  }>(
    `SELECT deal_id::text, ripianificata_al AS quando, proprietario_id::text, contact_id::text
       FROM trattativa
      WHERE ripianificata_al >= $1::timestamptz AND ripianificata_al < $2::timestamptz
      ORDER BY ripianificata_al`,
    [new Date(dalle).toISOString(), new Date(alle).toISOString()]
  );
  if (!rows.length) return [];

  // Il nome del cliente sta sul contatto, non sulla trattativa: una lettura a
  // blocchi per tutti, che di norma sono due o tre.
  const idContatti = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  const nomi = new Map<string, string>();
  if (idContatti.length) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: ["firstname", "lastname"],
        inputs: idContatti.map((id) => ({ id }))
      })
    });
    if (res.ok) {
      const dati = await res.json();
      for (const c of dati.results ?? []) {
        const nome = `${c.properties?.firstname ?? ""} ${c.properties?.lastname ?? ""}`.trim();
        if (nome) nomi.set(String(c.id), nome);
      }
    }
  }

  const out: EventoAgenda[] = [];
  for (const r of rows) {
    const operatore = proprietari[String(r.proprietario_id ?? "")] ?? "";
    const titolo = nomi.get(String(r.contact_id ?? "")) ?? "";
    if (!operatore || !titolo) continue;

    const da = oraRoma(r.quando.toISOString());
    if (!da) continue;
    const fineMin = Math.min(da.minuti + 60, 24 * 60);

    out.push({
      operatore,
      titolo,
      inizioMin: da.minuti,
      fineMin,
      inizio: da.testo,
      fine: `${due(Math.floor(fineMin / 60))}:${due(fineMin % 60)}`,
      tipo: "appuntamento",
      soloSulCrm: true
    });
  }
  return out;
}

/**
 * LE CONSULENZE CHE ESISTONO SOLO COME REGISTRAZIONE.
 *
 * IL CASO. L'advisor fa la call e la vendita la registra creando la trattativa
 * gia' vinta, senza che nessuno abbia mai messo in calendario l'appuntamento.
 * Sul CRM non c'e' nessuna riunione, quindi in agenda non c'e' nessuna card - e
 * un'ora di lavoro, con un contratto in fondo, non compare da nessuna parte.
 * Misurato il 17 settembre: consulenza delle 10:00, 61 minuti registrati,
 * vendita alle 11:26, colonna dell'advisor vuota.
 *
 * SI LEGGONO DALLA BANCA DATI, non da Fireflies. A riconoscerle e' il sync
 * delle trascrizioni, che gira a ogni registrazione consegnata e sa gia' quali
 * sono rimaste senza appuntamento - stanza, cliente, durata. Prima questo
 * calcolo lo rifaceva l'agenda a ogni apertura, un giorno alla volta: cosi'
 * invece lo stesso dato serve anche alla tabella Advisor, che copre settimane,
 * e i due numeri non possono divergere.
 *
 * L'INIZIO SI ARROTONDA ALLA MEZZ'ORA: una call comincia alle 10:03 e la fascia
 * era le 10:00, e mostrarla spostata di tre minuti rispetto a tutte le altre
 * farebbe sembrare un dato piu' preciso di quello che e'.
 */
/**
 * Il contatto che porta questo nome, se ce n'e' UNO SOLO.
 *
 * Serve a dare un cliente alle card ricavate dalla registrazione, dove l'unica
 * traccia di chi c'era e' l'etichetta che Fireflies mette alla voce. Con quel
 * contatto si sa se la consulenza ha chiuso.
 *
 * DUE OMONIMI E SI LASCIA PERDERE: attribuire la vendita alla persona sbagliata
 * e' peggio che non mostrarla, perche' non si vede e non si corregge. Per lo
 * stesso motivo il nome deve avere almeno due parole: "Giuseppe" da solo
 * pescherebbe mezzo database.
 */
async function contattoDalNome(token: string, nome: string): Promise<number | null> {
  const parti = nome.trim().split(/\s+/).filter((x) => x.length > 1);
  if (parti.length < 2) return null;

  // TRE TENTATIVI, PERCHE' IL SILENZIO QUI NON SI VEDE. Se la ricerca non
  // risponde - un limite di frequenza, un errore momentaneo - restiamo senza
  // contatto, e senza contatto la card perde la vendita: resta verde invece che
  // arancione, e non c'e' niente che segnali l'errore. Successo alla prima
  // consulenza ricavata da una registrazione: la card e' uscita verde, e un
  // minuto dopo la stessa richiesta dava il dato giusto.
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    if (tentativo) await new Promise((r) => setTimeout(r, 400 * tentativo));
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
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
    });
    // Un errore si ritenta; una risposta buona con zero o due omonimi no,
    // perche' ritentarla darebbe lo stesso risultato.
    if (!res.ok) continue;
    const dati = await res.json();
    const trovati = dati.results ?? [];
    if (trovati.length !== 1) return null;
    const id = Number(trovati[0].id);
    return Number.isFinite(id) ? id : null;
  }
  console.warn("[advisor-agenda] contatto non cercabile per nome:", nome);
  return null;
}

async function cardDaRegistrazioni(
  token: string,
  dalle: number,
  alle: number,
  proprietari: Record<string, string>
): Promise<Array<{ evento: EventoAgenda; idTrascrizione: string; contatto: number | null; vinta: number | null }>> {
  const { rows } = await getDb().query<{
    trascrizione: string;
    advisor_id: string;
    inizio_ts: Date;
    durata_min: number;
    cliente: string;
    contatto_id: string | null;
    vinta_ts: Date | null;
  }>(
    // LA VENDITA ARRIVA DALLA PRATICA AGGANCIATA, quando si e' riusciti a
    // stabilirla: la sceglie il sync confrontando la "Data di chiusura" della
    // trattativa con il giorno della registrazione. E' l'unico modo di sapere a
    // quale pratica appartenga una consulenza che nessun appuntamento collega,
    // e serve quando il cliente ne ha piu' di una aperta.
    `SELECT f.trascrizione, f.advisor_id::text, f.inizio_ts, f.durata_min, f.cliente,
            f.contatto_id::text, t.vinta_ts
       FROM consulenza_fuori_crm f
       LEFT JOIN trattativa t ON t.deal_id = f.deal_id
      WHERE f.inizio_ts >= $1::timestamptz AND f.inizio_ts < $2::timestamptz
      ORDER BY f.inizio_ts`,
    [new Date(dalle).toISOString(), new Date(alle).toISOString()]
  );

  const out: Array<{ evento: EventoAgenda; idTrascrizione: string; contatto: number | null; vinta: number | null }> = [];
  for (const r of rows) {
    const operatore = proprietari[String(r.advisor_id)] ?? "";
    if (!operatore) continue;

    const da = oraRoma(r.inizio_ts.toISOString());
    if (!da) continue;
    const inizioMin = allaMezzOra(da.minuti);
    const fine = Math.min(allaMezzOra(da.minuti + Number(r.durata_min ?? 0)), 24 * 60);
    const fineMin = fine > inizioMin ? fine : inizioMin + 30;

    const contattoSalvato = Number(r.contatto_id ?? "");
    out.push({
      idTrascrizione: r.trascrizione,
      // La pratica agganciata batte la ricerca per contatto: e' piu' precisa,
      // perche' distingue fra due trattative dello stesso cliente.
      vinta: r.vinta_ts ? r.vinta_ts.getTime() : null,
      contatto: Number.isFinite(contattoSalvato) && contattoSalvato > 0
        ? contattoSalvato
        : await contattoDalNome(token, r.cliente).catch(() => null),
      evento: {
        operatore,
        titolo: r.cliente,
        inizioMin,
        fineMin,
        inizio: `${due(Math.floor(inizioMin / 60))}:${due(inizioMin % 60)}`,
        fine: `${due(Math.floor(fineMin / 60))}:${due(fineMin % 60)}`,
        // Qualcuno ha parlato con l'advisor per piu' di dieci minuti: la
        // consulenza si e' tenuta, non serve altro per dirlo.
        tipo: "svolta",
        senzaRiunione: true,
        trascrizione: linkTrascrizione(r.trascrizione),
        presenza: "presentato"
      }
    });
  }
  return out;
}

/**
 * LE VENDITE DEI CONTATTI, anche quelle senza una consulenza registrata.
 *
 * PERCHE' NON BASTA LA LETTURA DI SOPRA. Li' la vinta viaggia insieme alla
 * consulenza svolta, ed e' la via precisa: stessa trattativa, nessun dubbio su
 * quale appuntamento abbia chiuso. Ma una trattativa creata direttamente in
 * fase Vinta non ha nessuna consulenza svolta - non essendoci passaggi di fase,
 * non c'e' niente che risponda ai criteri - e quella vendita restava invisibile
 * all'agenda.
 *
 * Succede quando l'advisor registra la vendita di getto a fine call, creando la
 * trattativa gia' chiusa: visto oggi su una consulenza delle 10:00, un'ora di
 * registrazione e una vendita alle 11:26, e in agenda niente di niente.
 */
async function venditeDeiContatti(dalle: number, alle: number): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  const r = await getDb().query<{ id: string; ts: string }>(
    `SELECT COALESCE(a.nuovo_id, t.contact_id) AS id, t.vinta_ts AS ts
       FROM trattativa t
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND t.vinta_ts >= $1::timestamptz
        AND t.vinta_ts <  $2::timestamptz`,
    [
      new Date(dalle - FINESTRA_ESITI_MS).toISOString(),
      new Date(alle + FINESTRA_ESITI_MS).toISOString()
    ]
  );
  for (const x of r.rows) {
    const id = Number(x.id);
    const t = new Date(x.ts).getTime();
    if (!Number.isFinite(id) || !Number.isFinite(t)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(t);
  }
  return out;
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
/**
 * Chi c'era in call, per riunione.
 *
 * L'ESITO VALE SOLO NEL GIORNO IN CUI LA CALL E' AVVENUTA. La riga e' legata
 * alla riunione, e una riunione si sposta: quella del 15 ripianificata al 17 si
 * portava dietro il suo "cliente presente", e la card del 17 - un appuntamento
 * che deve ancora tenersi - risultava gia' svolta. Con `call_ts` si sa quando
 * la call e' stata fatta davvero, e fuori da quel giorno l'esito non si applica.
 *
 * E LA TRASCRIZIONE SEGUE LA STESSA REGOLA. Una registrazione appartiene al
 * giorno in cui e' stata fatta: mostrarla anche sulla card dell'appuntamento
 * ripianificato farebbe sembrare gia' registrata una consulenza che deve
 * ancora tenersi.
 */
async function presenzeDelleRiunioni(
  ids: string[],
  dalle: number,
  alle: number
): Promise<Map<string, { esito: string; trascrizione: string; nelGiorno: boolean }>> {
  if (!ids.length) return new Map();
  const r = await getDb().query(
    `SELECT riunione_id, esito, trascrizione, call_ts, inizio_ts
       FROM presenza_call WHERE riunione_id = ANY($1::text[])`,
    [ids]
  );
  return new Map(
    r.rows.map(
      (x: {
        riunione_id: string;
        esito: string;
        trascrizione: string;
        call_ts: Date | null;
        inizio_ts: Date | null;
      }) => {
        // Quando la call e' avvenuta. Le righe scritte prima che esistesse
        // call_ts non ce l'hanno: per quelle vale l'orario dell'appuntamento,
        // che e' il valore giusto in tutti i casi tranne i pochi in cui la
        // consulenza e' stata tenuta in un altro giorno.
        const quando = (x.call_ts ?? x.inizio_ts)?.getTime();
        const nelGiorno = quando !== undefined && quando >= dalle && quando < alle;
        return [
          String(x.riunione_id),
          {
            esito: nelGiorno ? String(x.esito) : "",
            trascrizione: nelGiorno ? String(x.trascrizione ?? "") : "",
            nelGiorno
          }
        ];
      }
    )
  );
}

/** Quanto si legge dal database attorno al giorno guardato. Larga: serve solo
 *  ad avere in mano gli eventi, la scelta di quale vale la fa esitoPiuVicino(). */
const FINESTRA_ESITI_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Quanto puo' tardare l'advisor a segnare l'esito.
 *
 * La sera stessa o la mattina dopo, quando passa a confermare gli esiti
 * spostando di fase le trattative. Tre giorni coprono anche il fine settimana.
 *
 * Indietro invece non si guarda affatto: una diserzione precedente al giorno
 * dell'appuntamento e' di un appuntamento precedente. Un limite all'indietro
 * c'era - prima quattordici giorni - e non bastava comunque: cinque card di un
 * giorno solo risultavano annullate per diserzioni vecchie da due a sei giorni,
 * tutte appartenenti ad altri appuntamenti.
 */
const ESITO_MAX_DOPO_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Le diserzioni dei contatti di giornata, CON LA LORO DATA.
 *
 * Prima si restituiva un semplice elenco di contatti con un no show nel giorno
 * guardato, e bastava perche' lo stato era uno solo. Ora servono le date: la
 * differenza fra una fascia sprecata e una andata a buon fine sta proprio nel
 * quando la diserzione e' stata segnata rispetto al giorno dell'appuntamento.
 *
 * La finestra e' larga anche perche' cosi' si vedono le disdette anticipate,
 * che prima sfuggivano del tutto: segnate giorni prima, non cadevano nel
 * giorno guardato e la card restava azzurra come se l'appuntamento fosse
 * ancora da fare.
 */
async function diserzioniDeiContatti(dalle: number, alle: number): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  const r = await getDb().query<{ id: string; ts: string }>(
    `SELECT COALESCE(a.nuovo_id, t.contact_id) AS id, n.ts
       FROM no_show n
       JOIN trattativa t ON t.deal_id = n.deal_id
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND n.ts >= $1::timestamptz
        AND n.ts <  $2::timestamptz`,
    [
      new Date(dalle - FINESTRA_ESITI_MS).toISOString(),
      new Date(alle + FINESTRA_ESITI_MS).toISOString()
    ]
  );
  for (const x of r.rows) {
    const id = Number(x.id);
    if (!Number.isFinite(id)) continue;
    const t = new Date(x.ts).getTime();
    if (!Number.isFinite(t)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(t);
  }
  return out;
}

/** Il giorno di Roma di un istante, come "AAAA-MM-GG". */
function giornoRoma(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
}

/**
 * L'esito che appartiene a QUESTO appuntamento, fra quelli del cliente.
 *
 * Vale sia per le consulenze svolte sia per le diserzioni: sono due elenchi di
 * istanti - il momento in cui l'advisor ha spostato di fase la trattativa - e
 * la domanda e' la stessa, a quale fascia si riferiscono. Restituisce l'istante
 * scelto e non un esito, cosi' chi chiama puo' confrontare i due e tenere
 * quello piu' vicino all'appuntamento.
 *
 * SOLO LE DISERZIONI DAL SUO GIORNO IN POI. Una segnata prima appartiene a un
 * appuntamento PRECEDENTE dello stesso cliente, non a questo: verificato caso
 * per caso su tutte quelle di settembre - Rosangela Rizzi ha due riunioni, la
 * prima rinominata "DISDETTO" e la seconda ripianificata, e la diserzione e'
 * della prima; Ketty Celante lo stesso; e sugli altri la riunione precedente
 * non esiste piu' ma la diserzione e' li' a dire che c'era.
 *
 * Quando il cliente disdice il giorno stesso vale comunque No Show: la fascia
 * era occupata e non si riempie piu'. La disdetta con anticipo invece non
 * arriva fin qui: cancella l'evento, e con esso la riunione.
 *
 * Fra piu' eventi si prende il PIU' VICINO: un cliente che diserta, viene
 * ripianificato e diserta di nuovo ha due istanti, e ciascuna card prende il suo.
 */
function esitoPiuVicino(eventi: number[], inizioAppuntamento: number): number | null {
  if (!eventi.length || !Number.isFinite(inizioAppuntamento)) return null;

  // Dalla mezzanotte del giorno dell'appuntamento in poi. Prima di allora
  // l'esito non puo' riguardare questa fascia.
  const giorno = giornoRoma(inizioAppuntamento);
  const vicini = eventi.filter(
    (t) => giornoRoma(t) >= giorno && t <= inizioAppuntamento + ESITO_MAX_DOPO_MS
  );
  if (!vicini.length) return null;

  return vicini.reduce((x, y) =>
    Math.abs(y - inizioAppuntamento) < Math.abs(x - inizioAppuntamento) ? y : x
  );
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
 * ANCHE SU OGGI, e su oggi conta piu' che altrove. Un advisor che riaggancia e
 * ripianifica subito fa sparire dall'agenda di giornata una call appena tenuta:
 * visto il 16 settembre, riunione delle 10:00 spostata alle 10:44 dopo una call
 * di quarantotto minuti, e la colonna dell'advisor tornata vuota mentre lui
 * aveva appena lavorato. E' la vista che si guarda tutto il giorno, quindi e'
 * li' che il buco si nota.
 *
 * Su oggi costa anche meno: il filtro sulla data di modifica prende solo le
 * riunioni toccate dalla mezzanotte, che sono poche. Sul FUTURO invece non
 * gira: una fascia che deve ancora cominciare non puo' essere stata occupata.
 *
 * Le fasce non ancora iniziate restano fuori da sole, senza bisogno di un
 * controllo apposta: si recupera solo cio' che e' stato spostato DOPO l'inizio,
 * e una fascia futura quell'istante non l'ha ancora raggiunto.
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

/**
 * Le consulenze SVOLTE in questo giorno il cui appuntamento sta altrove.
 *
 * `presenza_call.call_ts` dice quando la registrazione e' avvenuta, mentre
 * `inizio_ts` porta l'orario dell'appuntamento. Quando i due cadono in giorni
 * diversi vuol dire che la consulenza e' stata rimandata senza spostare la data
 * in calendario - l'advisor e il cliente si risentono giorni dopo nella stessa
 * stanza - e il giorno in cui si e' lavorato davvero resterebbe vuoto.
 *
 * Misurato su settembre: tre casi, uno da 87 minuti.
 */
async function callDiAltriGiorni(
  dalle: number,
  alle: number
): Promise<Map<string, { inizio: number; fine: number; appuntamento: number }>> {
  const out = new Map<string, { inizio: number; fine: number; appuntamento: number }>();
  const { rows } = await getDb().query<{
    riunione_id: string;
    call_ts: string;
    inizio_ts: string;
    durata_min: string | null;
  }>(
    `SELECT riunione_id::text AS riunione_id, call_ts, inizio_ts, durata_min::text AS durata_min
       FROM presenza_call
      WHERE call_ts >= $1::timestamptz
        AND call_ts <  $2::timestamptz
        AND (inizio_ts < $1::timestamptz OR inizio_ts >= $2::timestamptz)`,
    [new Date(dalle).toISOString(), new Date(alle).toISOString()]
  );
  for (const r of rows) {
    const inizio = new Date(r.call_ts).getTime();
    const appuntamento = new Date(r.inizio_ts).getTime();
    if (!Number.isFinite(inizio) || !Number.isFinite(appuntamento)) continue;
    const durata = Number(r.durata_min);
    out.set(String(r.riunione_id), {
      inizio,
      fine: inizio + (Number.isFinite(durata) && durata > 0 ? durata : 30) * 60 * 1000,
      appuntamento
    });
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
    const promessaSpostate = dalle <= Date.now()
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

    // LE CONSULENZE TENUTE OGGI CON L'APPUNTAMENTO ALTROVE. Stessa idea delle
    // ripianificate, ma il segnale e' diverso: li' lo dice la cronologia
    // dell'orario, qui lo dice la registrazione. Vedi callDiAltriGiorni().
    const altrove = await callDiAltriGiorni(dalle, alle).catch((err) => {
      console.error("[advisor-agenda] call di altri giorni", err instanceof Error ? err.message : err);
      return new Map<string, { inizio: number; fine: number; appuntamento: number }>();
    });

    if (altrove.size) {
      const gia = new Set(grezzi.map((r) => r.id));
      const daLeggere = [...altrove.keys()].filter((id) => !gia.has(id));
      for (let i = 0; i < daLeggere.length; i += 50) {
        const res2 = await fetch(`${HUBSPOT_API}/crm/v3/objects/meetings/batch/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            properties: [
              "hs_meeting_title",
              "hs_meeting_start_time",
              "hs_meeting_end_time",
              "hubspot_owner_id",
              "hs_meeting_outcome",
              "hs_createdate"
            ],
            inputs: daLeggere.slice(i, i + 50).map((id) => ({ id }))
          })
        });
        if (!res2.ok) break;
        const d2 = await res2.json();
        for (const r of d2.results ?? []) {
          const q = altrove.get(String(r.id));
          if (!q) continue;
          grezzi.push({
            id: String(r.id),
            properties: {
              ...(r.properties ?? {}),
              // L'orario della CALL, non quello dell'appuntamento: la card va
              // nella fascia in cui la persona ha lavorato.
              hs_meeting_start_time: new Date(q.inizio).toISOString(),
              hs_meeting_end_time: new Date(q.fine).toISOString()
            }
          });
        }
      }
    }

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
    const [contatti, svolte, disertati, vendite, esitiFase, etichette, presenze] = await Promise.all([
      contattiDeiMeeting(token, grezzi.map((r) => r.id)).catch((err) => {
        console.error("[advisor-agenda] associazioni", err instanceof Error ? err.message : err);
        return new Map<string, number[]>();
      }),
      consulenzeDeiContatti(dalle, alle).catch((err) => {
        console.error("[advisor-agenda] consulenze", err instanceof Error ? err.message : err);
        return new Map<number, Consulenza[]>();
      }),
      diserzioniDeiContatti(dalle, alle).catch((err) => {
        console.error("[advisor-agenda] no show", err instanceof Error ? err.message : err);
        return new Map<number, number[]>();
      }),
      venditeDeiContatti(dalle, alle).catch((err) => {
        console.error("[advisor-agenda] vendite", err instanceof Error ? err.message : err);
        return new Map<number, number[]>();
      }),
      esitiDelGiorno(dalle, alle).catch((err) => {
        console.error("[advisor-agenda] esiti del giorno", err instanceof Error ? err.message : err);
        return new Map<number, Array<{ ts: number; fase: string; motivo: string }>>();
      }),
      etichetteDelleFasi(token).catch((err) => {
        console.error("[advisor-agenda] fasi della pipeline", err instanceof Error ? err.message : err);
        return new Map<string, string>();
      }),
      presenzeDelleRiunioni(grezzi.map((r) => r.id), dalle, alle).catch((err) => {
        console.error("[advisor-agenda] presenze", err instanceof Error ? err.message : err);
        return new Map<string, { esito: string; trascrizione: string; nelGiorno: boolean }>();
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
    const [analisi, trascrizioni, pratiche] = await Promise.all([
      analisiDeiContatti(token, diGiornata, giorno).catch((err) => {
        console.error("[advisor-agenda] analisi call", err instanceof Error ? err.message : err);
        return new Map<number, AnalisiCall>();
      }),
      trascrizioniDeiContatti(token, diGiornata).catch((err) => {
        console.error("[advisor-agenda] trascrizioni", err instanceof Error ? err.message : err);
        return new Map<number, { id: string; appuntamento: number }>();
      }),
      praticheDeiContatti(diGiornata).catch((err) => {
        console.error("[advisor-agenda] pratiche", err instanceof Error ? err.message : err);
        return new Map<number, Array<{ fase: string; motivo: string; creata: number; quando: number }>>();
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

      // GLI ESITI SEGNATI DALL'ADVISOR, CIASCUNO CON IL SUO ISTANTE.
      //
      // SOLO SE LA FASCIA E' GIA' COMINCIATA. Un appuntamento che deve ancora
      // tenersi non puo' essere ne' svolto ne' disertato, e senza questo
      // controllo si prende l'esito di un appuntamento PRECEDENTE dello stesso
      // contatto: visto un caso disertato la mattina e ripianificato al giorno
      // dopo, che faceva risultare gia' chiusa anche la card nuova.
      const inizioSlot = Date.parse(p.hs_meeting_start_time ?? "");
      const cominciata = Number.isFinite(inizioSlot) && inizioSlot <= Date.now();
      const sueConsulenze = cominciata ? suoiContatti.flatMap((c) => svolte.get(c) ?? []) : [];
      const tsSvolta = esitoPiuVicino(sueConsulenze.map((x) => x.svolta), inizioSlot);

      // LA VENDITA, PER DUE VIE.
      //
      // La prima e' precisa: segue la consulenza scelta per questa fascia, cioe'
      // la sua stessa trattativa. Un cliente con due appuntamenti ha due
      // trattative, e la vinta appartiene a quella che ha chiuso.
      //
      // La seconda serve a chi la trattativa l'ha creata gia' vinta, senza
      // passaggi di fase: li' non c'e' nessuna consulenza svolta a cui
      // agganciarsi, e la vendita si accosta all'appuntamento con la stessa
      // regola degli altri esiti - dal suo giorno in poi, entro tre giorni, il
      // piu' vicino. Vale solo dove la fascia e' gia' cominciata.
      const tsVinta =
        (tsSvolta === null ? null : sueConsulenze.find((x) => x.svolta === tsSvolta)?.vinta ?? null) ??
        (cominciata
          ? esitoPiuVicino(suoiContatti.flatMap((c) => vendite.get(c) ?? []), inizioSlot)
          : null);
      const tsDiserzione = cominciata
        ? esitoPiuVicino(suoiContatti.flatMap((c) => disertati.get(c) ?? []), inizioSlot)
        : null;

      // QUANDO IL CLIENTE NE HA DUE vince quello segnato piu' vicino alla
      // fascia. Capita a chi diserta e viene ripianificato: la diserzione e la
      // consulenza esistono tutte e due dentro i tre giorni, e senza confronto
      // la prima card prenderebbe l'esito della seconda.
      // UNA VINTA VALE COME CONSULENZA SVOLTA, perche' lo e' per forza: non si
      // chiude una vendita senza aver parlato col cliente. Quindi se la
      // trattativa non porta la consulenza ma porta la vittoria, e' la vittoria
      // a dire che quella fascia e' stata lavorata.
      const tsChiusura = tsSvolta ?? tsVinta;
      //
      // FRA GIORNI DIVERSI vince il piu' vicino alla fascia - vedi sopra.
      // DENTRO LO STESSO GIORNO vince l'ULTIMO, che e' la correzione: visto il
      // 18 settembre, una consulenza segnata Semina alle 17:35 e corretta in No
      // Show alle 17:44. Col criterio della vicinanza vinceva la prima, perche'
      // le 17:35 distano nove minuti in meno dalle 13:30 della fascia, e la card
      // restava verde mentre l'advisor aveva appena scritto il contrario.
      // Quando un advisor si corregge, l'ultima parola e' quella buona.
      const vinceSvolta =
        tsChiusura !== null &&
        (tsDiserzione === null ||
          (giornoRoma(tsChiusura) === giornoRoma(tsDiserzione)
            ? tsChiusura >= tsDiserzione
            : Math.abs(tsChiusura - inizioSlot) <= Math.abs(tsDiserzione - inizioSlot)));

      if (presenza === "presentato") {
        if (tipo !== "svolta") svolteTrovate += 1;
        tipo = "svolta";
      } else if (vinceSvolta) {
        if (tipo !== "svolta") svolteTrovate += 1;
        tipo = "svolta";
      } else if (presenza === "solo-advisor") {
        // SOLO L'ADVISOR IN CALL E' UN NO SHOW, non un annullamento. Lui c'era
        // e ha aspettato - a volte tredici minuti, e la registrazione lo
        // dimostra - mentre il cliente non si e' presentato. L'annullamento e'
        // un'altra cosa: la fascia liberata in anticipo, senza che nessuno
        // entrasse in stanza.
        //
        // Finche' lo stato grigio era uno solo qui andava bene. Separando
        // gli stati questa riga era rimasta indietro, e faceva risultare
        // annullate proprio le diserzioni di cui abbiamo la prova.
        tipo = "no_show";
      } else if (tsDiserzione !== null) {
        tipo = "no_show";
      } else if (cominciata) {
        // ULTIMA FONTE: la fase della trattativa, se e' cambiata oggi.
        //
        // Ci si arriva solo quando nessun'altra ha detto niente, e prende i casi
        // che le altre non vedono: le fasi che non contano come consulenza
        // svolta - Persa, Semina, Semivinta - e i no show segnati altrove.
        const suoi = suoiContatti.flatMap((c) => esitiFase.get(c) ?? []);
        const giorno = giornoRoma(inizioSlot);
        for (const x of suoi) {
          if (giornoRoma(x.ts) !== giorno) continue;
          const esito = esitoDaFase(etichette.get(x.fase) ?? "", x.motivo);
          if (esito) {
            tipo = esito;
            break;
          }
        }
      }

      const suoi = contatti.get(r.id) ?? [];

      // DOVE STA LA PRATICA, per la scheda che si apre cliccando la card.
      //
      // Un cliente puo' avere piu' trattative: si prende quella NATA INSIEME a
      // questo appuntamento, confrontando le date di creazione. E' lo stesso
      // criterio con cui si stabilisce di chi e' la consulenza quando viene
      // passata a un altro advisor, e regge meglio di "la piu' recente".
      const nascita = Date.parse(p.hs_createdate ?? "");
      const suePratiche = suoi.flatMap((c) => pratiche.get(c) ?? []);
      let scelta: { fase: string; motivo: string; creata: number; quando: number } | null = null;
      for (const x of suePratiche) {
        if (!Number.isFinite(x.creata)) continue;
        if (!scelta || Math.abs(x.creata - nascita) < Math.abs(scelta.creata - nascita)) scelta = x;
      }
      const etichettaFase = scelta ? etichette.get(scelta.fase) ?? "" : "";
      const esitoDellaPratica = etichettaFase
        ? scelta?.motivo
          ? `${etichettaFase} (${scelta.motivo})`
          : etichettaFase
        : "";

      // LA PERDITA VALE DA QUESTA CONSULENZA IN POI, come la vittoria: una
      // trattativa gia' persa prima non riguarda una fascia che doveva ancora
      // tenersi, e tingerla di rosa direbbe che quella consulenza e' andata
      // male quando non c'era ancora stata.
      const persa =
        etichettaFase.trim().toLowerCase() === "persa" &&
        Number.isFinite(scelta?.quando as number) &&
        (scelta as { quando: number }).quando >= dalle;

      // L'ANALISI SOLO SU UNA CARD CHE RACCONTA QUALCOSA DI SUCCESSO.
      //
      // Arriva dall'oggetto Appuntamento di HubSpot, scelto per la data scritta
      // nel nome, e quella data non sempre corrisponde a una call. Visto il 18
      // settembre: una consulenza del 16 ripianificata prima al 18 e poi al 22,
      // con un record di analisi creato stamattina alle 09:05 intestato al 18 -
      // giorno in cui non si e' tenuto niente. La card era azzurra, senza
      // registrazione ne' trascrizione, e portava dentro la valutazione di una
      // call di due giorni prima.
      //
      // Registrazione e trascrizione questa protezione ce l'hanno gia': valgono
      // solo nel giorno in cui la call e' avvenuta. Su una fascia ancora da
      // tenersi non c'e' niente da analizzare, e l'analisi si tace.
      const analisiSua =
        tipo === "appuntamento" ? undefined : suoi.map((c) => analisi.get(c)).find(Boolean);
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
      // IL RIPIEGO SUL CONTATTO VALE SOLO PER LE FASCE GIA' PASSATE. Sul
      // contatto c'e' l'ultima registrazione fatta, senza distinzione di
      // giorno: su un appuntamento che deve ancora tenersi mostrerebbe la
      // registrazione di quello precedente, e la card sembrerebbe gia' svolta.
      const inizioSlotPassato =
        Number.isFinite(Date.parse(p.hs_meeting_start_time ?? "")) &&
        Date.parse(p.hs_meeting_start_time ?? "") <= Date.now();

      // QUANDO SAPPIAMO GIA' DOV'E' LA REGISTRAZIONE, il contatto non si guarda.
      // La sua proprieta' porta l'ULTIMA registrazione fatta, con la data
      // dell'appuntamento a cui appartiene: su una riunione che ha una riga di
      // presenza sappiamo gia' in che giorno la call e' avvenuta, e se non e'
      // questo la registrazione non va mostrata qui. Senza questo controllo la
      // consulenza tenuta il 15 ricompariva sulla card del 12, che e' proprio
      // il giorno in cui il cliente non si e' presentato.
      const suaPresenza = presenze.get(r.id);
      const idTrascrizioneSua = suaPresenza
        ? suaPresenza.nelGiorno
          ? suaPresenza.trascrizione || undefined
          : undefined
        : inizioSlotPassato
          ? suoi
              .map((c) => trascrizioni.get(c))
              .find(
                (t): t is { id: string; appuntamento: number } =>
                  Boolean(t) &&
                  // La registrazione deve appartenere a QUESTO appuntamento.
                  // Il campo del contatto porta l'ultima fatta: senza questo
                  // controllo la consulenza del 16 ricompariva sulla card del
                  // 12 dello stesso cliente, che quel giorno non si era
                  // presentato.
                  Math.abs((t as { appuntamento: number }).appuntamento -
                    Date.parse(p.hs_meeting_start_time ?? "")) < 60 * 60 * 1000
              )?.id
          : undefined;

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
        ...(altrove.has(r.id)
          ? {
              appuntamentoDel: new Date(altrove.get(r.id)!.appuntamento).toLocaleDateString("it-IT", {
                timeZone: "Europe/Rome",
                day: "2-digit",
                month: "2-digit"
              })
            }
          : {}),
        ...(spostate.has(r.id)
          ? {
              ripianificata: new Date(spostate.get(r.id)!.nuovoInizio).toLocaleDateString("it-IT", {
                timeZone: "Europe/Rome",
                day: "2-digit",
                month: "2-digit"
              })
            }
          : {}),
        ...(esitoDellaPratica ? { esito: esitoDellaPratica } : {}),
        ...(persa ? { persa: true as const } : {}),
        ...(tipo === "svolta" && tsVinta !== null
          ? {
              vinta: new Date(tsVinta).toLocaleDateString("it-IT", {
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

    // LE CONSULENZE CHE SUL CRM NON ESISTONO, lette dalla banca dati.
    //
    // Si aggiungono qui, alla fine, perche' serve sapere cosa e' gia' in
    // agenda: se la riunione mancante e' stata creata nel frattempo, la card
    // vera porta lo stesso cliente e questa si toglie di mezzo.
    const fantasma = await cardDaRegistrazioni(token, dalle, alle, proprietari).catch((err) => {
      console.error("[advisor-agenda] card da registrazioni", err instanceof Error ? err.message : err);
      return [] as Array<{ evento: EventoAgenda; idTrascrizione: string; contatto: number | null; vinta: number | null }>;
    });

    // NIENTE DOPPIONI, MA SUL NOME DEL CLIENTE, non sull'orario.
    //
    // Appena qualcuno crea la riunione mancante - succede spesso poche ore dopo
    // - la card vera compare, e questa resterebbe accanto a raccontare la
    // stessa call due volte. A dire che si tratta della stessa cosa e' il
    // cliente: stessa persona, stesso advisor, stesso giorno.
    //
    // PRIMA IL CONFRONTO ERA SUGLI ORARI, e sbagliava per eccesso: bastava
    // un'altra card sovrapposta - un appuntamento ricevuto da un collega,
    // magari disertato - perche' la consulenza vera sparisse. E' esattamente
    // il caso che ha fatto nascere questa funzione.
    const giaInAgenda = (chi: string, cliente: string): boolean =>
      eventi.some((e) => e.operatore === chi && chiaveNome(e.titolo) === chiaveNome(cliente));

    for (const f of fantasma) {
      if (giaInAgenda(f.evento.operatore, f.evento.titolo)) continue;
      // La vendita, se il contatto si e' riconosciuto: stessa regola delle
      // altre card, dal giorno dell'appuntamento in poi ed entro tre giorni.
      const inizio = dalle + f.evento.inizioMin * 60 * 1000;
      const suaVinta =
        f.vinta ?? (f.contatto === null ? null : esitoPiuVicino(vendite.get(f.contatto) ?? [], inizio));
      if (suaVinta !== null) {
        f.evento.vinta = new Date(suaVinta).toLocaleDateString("it-IT", {
          timeZone: "Europe/Rome",
          day: "2-digit",
          month: "2-digit"
        });
      }
      eventi.push(f.evento);
      idDiEvento.push(f.idTrascrizione);
    }

    // GLI APPUNTAMENTI CHE STANNO SOLO SULLA TRATTATIVA. Stessa regola dei
    // doppioni: se quel cliente e' gia' in agenda oggi, la riunione e' stata
    // spostata davvero e questa card non serve.
    const soloCrm = await appuntamentiSoloSulCrm(token, dalle, alle, proprietari).catch((err) => {
      console.error("[advisor-agenda] appuntamenti solo su CRM", err instanceof Error ? err.message : err);
      return [] as EventoAgenda[];
    });
    // DENTRO LA GIORNATA VINCE LA RIUNIONE, FUORI VINCE LA TRATTATIVA.
    //
    // Spostare l'appuntamento trascinando la card su Google e' il gesto
    // naturale - la riunione su HubSpot si adegua da sola - mentre spostare
    // anche la fase della trattativa e' un passaggio in piu'. Quindi se quel
    // cliente quel giorno una riunione ce l'ha, anche a un'ora diversa, quella
    // e' la verita' e la trattativa e' rimasta indietro di qualche ora.
    //
    // Se invece in giornata non c'e' niente, vince la trattativa: la sera
    // l'advisor e' obbligato a mettere l'esito, e per una ripianificata quella
    // data e' una scelta deliberata, non una dimenticanza.
    //
    // Si guarda il CLIENTE, non la coppia cliente-advisor: un appuntamento
    // passato a un collega resta lo stesso appuntamento.
    const clienteGiaInAgenda = (cliente: string): boolean =>
      eventi.some((e) => chiaveNome(e.titolo) === chiaveNome(cliente));

    for (const e of soloCrm) {
      if (clienteGiaInAgenda(e.titolo)) continue;
      eventi.push(e);
      idDiEvento.push(undefined);
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
      // Se la registrazione e' stata cancellata si toglie anche il pulsante
      // della trascrizione: meglio una card senza bottoni che un bottone che
      // porta a una pagina inesistente.
      if (d?.sparita) {
        delete e.trascrizione;
        return;
      }
      if (d?.audio) e.audio = d.audio;
      if (d?.durataMin) e.durataMin = d.durataMin;
    });

    eventi.sort((x, y) => x.inizioMin - y.inizioMin);
    console.log(
      `[advisor-agenda] ${giorno}: ${eventi.length} eventi, ${new Set(eventi.map((e) => e.operatore)).size} persone, ` +
        `${eventi.filter((e) => e.tipo === "svolta").length} svolte (${svolteTrovate} dalle trattative), ` +
        `${eventi.filter((e) => e.tipo === "no_show").length} no show, ` +

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
