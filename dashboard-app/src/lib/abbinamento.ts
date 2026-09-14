// Abbina le registrazioni di Fireflies agli appuntamenti di HubSpot.
//
// PERCHE' NON BASTA L'ORARIO. Fireflies comincia a registrare quando l'advisor
// apre la stanza, HubSpot ha l'orario prenotato su una griglia di mezz'ore, e i
// due non coincidono quasi mai: misurato su tre mesi e mezzo, si entra in
// anticipo nel 43% dei casi e in ritardo nel 57%, con una mediana di +5 minuti
// e code che arrivano a mezz'ora da entrambe le parti. Cercare l'uguaglianza
// esatta di un orario arrotondato - come faceva il flusso Zapier - ne trovava
// il 57%.
//
// COSA SI USA AL POSTO DELL'ORARIO. Dentro una stanza, in un giorno, la
// sequenza delle registrazioni e' la stessa sequenza degli appuntamenti: si
// abbinano in ordine, senza incroci, scegliendo la combinazione che massimizza
// la sovrapposizione complessiva fra gli intervalli.
//
// PERCHE' LA SOVRAPPOSIZIONE E NON LA VICINANZA DELL'INIZIO. Un advisor apre la
// stanza anche per prove tecniche, e quelle aperture da uno o due minuti
// occupano uno slot e spostano a cascata tutti gli abbinamenti successivi.
// Misurato: aggiungendo le aperture spurie, il criterio della vicinanza passa da
// 497 a 667 abbinamenti (177 dei quali sbagliati), mentre quello della
// sovrapposizione resta identico a 446. E' immune per costruzione, perche' una
// stanza aperta due minuti non copre abbastanza dello slot.
//
// L'ORARIO DI FINE DELL'APPUNTAMENTO NON E' PRESO ALLA LETTERA: una consulenza
// puo' protrarsi ben oltre. La sovrapposizione si rapporta all'intervallo piu'
// corto dei due, quindi chi sfora non viene penalizzato. Verificato: ignorando
// del tutto la fine e assumendo blocchi fissi di 30, 45 o 60 minuti il
// risultato oscilla fra 432 e 451 abbinamenti, cioe' il 2%.

/** Una registrazione di Fireflies. Gli istanti sono millisecondi epoch. */
export type Registrazione = {
  id: string;
  /** Codice della stanza Meet, es. "jth-hhtk-jmn". */
  stanza: string;
  inizio: number;
  /** Durata in minuti, come la fornisce Fireflies. */
  durataMin: number;
  /** I nomi che Fireflies scrive fra doppi asterischi negli action items. */
  nomi?: string[];
  /** Le frasi con il loro istante, in secondi dall'inizio della registrazione.
   *  Servono a capire dove finisce una consulenza e comincia la successiva, e
   *  con il nome di chi parla anche a stabilire se il cliente si e' presentato
   *  (vedi chiEraInCall). Il nome puo' mancare. */
  frasi?: Array<{ inizioSec: number; fineSec: number; testo: string; voce?: string }>;
};

/** Un appuntamento di HubSpot, gia' arricchito con l'advisor effettivo. */
export type Riunione = {
  id: string;
  stanza: string;
  inizio: number;
  fine: number;
  /** Proprietario della riunione: l'advisor a cui era stata prenotata. */
  advisorPrenotato: string;
  /**
   * Proprietario della TRATTATIVA nata da questa riunione.
   *
   * Quando un appuntamento viene passato a un altro advisor, il nuovo
   * proprietario viene scritto a mano sulla trattativa mentre la riunione resta
   * intestata all'originale: la discordanza fra i due e' quindi la firma del
   * passaggio. Si usa la trattativa e non il contatto perche' la trattativa
   * nasce da questo appuntamento e non cambia piu', mentre il proprietario del
   * contatto si muove anche per riassegnazioni commerciali successive che con
   * la call non c'entrano - misurato, 8% di discordanza contro 21%.
   */
  advisorEffettivo: string;
  contattoId?: string;
  contattoNome?: string;
  /**
   * La consulenza risulta effettivamente svolta (trattativa.svolta_ts).
   *
   * Serve solo al criterio "piu-slot": una registrazione lunga che sfora
   * sull'orario successivo puo' contenere due consulenze oppure una sola,
   * finita tardi, che si sovrappone a uno slot in cui il cliente non si e'
   * presentato. Dagli orari i due casi sono identici; qui si distinguono.
   */
  svolta?: boolean;
};

export type Criterio = "sovrapposizione" | "piu-slot" | "nome" | "overbooking";

export type Abbinamento = {
  registrazione: Registrazione;
  riunione: Riunione;
  criterio: Criterio;
  /** Minuti fra l'inizio della registrazione e quello dell'appuntamento. */
  scartoMin: number;
  /** Minuti in comune fra i due intervalli. */
  sovrapposizioneMin: number;
  /**
   * La porzione di registrazione che appartiene a questo appuntamento, in
   * secondi dall'inizio. Coincide con tutta la registrazione tranne quando una
   * sola registrazione contiene due consulenze: li' ognuno riceve la sua parte,
   * altrimenti chi legge la scheda si trova un altro cliente a meta' testo.
   */
  daSec: number;
  aSec: number;
};

export type Impostazioni = {
  /** Minuti minimi in comune perche' una coppia sia presa in considerazione. */
  sovrapposizioneMinima: number;
  /** Finestra entro cui cercare la riunione di un altro advisor, in minuti. */
  finestraOverbooking: number;
  /** Somiglianza minima fra un nome degli action items e quello del contatto. */
  somiglianzaMinima: number;
  /** Distacco minimo fra il primo e il secondo candidato, per non tirare a caso. */
  margineMinimo: number;
};

export const IMPOSTAZIONI: Impostazioni = {
  // Dieci minuti e non cinque: a cinque restano abbinate 70 registrazioni sotto
  // i dieci minuti, che sono in larga parte prove tecniche; a dieci sono zero.
  // Costa 72 abbinamenti sui 446, ma attaccare la trascrizione di un cliente
  // alla scheda di un altro e' un danno, non trovarla e' solo un'occasione persa.
  sovrapposizioneMinima: 10,
  finestraOverbooking: 30,
  somiglianzaMinima: 0.7,
  margineMinimo: 0.12
};

const MIN = 60_000;

/** Il giorno di Roma di un istante, come "2026-09-12". */
export function giornoRoma(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
}

const fineDi = (r: Registrazione) => r.inizio + r.durataMin * MIN;

/** Minuti in comune fra due intervalli, zero se non si toccano. */
function comune(r: Registrazione, m: Riunione): number {
  const ov = Math.min(fineDi(r), m.fine) - Math.max(r.inizio, m.inizio);
  return ov > 0 ? ov / MIN : 0;
}

/**
 * Quanto una coppia e' credibile, da 0 (perfetta) a 60 (si sfiorano appena).
 * `null` quando i due non hanno abbastanza tempo in comune per essere la stessa
 * cosa.
 */
function costo(r: Registrazione, m: Riunione, imp: Impostazioni): number | null {
  const ov = comune(r, m);
  if (ov < imp.sovrapposizioneMinima) return null;
  const piuCorto = Math.min(fineDi(r) - r.inizio, m.fine - m.inizio) / MIN;
  if (piuCorto <= 0) return null;
  return (1 - Math.min(1, ov / piuCorto)) * 60;
}

/**
 * Abbina due sequenze ordinate senza incroci, minimizzando il costo totale.
 *
 * SENZA INCROCI e' la parte che conta: se la seconda registrazione della
 * giornata finisse sul primo appuntamento si romperebbe l'ordine dei fatti, e
 * un errore del genere si propaga a tutta la giornata. Saltare un elemento -
 * un appuntamento disertato, una registrazione che non c'entra - costa una
 * penale fissa, quindi viene preferito solo quando l'alternativa e' un
 * abbinamento peggiore di cosi'.
 */
function allinea(
  reg: Registrazione[],
  riu: Riunione[],
  imp: Impostazioni,
  penale = 45
): Array<[Registrazione, Riunione]> {
  const n = reg.length;
  const m = riu.length;
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const scelta: string[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(""));
  dp[0][0] = 0;

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      if (i > 0 && dp[i - 1][j] + penale < dp[i][j]) {
        dp[i][j] = dp[i - 1][j] + penale;
        scelta[i][j] = "salta-registrazione";
      }
      if (j > 0 && dp[i][j - 1] + penale < dp[i][j]) {
        dp[i][j] = dp[i][j - 1] + penale;
        scelta[i][j] = "salta-riunione";
      }
      if (i > 0 && j > 0) {
        const c = costo(reg[i - 1], riu[j - 1], imp);
        if (c !== null && dp[i - 1][j - 1] + c < dp[i][j]) {
          dp[i][j] = dp[i - 1][j - 1] + c;
          scelta[i][j] = "abbina";
        }
      }
    }
  }

  const coppie: Array<[Registrazione, Riunione]> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const s = scelta[i][j];
    if (s === "abbina") {
      coppie.push([reg[i - 1], riu[j - 1]]);
      i--;
      j--;
    } else if (s === "salta-registrazione") i--;
    else j--;
  }
  return coppie.reverse();
}

/** Minuscolo, senza punteggiatura, spazi normalizzati: per confrontare nomi. */
function ripulisci(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const riga = new Array(a.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= b.length; i++) {
    let precedente = riga[0];
    riga[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const temp = riga[j];
      riga[j] = Math.min(
        riga[j] + 1,
        riga[j - 1] + 1,
        precedente + (a[j - 1] === b[i - 1] ? 0 : 1)
      );
      precedente = temp;
    }
  }
  return riga[a.length];
}

/**
 * Quanto due nomi si somigliano, da 0 a 1.
 *
 * SI CONFRONTA ANCHE CON I PEZZI, non solo con il nome intero: Fireflies negli
 * action items scrive spesso solo il nome di battesimo, e "giuseppe" contro
 * "giuseppe dangelo" da' 0,50 - sotto qualunque soglia ragionevole. Confrontando
 * anche nome e cognome presi da soli quel caso torna a 1. La distanza di
 * Levenshtein resta necessaria perche' l'AI storpia i nomi: "marvin
 * alessandri", "domenico prima", "marvino alessandrini".
 */
export function somiglianza(a: string, b: string): number {
  const x = ripulisci(a);
  const y = ripulisci(b);
  if (!x || !y) return 0;
  const pezzi = [y, ...y.split(" ")];
  let migliore = 0;
  for (const p of pezzi) {
    if (!p) continue;
    const lungo = Math.max(x.length, p.length);
    const s = lungo === 0 ? 1 : 1 - levenshtein(x, p) / lungo;
    if (s > migliore) migliore = s;
  }
  return migliore;
}

/**
 * Il contatto piu' somigliante ai nomi trovati negli action items.
 *
 * Restituisce null quando il primo non stacca abbastanza il secondo: con due
 * contatti dal nome simile nella stessa giornata, scegliere il primo che supera
 * la soglia significa tirare a sorte. Meglio non abbinare.
 */
function perNome(
  r: Registrazione,
  candidate: Riunione[],
  imp: Impostazioni
): Riunione | null {
  if (!r.nomi?.length) return null;
  const punteggi = candidate.map((m) => ({
    m,
    p: Math.max(0, ...r.nomi!.map((n) => somiglianza(n, m.contattoNome ?? "")))
  }));
  punteggi.sort((a, b) => b.p - a.p);
  const primo = punteggi[0];
  if (!primo || primo.p < imp.somiglianzaMinima) return null;
  const secondo = punteggi[1];
  if (secondo && primo.p - secondo.p < imp.margineMinimo) return null;
  return primo.m;
}

/**
 * Il punto in cui una consulenza lascia il posto alla successiva, in secondi
 * dall'inizio della registrazione.
 *
 * Si parte dall'orario prenotato del secondo appuntamento e, se entro dieci
 * minuti da li' c'e' un silenzio lungo, si taglia sul silenzio: e' il momento
 * in cui un cliente esce e l'altro entra. Misurato su 41 registrazioni che
 * coprono piu' slot, il silenzio c'e' solo nel 15% dei casi - ma quando c'e'
 * cade a scarto mediano zero dal confine previsto, il che conferma che il
 * confine previsto e' comunque un buon stimatore e non un ripiego.
 */
function confineFra(r: Registrazione, secondoInizio: number): number {
  const previsto = (secondoInizio - r.inizio) / 1000;
  if (!r.frasi?.length) return Math.max(0, previsto);
  let migliore: { pausa: number; istante: number } | null = null;
  for (let i = 1; i < r.frasi.length; i++) {
    const pausa = r.frasi[i].inizioSec - r.frasi[i - 1].fineSec;
    const istante = r.frasi[i - 1].fineSec;
    if (pausa >= 45 && Math.abs(istante - previsto) <= 600) {
      if (!migliore || pausa > migliore.pausa) migliore = { pausa, istante };
    }
  }
  return Math.max(0, migliore ? migliore.istante : previsto);
}

/** Il cliente viene nominato dopo il confine? Allora e' entrato davvero. */
function nominatoDopo(r: Registrazione, m: Riunione, confineSec: number): boolean {
  if (!r.frasi?.length || !m.contattoNome) return false;
  // Da due minuti prima del confine: il saluto arriva spesso appena prima.
  const coda = ripulisci(
    r.frasi.filter((f) => f.inizioSec >= confineSec - 120).map((f) => f.testo).join(" ")
  );
  return ripulisci(m.contattoNome)
    .split(" ")
    .filter((p) => p.length >= 4)
    .some((p) => new RegExp(`\\b${p}\\b`).test(coda));
}

function comeAbbinamento(
  r: Registrazione,
  m: Riunione,
  criterio: Criterio,
  daSec = 0,
  aSec = r.durataMin * 60
): Abbinamento {
  return {
    registrazione: r,
    riunione: m,
    criterio,
    scartoMin: Math.round((r.inizio - m.inizio) / MIN),
    sovrapposizioneMin: Math.round(comune(r, m)),
    daSec: Math.round(daSec),
    aSec: Math.round(aSec)
  };
}

/**
 * Abbina tutte le registrazioni agli appuntamenti, con quattro criteri in
 * cascata dal piu' affidabile al meno.
 *
 * Ogni abbinamento porta con se' il criterio che l'ha prodotto: serve a leggere
 * i numeri e a spegnere un criterio che si rivelasse sbagliato senza toccare
 * gli altri.
 */
export function abbina(
  registrazioni: Registrazione[],
  riunioni: Riunione[],
  imp: Impostazioni = IMPOSTAZIONI
): { abbinamenti: Abbinamento[]; registrazioniSenzaRiunione: Registrazione[] } {
  const abbinamenti: Abbinamento[] = [];
  const riunioniUsate = new Set<string>();
  const registrazioniUsate = new Set<string>();

  // Un gruppo per stanza e giornata: e' l'unita' in cui l'ordine dei fatti ha
  // senso. Confrontare registrazioni di stanze diverse non significherebbe
  // niente, e attraverso la mezzanotte nemmeno.
  const chiave = (stanza: string, ms: number) => `${stanza}|${giornoRoma(ms)}`;
  const gruppi = new Map<string, { reg: Registrazione[]; riu: Riunione[] }>();
  const prendi = (k: string) => {
    if (!gruppi.has(k)) gruppi.set(k, { reg: [], riu: [] });
    return gruppi.get(k)!;
  };
  for (const r of registrazioni) prendi(chiave(r.stanza, r.inizio)).reg.push(r);
  for (const m of riunioni) if (m.stanza) prendi(chiave(m.stanza, m.inizio)).riu.push(m);

  for (const gruppo of gruppi.values()) {
    gruppo.reg.sort((a, b) => a.inizio - b.inizio);
    gruppo.riu.sort((a, b) => a.inizio - b.inizio);

    // 1. il grosso: allineamento per sovrapposizione
    for (const [r, m] of allinea(gruppo.reg, gruppo.riu, imp)) {
      abbinamenti.push(comeAbbinamento(r, m, "sovrapposizione"));
      registrazioniUsate.add(r.id);
      riunioniUsate.add(m.id);
    }

    // 2. la registrazione che copre piu' appuntamenti.
    //
    // Succede quando il cliente successivo chiede di entrare e l'advisor lo fa
    // entrare senza chiudere e riaprire la stanza: una sola registrazione
    // contiene due consulenze. Misurato: 41 casi su 575 registrazioni lunghe,
    // il 7%.
    //
    // MA LA SOVRAPPOSIZIONE DA SOLA NON BASTA. Una consulenza che finisce tardi
    // si sovrappone allo slot successivo anche quando quel cliente non si e'
    // presentato, e dagli orari i due casi sono identici. Attribuire lo stesso
    // metterebbe la consulenza di un cliente sulla scheda di un altro. Serve
    // una prova che il secondo sia davvero entrato, e ce ne sono due: la
    // consulenza risulta svolta, oppure il suo nome viene pronunciato dopo il
    // confine. Misurato su 13 casi: la prima ne conferma 5, la seconda 4, e
    // insieme 6 - le altre 7 sono sovrapposizioni su slot vuoti.
    for (const r of gruppo.reg) {
      if (!registrazioniUsate.has(r.id)) continue;
      const secondi = gruppo.riu
        .filter((m) => !riunioniUsate.has(m.id) && comune(r, m) >= imp.sovrapposizioneMinima)
        .sort((a, b) => a.inizio - b.inizio);
      let taglioPrecedente = 0;
      for (const m of secondi) {
        const confine = confineFra(r, m.inizio);
        if (!m.svolta && !nominatoDopo(r, m, confine)) continue;

        // DUE APPUNTAMENTI SULLO STESSO ORARIO NON SI TAGLIANO. Capita che nella
        // stessa fascia ci siano due record - un doppione, oppure due contatti
        // nella stessa consulenza - e li' il confine cadrebbe a zero,
        // riducendo il primo a un segmento vuoto. In quel caso la registrazione
        // appartiene per intero a entrambi.
        const stessaFascia = confine < 5 * 60;
        if (stessaFascia) {
          abbinamenti.push(comeAbbinamento(r, m, "piu-slot"));
          riunioniUsate.add(m.id);
          continue;
        }

        // La parte precedente appartiene a chi l'aveva gia' presa: si accorcia
        // il suo segmento e si assegna il resto a questo appuntamento.
        const precedente = abbinamenti.find(
          (x) => x.registrazione.id === r.id && x.daSec === taglioPrecedente
        );
        if (precedente) precedente.aSec = Math.round(confine);
        abbinamenti.push(comeAbbinamento(r, m, "piu-slot", confine, r.durataMin * 60));
        riunioniUsate.add(m.id);
        taglioPrecedente = Math.round(confine);
      }
    }

    // 3. il nome, solo dentro questa stanza e solo su cio' che e' rimasto fuori.
    //
    // Non e' un criterio autonomo ma uno spareggio: serve quando l'allineamento
    // ha lasciato scoperti sia una registrazione sia un appuntamento, tipico
    // delle giornate in cui i tempi sono slittati troppo perche' gli intervalli
    // si tocchino.
    const regFuori = gruppo.reg.filter((r) => !registrazioniUsate.has(r.id));
    const riuFuori = gruppo.riu.filter((m) => !riunioniUsate.has(m.id));
    for (const r of regFuori) {
      const scelta = perNome(r, riuFuori.filter((m) => !riunioniUsate.has(m.id)), imp);
      if (!scelta) continue;
      abbinamenti.push(comeAbbinamento(r, scelta, "nome"));
      registrazioniUsate.add(r.id);
      riunioniUsate.add(scelta.id);
    }
  }

  // 4. overbooking: la call gestita da un altro advisor, nella SUA stanza.
  //
  // La riunione resta intestata all'advisor originale, ma la trattativa passa a
  // chi la gestisce davvero. Quindi una registrazione rimasta orfana nella
  // stanza di B corrisponde a una riunione intestata ad A la cui trattativa e'
  // di B. E' l'unico criterio che esce dalla stanza, ed esce seguendo un dato
  // esplicito scritto a mano in HubSpot invece che una somiglianza.
  const padroneDi = proprietariDelleStanze(riunioni);
  for (const r of registrazioni) {
    if (registrazioniUsate.has(r.id)) continue;
    // Qui non c'e' il filtro della sovrapposizione a proteggerci, perche' la
    // riunione e' in un'altra stanza e gli intervalli non si confrontano.
    // Senza un minimo di durata si attaccherebbero al contatto anche le
    // aperture di prova da pochi minuti.
    if (r.durataMin < imp.sovrapposizioneMinima) continue;
    const padrone = padroneDi.get(r.stanza);
    if (!padrone) continue;
    const candidate = riunioni.filter(
      (m) =>
        !riunioniUsate.has(m.id) &&
        m.advisorEffettivo === padrone &&
        m.advisorPrenotato !== padrone &&
        Math.abs(m.inizio - r.inizio) <= imp.finestraOverbooking * MIN
    );
    if (candidate.length !== 1) continue; // due candidate: meglio non scegliere
    abbinamenti.push(comeAbbinamento(r, candidate[0], "overbooking"));
    registrazioniUsate.add(r.id);
    riunioniUsate.add(candidate[0].id);
  }

  return {
    abbinamenti: abbinamenti.sort((a, b) => a.registrazione.inizio - b.registrazione.inizio),
    registrazioniSenzaRiunione: registrazioni.filter((r) => !registrazioniUsate.has(r.id))
  };
}

/**
 * Di chi e' ciascuna stanza, dedotto da chi ci tiene piu' riunioni.
 *
 * Si ricava dai dati invece di leggerlo da una tabella perche' le tabelle
 * scritte a mano invecchiano: quella di Zapier aveva la stanza sbagliata per un
 * advisor e mancava per meta' degli altri, e chi cambia stanza esce dal
 * tracciamento senza che nessuno se ne accorga.
 */
export function proprietariDelleStanze(riunioni: Riunione[]): Map<string, string> {
  const conteggi = new Map<string, Map<string, number>>();
  for (const m of riunioni) {
    if (!m.stanza || !m.advisorPrenotato) continue;
    if (!conteggi.has(m.stanza)) conteggi.set(m.stanza, new Map());
    const q = conteggi.get(m.stanza)!;
    q.set(m.advisorPrenotato, (q.get(m.advisorPrenotato) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [stanza, q] of conteggi) {
    const [chi] = [...q.entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(stanza, chi);
  }
  return out;
}
