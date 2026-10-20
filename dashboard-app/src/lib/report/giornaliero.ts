/**
 * Il report del giorno prima: appuntamenti, consulenze, incassi, ICMD.
 *
 * E' LA TRASCRIZIONE DI UN REPORT CHE SI FACEVA A MANO. Le righe, i loro nomi
 * e il loro ordine vengono da li', e non sono stati "migliorati": chi lo legge
 * ogni mattina deve ritrovare quello che cercava, nello stesso posto.
 *
 * TUTTO E' DI IERI, tranne il totale dei biglietti ICMD, che e' il cumulato
 * dell'edizione.
 *
 * LE REGOLE, decise il 16 ottobre 2026 e qui scritte una volta sola:
 *
 *   ht contro icmd      il PRODOTTO del Boom. Contiene "ICMD" -> icmd,
 *                       altrimenti ht. NON la Categoria Prodotto, che e'
 *                       spenta: misurata vuota su 287 Boom su 287 da
 *                       settembre 2026, mentre il Prodotto c'e' sempre. Un
 *                       filtro sulla categoria darebbe zero icmd tutti i
 *                       giorni, e il totale ht li ingoierebbe senza dirlo.
 *
 *   primo appuntamento  la trattativa che non e' MAI passata dalla fase
 *                       Ripianificata. Le ripianificate restano nei totali e
 *                       spariscono solo dal blocco "DA 1 APP".
 *
 *   esiti non registrati  rimaste in "Da Svolgere" a giornata finita: non e'
 *                       un esito, e' un Advisor che non ha spostato la fase.
 *
 *   consulenze di ieri  `data_e_ora_appuntamento`, che e' un istante, con
 *                       ripiego su `data_appuntamento` per il 4% che non ce
 *                       l'ha. NON il contrario: la data secca HubSpot la
 *                       tiene a mezzanotte UTC, e la nostra giornata comincia
 *                       a mezzanotte di Roma. Misurato il 16 ottobre 2026: i
 *                       conteggi dei due campi si scambiano fra un giorno e
 *                       l'altro - 53 e 42 il 15, 42 e 53 il 16 - che e'
 *                       esattamente lo sfasamento di due ore.
 *
 *                       IL GIORNO SI RICALCOLA DAL VALORE, non si lascia
 *                       decidere ai confini della ricerca: si chiede una
 *                       finestra larga un giorno in piu' per lato e poi si
 *                       tiene chi cade davvero nella giornata di Roma. Cosi'
 *                       il fuso lo si attraversa una volta sola, qui.
 */

import { getDb } from "@/lib/db";
import { fetchCsv } from "@/lib/csv";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";

/** La pipeline degli appuntamenti: tutto il report vive qui dentro. */
export const PIPELINE_HT = "433643709";

/** Le fasi che servono, per id. Gli id non cambiano, le etichette si'. */
const FASE = {
  daSvolgere: "665590998",
  semina: "762372819",
  ripianificata: "665590999",
  noShow: "666989041",
  semivinta: "762180829",
  vinta: "665591003",
  rimborso: "762180830",
  cliente: "762180831",
  persa: "665591004",
  archiviata: "1449655500"
} as const;

/**
 * Le fasi che dicono "la consulenza si e' svolta".
 *
 * NON E' L'ELENCO DELLE VINTE: una consulenza svolta e persa resta svolta. Il
 * contrario - contare solo le vinte - farebbe salire lo show up ogni volta che
 * si vende di piu', che e' una misura di un'altra cosa.
 */
const SVOLTE = new Set<string>([
  FASE.semina, FASE.semivinta, FASE.vinta, FASE.rimborso, FASE.cliente, FASE.persa
]);

/** Le tipologie di incasso che contano come una vendita chiusa. */
const CHIUSURE = new Set(["Quota unica", "Acconto"]);

/**
 * I BIGLIETTI ICMD PAGANTI PARTONO DA UN CONTEGGIO A MANO, non da HubSpot.
 *
 * Contandoli dal Boom - prodotto con "ICMD", incasso Quota unica o Acconto,
 * pagamento dall'inizio dell'edizione - il 19 ottobre 2026 venivano 208,
 * mentre il conteggio dell'ufficio era 244. I 36 che mancano non si
 * ricostruiscono da qui: sono biglietti comprati prima della finestra, pagati
 * fuori dal Boom, o regalati e diventati paganti dopo. Un numero che sbaglia
 * di 36 su 244 non serve a nessuno.
 *
 * COSI' SI PARTE DAL NUMERO VERO e si somma solo quello che arriva dopo, che
 * HubSpot conta bene perche' lo vede nascere. La base copre tutto FINO AL
 * GIORNO INDICATO COMPRESO; dal giorno dopo somma il report.
 *
 * QUANDO IL CONTEGGIO SI RIFA' si cambiano queste due righe - oppure
 * REPORT_BIGLIETTI_BASE e REPORT_BIGLIETTI_BASE_AL nell'ambiente, che hanno la
 * precedenza e non richiedono di ripubblicare. Il valore nel codice resta
 * comunque: una variabile che manca in produzione e' il motivo per cui il
 * report non arrivo' per tre mattine.
 */
const BIGLIETTI_BASE = 244;
const BIGLIETTI_BASE_AL = "2026-10-19";

export type Blocco = {
  daSvolgere: number;
  svolti: number;
  noShow: number;
  nonRegistrati: number;
  boomHt: number;
  boomIcmd: number;
};

export type ReportGiornaliero = {
  giorno: string;
  appFixedTotali: number;
  appSetter: number;
  appChatter: number;
  appSenzaSetter: number;
  venditeTelefoniche: number;
  /** Le chiusure che non sono telefoniche: il pezzo che mancava all'appello. */
  altreVendite: number;
  altreVenditeTipi: string[];
  totaleRate: number;
  totaleIncasso: number;
  totali: Blocco;
  primoApp: Blocco;
  icmdAssegnati: number | null;
  icmdChiamate: number | null;
  icmdRisposte: number | null;
  icmdVendite: number;
  fuoriCrm: { persone: number; conTrattativa: number; senza: number };
  bigliettiCumulati: number;
  bigliettiBase: number;
  bigliettiBaseAl: string;
  bigliettiNuovi: number;
  edizioneTracciata: boolean;
};

/**
 * Assegnati, chiamate e risposte di una giornata, dal foglio Operatori.
 *
 * E' LA FONTE DELLA TABELLA, le stesse colonne che la Dashboard somma: il
 * foglio e' una fotografia presa a fine giornata e non cambia piu', mentre
 * ricontare da HubSpot darebbe i proprietari di oggi su un lavoro di ieri.
 *
 * SI FILTRA PER CAMPAGNA quando serve il blocco ICMD: la colonna Campagna c'e'
 * riga per riga, e "icmd" la riconosce in tutte le edizioni - icmd_14,
 * icmd13_, icmd12 - perche' sono tutte la stessa linea.
 */
async function dalFoglio(giorno: string, soloCampagna?: string) {
  const SHEET = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
  const righe = await fetchCsv(
    `https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=245526930`,
    { next: { revalidate: 0 } }
  );
  const num = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  // LA DATA DEL FOGLIO PUO' ESSERE SCRITTA IN DUE MODI, e non si sa quale:
  // si normalizzano entrambi invece di indovinare.
  const normalizza = (v: string) => {
    const s = (v ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
  };
  let assegnati = 0;
  let chiamate = 0;
  let risposte = 0;
  let trovate = 0;
  for (const r of righe) {
    if (normalizza(String(r["Data"] ?? "")) !== giorno) continue;
    const camp = String(r["Campagna"] ?? "").toLowerCase();
    if (soloCampagna && !camp.includes(soloCampagna)) continue;
    trovate += 1;
    assegnati += num(r["Assegnati"]);
    chiamate += num(r["Chiamate"]);
    risposte += num(r["Connessioni"]);
  }
  // ZERO RIGHE NON E' ZERO LAVORO: il foglio di quel giorno puo' non essere
  // ancora stato scritto, e un trattino lo dice mentre uno zero mente.
  return trovate ? { assegnati, chiamate, risposte } : null;
}

const giorno = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Il giorno dopo. Mezzogiorno per non sfiorare nessun confine. */
const giornoDopo = (data: string) =>
  giorno(new Date(`${data}T12:00:00Z`).getTime() + 24 * 3600 * 1000);

/**
 * La mezzanotte di Roma di quel giorno, in millisecondi.
 *
 * LO SCARTO NON SI SCRIVE FISSO, si chiede. La prima versione faceva
 * `new Date(`${data}T00:00:00+02:00`)`, cioe' l'ora legale per sempre: dal 26
 * ottobre 2026 - fine dell'ora legale - quella finestra sarebbe partita alle
 * 23 della sera prima e finita alle 23 di ieri. Un'ora di mercoledi' sera
 * contata nel giovedi' e l'ultima ora di giovedi' perduta, ogni giorno
 * dell'inverno, su `createdate` che e' un istante vero. Nessuno se ne
 * accorgerebbe dai numeri: tornerebbero sempre plausibili.
 *
 * COME SI CHIEDE: si legge lo stesso istante a Roma e a Greenwich, la
 * differenza e' lo scarto di quel giorno, e si corregge. La mezzanotte a Roma
 * esiste sempre - il cambio dell'ora avviene alle 2 o alle 3 - quindi una
 * correzione sola basta ed e' esatta.
 */
function mezzanotteRoma(data: string): number {
  const utc = new Date(`${data}T00:00:00Z`).getTime();
  const letto = new Date(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(utc).replace(" ", "T") + "Z"
  ).getTime();
  return utc - (letto - utc);
}

/** Mezzanotte di Roma, in millisecondi. Il giorno lo decide il fuso di chi lavora. */
function estremiRoma(data: string): { da: number; a: number } {
  return { da: mezzanotteRoma(data), a: mezzanotteRoma(giornoDopo(data)) };
}

export function ieriRoma(): string {
  const oggi = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  oggi.setDate(oggi.getDate() - 1);
  return `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}-${String(oggi.getDate()).padStart(2, "0")}`;
}

async function sfoglia(
  token: string,
  oggetto: string,
  filters: unknown[],
  properties: string[],
  pagineMax = 30
): Promise<Array<{ id: string; properties: Record<string, string> }>> {
  const out: Array<{ id: string; properties: Record<string, string> }> = [];
  let after: string | undefined;
  let tentativi = 0;
  for (let p = 0; p < pagineMax + 4; p++) {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/${oggetto}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        filterGroups: [{ filters }],
        properties,
        sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
        limit: 100,
        after
      })
    });
    if (r.status === 429 && tentativi < 4) {
      // IL TETTO E' CONDIVISO con decine di flussi Zapier: un report che gira
      // una volta al giorno non deve morire perche' in quel secondo stava
      // lavorando qualcun altro. Si aspetta un po' di piu' ogni volta.
      await new Promise((ok) => setTimeout(ok, 1500 * (tentativi + 1)));
      tentativi += 1;
      p -= 1;
      continue;
    }
    if (!r.ok) {
      // SI ALZA LA MANO invece di tornare meno righe: un report piu' corto si
      // legge come una giornata fiacca, e nessuno va a controllare.
      throw new Error(`HubSpot ${r.status} su ${oggetto}`);
    }
    const d = (await r.json()) as {
      results?: Array<{ id: string; properties: Record<string, string> }>;
      paging?: { next?: { after?: string } };
    };
    out.push(...(d.results ?? []));
    after = d.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

/** True se il prodotto del Boom dice ICMD. Vedi la nota in cima. */
export const eIcmd = (prodotto?: string) => /icmd/i.test(prodotto ?? "");

/**
 * Se questa trattativa e' MAI passata dalla fase Ripianificata.
 *
 * Si guarda la data di ingresso nella fase, che HubSpot conserva anche quando
 * la trattativa e' andata avanti: lo stato attuale direbbe solo dov'e' adesso.
 */
const eRipianificata = (p: Record<string, string>) =>
  Boolean((p[`hs_v2_date_entered_${FASE.ripianificata}`] ?? "").trim());

/**
 * Svolte e no show, dal database e non dalle fasi delle trattative.
 *
 * E' LA STESSA LOGICA DELLA COLONNA CONSULENZE della Dashboard, e non una
 * seconda interpretazione: `trattativa.svolta_ts` dice il giorno in cui la
 * consulenza si e' SVOLTA - non quello in cui era stata fissata - e i no show
 * hanno una tabella loro con la loro data. Leggere invece la fase in cui si
 * trova adesso la trattativa risponde a un'altra domanda: dove sta oggi, non
 * cosa e' successo ieri. Misurato il 16 ottobre 2026, le due strade davano
 * 20 svolte contro 31.
 *
 * IL PRIMO APPUNTAMENTO E' `ripianificata_al` VUOTA, una colonna che esiste
 * gia': non serve risalire alla fase Ripianificata su HubSpot.
 */
/**
 * Le consulenze che sul CRM non esistono: call registrate senza appuntamento.
 *
 * SI CONTANO LE PERSONE, NON LE CALL. Misurato il 15 ottobre 2026: quattro
 * righe erano tre persone, perche' con una si era parlato due volte di fila -
 * 28 minuti e poi 21. Contare le righe avrebbe detto quattro consulenze dove
 * ce n'erano tre.
 *
 * STANNO IN UNA RIGA A PARTE E NON FRA LE SVOLTE, ed e' una scelta presa
 * guardando quelle quattro: una era una richiamata su una trattativa svolta a
 * dicembre e ormai archiviata, una era una trattativa segnata No Show con cui
 * pero' l'advisor aveva parlato 49 minuti, e una non aveva trattativa affatto.
 * Nessuna delle tre e' una consulenza nuova: sommarle allo show up lo
 * gonfierebbe con roba di un altro tipo. In riga propria invece si vedono, e
 * quando il numero si alza si va a guardare.
 */
async function fuoriCrmDelGiorno(da: string, a: string) {
  const { rows } = await getDb().query<{ contatto_id: string; con: string }>(
    `SELECT contatto_id::text AS contatto_id,
            MAX(CASE WHEN deal_id IS NULL THEN 0 ELSE 1 END)::text AS con
       FROM consulenza_fuori_crm
      WHERE inizio_ts >= $1::date AND inizio_ts < ($2::date + INTERVAL '1 day')
      GROUP BY 1`,
    [da, a]
  );
  const conTrattativa = rows.filter((r) => r.con === "1").length;
  return { persone: rows.length, conTrattativa, senza: rows.length - conTrattativa };
}

async function consulenze(da: string, a: string) {
  const db = getDb();
  const [svolte, disertate] = await Promise.all([
    db.query<{ tutte: string; prime: string }>(
      `SELECT COUNT(*)::text AS tutte,
              COUNT(*) FILTER (WHERE ripianificata_al IS NULL)::text AS prime
         FROM trattativa
        WHERE svolta_ts >= $1::date AND svolta_ts < ($2::date + INTERVAL '1 day')`,
      [da, a]
    ),
    db.query<{ tutte: string; prime: string }>(
      `SELECT COUNT(*)::text AS tutte,
              COUNT(*) FILTER (WHERE t.ripianificata_al IS NULL)::text AS prime
         FROM no_show n
         LEFT JOIN trattativa t ON t.deal_id = n.deal_id
        WHERE n.ts >= $1::date AND n.ts < ($2::date + INTERVAL '1 day')`,
      [da, a]
    )
  ]);
  return {
    svolteTutte: Number(svolte.rows[0]?.tutte ?? 0),
    svoltePrime: Number(svolte.rows[0]?.prime ?? 0),
    noShowTutti: Number(disertate.rows[0]?.tutte ?? 0),
    noShowPrimi: Number(disertate.rows[0]?.prime ?? 0)
  };
}

function blocco(
  svolti: number,
  noShow: number,
  nonRegistrati: number,
  boom: Array<{ properties: Record<string, string> }>
): Blocco {
  return {
    // DA SVOLGERE E' LA SOMMA, non un conteggio a parte: una consulenza in
    // programma o si e' svolta o e' stata disertata. Il terzo caso - nessuno
    // dei due - non e' un esito, e sta nella sua riga.
    daSvolgere: svolti + noShow,
    svolti,
    noShow,
    nonRegistrati,
    boomHt: boom.filter((b) => !eIcmd(b.properties.prodotto)).length,
    boomIcmd: boom.filter((b) => eIcmd(b.properties.prodotto)).length
  };
}

export async function reportDelGiorno(opzioni: {
  token: string;
  data?: string;
  /** Il sotto-team di ciascuno, per nome normalizzato: serve a dividere setter e chatter. */
  sottoTeam?: Record<string, string>;
  /** Il conteggio a mano dei biglietti ICMD paganti, e il giorno a cui si ferma. */
  bigliettiBase?: number;
  bigliettiBaseAl?: string;
  /** Gli assegnati e le chiamate ICMD di ieri, se chi chiama li ha gia'. */
  icmd?: { assegnati: number | null; chiamate: number | null; risposte: number | null };
}): Promise<ReportGiornaliero> {
  const { token } = opzioni;
  const data = opzioni.data ?? ieriRoma();
  const { da, a } = estremiRoma(data);
  const bigliettiBase = opzioni.bigliettiBase ?? BIGLIETTI_BASE;
  const bigliettiBaseAl = opzioni.bigliettiBaseAl ?? BIGLIETTI_BASE_AL;

  // 1. GLI APPUNTAMENTI FISSATI IERI: trattative nate ieri nella pipeline.
  const fissate = await sfoglia(token, "deals", [
    { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT },
    { propertyName: "createdate", operator: "GTE", value: String(da) },
    { propertyName: "createdate", operator: "LT", value: String(a) }
  ], ["setter", "hubspot_owner_id", "createdate"]);

  // 2. LE CONSULENZE IN PROGRAMMA IERI, qualunque sia la loro fase adesso.
  //
  // DUE RICERCHE E POI UN SETACCIO. Si chiede una finestra larga un giorno per
  // lato su ciascuno dei due campi, si uniscono per id, e solo qui si decide
  // chi cade davvero nella giornata di Roma - guardando il valore, non i
  // confini della ricerca. Vedi la nota in cima: i due campi sono sfasati di
  // due ore fra loro, e nessuno dei due da solo copre tutte le trattative.
  const largo = { da: da - 24 * 3600 * 1000, a: a + 24 * 3600 * 1000 };
  const props = [
    "dealstage",
    "data_appuntamento",
    "data_e_ora_appuntamento",
    `hs_v2_date_entered_${FASE.ripianificata}`
  ];
  const perId = new Map<string, { id: string; properties: Record<string, string> }>();
  for (const campo of ["data_e_ora_appuntamento", "data_appuntamento"]) {
    const righe = await sfoglia(token, "deals", [
      { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT },
      { propertyName: campo, operator: "GTE", value: String(largo.da) },
      { propertyName: campo, operator: "LT", value: String(largo.a) }
    ], props);
    for (const t of righe) if (!perId.has(t.id)) perId.set(t.id, t);
  }
  /** Il giorno di Roma di questo appuntamento, dal valore che c'e'. */
  const giornoRoma = (p: Record<string, string>): string => {
    const grezzo = (p.data_e_ora_appuntamento ?? "").trim() || (p.data_appuntamento ?? "").trim();
    if (!grezzo) return "";
    const ms = /^\d+$/.test(grezzo) ? Number(grezzo) : new Date(grezzo).getTime();
    if (!Number.isFinite(ms)) return "";
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
  };
  const diIeri = [...perId.values()].filter((t) => giornoRoma(t.properties) === data);

  // 3. GLI INCASSI DI IERI.
  const incassi = await sfoglia(token, BOOM, [
    { propertyName: "data_di_pagamento", operator: "GTE", value: String(da) },
    { propertyName: "data_di_pagamento", operator: "LT", value: String(a) }
  ], ["prodotto", "tipologia_di_incasso", "tipo_di_vendita", "importo", "edizione"]);

  const chiusure = incassi.filter((b) => CHIUSURE.has((b.properties.tipologia_di_incasso ?? "").trim()));
  const somma = (righe: typeof incassi) =>
    righe.reduce((s, b) => s + (Number(b.properties.importo) || 0), 0);

  // LE TRE RIGHE DEI SOLDI NON SONO TRE ADDENDI, e per questo il 20 ottobre
  // 2026 il totale sembrava sbagliato: 5.000 telefoniche + 1.700 rate non
  // facevano i 6.950 incassati. Mancava un ICMD Gold da 250 venduto come
  // "Contatto Personale" - una chiusura che non e' telefonica, quindi fuori
  // dalla prima riga e dentro al totale. Qui si tiene da parte, e la riga
  // compare solo nei giorni in cui resta davvero qualcosa fuori: cosi' i
  // numeri si sommano a vista e nei giorni tutti telefonici il report e'
  // identico a prima.
  const telefoniche = chiusure.filter(
    (b) => (b.properties.tipo_di_vendita ?? "").trim() === "Telefonica"
  );
  const altre = chiusure.filter(
    (b) => (b.properties.tipo_di_vendita ?? "").trim() !== "Telefonica"
  );
  const altreVenditeTipi = [
    ...new Set(altre.map((b) => (b.properties.tipo_di_vendita ?? "").trim() || "senza tipo"))
  ];

  // 4. IL CUMULATO DEI BIGLIETTI ICMD PAGANTI: la base piu' quelli nuovi.
  //
  // FINO ALLA FINE DELLA GIORNATA DI CUI PARLA IL REPORT, non fino a adesso:
  // un report rigenerato per un giorno passato deve dare il numero di allora,
  // non quello di oggi. Prima la finestra era aperta in avanti e il cumulato
  // cambiava a ogni rilettura.
  //
  // SE IL GIORNO E' DENTRO LA BASE non si chiede niente a HubSpot: la base lo
  // contiene gia', e sommarci qualcosa lo conterebbe due volte.
  const dalMs = mezzanotteRoma(giornoDopo(bigliettiBaseAl));
  const biglietti = dalMs >= a ? [] : await sfoglia(token, BOOM, [
    { propertyName: "data_di_pagamento", operator: "GTE", value: String(dalMs) },
    { propertyName: "data_di_pagamento", operator: "LT", value: String(a) }
  ], ["prodotto", "tipologia_di_incasso", "edizione"]);
  const pagantiIcmd = biglietti.filter(
    (b) => eIcmd(b.properties.prodotto) && CHIUSURE.has((b.properties.tipologia_di_incasso ?? "").trim())
  );
  const conEdizione = pagantiIcmd.filter((b) => (b.properties.edizione ?? "").trim());

  // 5. SETTER CONTRO CHATTER, dal sotto-team di chi ha fissato.
  const sotto = opzioni.sottoTeam ?? {};
  const nomePerId = new Map<string, string>();
  if (Object.keys(sotto).length) {
    const r = await fetch(`${HUBSPOT}/crm/v3/owners?limit=100&archived=false`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (r.ok) {
      const d = (await r.json()) as { results?: Array<{ id: string; firstName?: string; lastName?: string }> };
      for (const o of d.results ?? []) {
        nomePerId.set(String(o.id), `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim().toLowerCase());
      }
    }
  }
  let appSetter = 0;
  let appChatter = 0;
  let appSenzaSetter = 0;
  for (const t of fissate) {
    const id = (t.properties.setter ?? "").trim();
    if (!id) {
      appSenzaSetter += 1;
      continue;
    }
    const nome = nomePerId.get(id) ?? "";
    const team = (sotto[nome] ?? "").toLowerCase();
    if (team === "chatter") appChatter += 1;
    else appSetter += 1;
  }

  // Gli esiti non registrati restano su HubSpot: nel database una consulenza
  // che non ha ne' esito ne' no show semplicemente non c'e', mentre qui si
  // vuole sapere proprio quante ne mancano all'appello.
  const fermi = diIeri.filter((t) => (t.properties.dealstage ?? "").trim() === FASE.daSvolgere);
  const fermiPrimi = fermi.filter((t) => !eRipianificata(t.properties));
  const c = await consulenze(data, data);
  const fc = await fuoriCrmDelGiorno(data, data);
  const perIcmd = await dalFoglio(data, "icmd").catch(() => null);
  const icmd = opzioni.icmd ?? perIcmd;
  // I Boom del blocco "da 1 app" non sono separabili senza risalire alla
  // trattativa: si tengono i totali, come faceva il report a mano.
  return {
    giorno: data,
    appFixedTotali: fissate.length,
    appSetter,
    appChatter,
    appSenzaSetter,
    venditeTelefoniche: somma(telefoniche),
    altreVendite: somma(altre),
    altreVenditeTipi,
    totaleRate: somma(incassi.filter((b) => (b.properties.tipologia_di_incasso ?? "").trim() === "Rata")),
    totaleIncasso: somma(incassi),
    totali: blocco(c.svolteTutte, c.noShowTutti, fermi.length, chiusure),
    primoApp: blocco(c.svoltePrime, c.noShowPrimi, fermiPrimi.length, chiusure),
    icmdAssegnati: icmd?.assegnati ?? null,
    icmdChiamate: icmd?.chiamate ?? null,
    icmdRisposte: icmd?.risposte ?? null,
    icmdVendite: chiusure.filter((b) => eIcmd(b.properties.prodotto)).length,
    fuoriCrm: fc,
    bigliettiCumulati: bigliettiBase + pagantiIcmd.length,
    bigliettiBase,
    bigliettiBaseAl,
    bigliettiNuovi: pagantiIcmd.length,
    edizioneTracciata: conEdizione.length > 0
  };
}

const pct = (parte: number, su: number) => (su > 0 ? `${Math.round((parte / su) * 100)}%` : "–");
const eur = (n: number) => `${new Intl.NumberFormat("it-IT").format(Math.round(n))}`;

/** Il report come lo si leggeva prima, in testo. */
export function messaggio(r: ReportGiornaliero): string {
  const [aa, mm, gg] = r.giorno.split("-");
  const righe: string[] = [];
  righe.push(`*REPORT ${gg}/${mm}*`);
  righe.push(`    NUMERO APP FIXED TOTALI: ${r.appFixedTotali}`);
  righe.push(
    `    NUMERO APP: setter fissati ${r.appSetter} + chatter fissati ${r.appChatter}` +
      (r.appSenzaSetter ? ` + ${r.appSenzaSetter} senza setter` : "") +
      ` = ${r.appSetter + r.appChatter + r.appSenzaSetter}`
  );
  righe.push(`    TOTALE VENDITE TELEFONICHE: ${eur(r.venditeTelefoniche)}`);
  // SOLO SE C'E' DAVVERO: nei giorni tutti telefonici la riga non compare e il
  // report resta quello di sempre.
  if (r.altreVendite) {
    righe.push(`    ALTRE VENDITE: ${eur(r.altreVendite)} (${r.altreVenditeTipi.join(", ")})`);
  }
  righe.push(`    TOTALE RATE: ${eur(r.totaleRate)}`);
  righe.push(`    TOTALE INCASSO: ${eur(r.totaleIncasso)}`);
  righe.push("");
  const b = (t: typeof r.totali, eti: string) => {
    righe.push(
      `    ${eti} = ${t.daSvolgere}` + (t.nonRegistrati ? ` + ${t.nonRegistrati} esiti non registrati` : "")
    );
    righe.push(`    Svolti = ${t.svolti}`);
    righe.push(`    Show up = ${pct(t.svolti, t.daSvolgere)}`);
    righe.push(`    NO SHOW = ${t.noShow}`);
    // SI CHIAMANO CHIUSURE A VIDEO E boom NEL CODICE, ed e' voluto: l'oggetto
    // su HubSpot si chiama Boom, e chi un giorno cerchera' da dove esce questo
    // numero deve ritrovare quel nome. L'etichetta e' per chi legge il report.
    righe.push(`    CHIUSURE = ${t.boomHt} + ${t.boomIcmd} icmd`);
    righe.push(`    CR = ${pct(t.boomHt, t.svolti)} (ht) - ${pct(t.boomIcmd, t.svolti)} (icmd)`);
  };
  b(r.totali, "Da Svolgere TOTALI (comprese le ripianificate)");
  righe.push("");
  b(r.primoApp, "da Svolgere DA 1 APP");
  righe.push("");
  righe.push(`    Lead assegnati ieri icmd: ${r.icmdAssegnati ?? "–"}`);
  righe.push(
    `    Chiamate effettuate: ${r.icmdChiamate ?? "–"} - Risposte: ${r.icmdRisposte ?? "–"}`
  );
  righe.push(`    CHIUSURE: ${r.icmdVendite}`);
  if (r.fuoriCrm.persone) {
    righe.push(
      `    Consulenze fuori CRM: ${r.fuoriCrm.persone}` +
        ` (su ${r.fuoriCrm.conTrattativa} trattative, ${r.fuoriCrm.senza} senza)`
    );
  }
  // SOLO IL NUMERO, nessuna specifica fra parentesi: chi legge il report vuole
  // sapere quanti biglietti paganti ci sono, non da dove viene il conteggio.
  // La composizione resta nei dati - `bigliettiBase` e `bigliettiNuovi` - per
  // chi deve controllare che la base di partenza sia ancora giusta.
  righe.push(`    Totale biglietti paganti: ${r.bigliettiCumulati}`);
  return righe.join("\n");
}
