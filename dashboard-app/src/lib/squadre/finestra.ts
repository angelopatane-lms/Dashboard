/**
 * La FOTOGRAFIA del giorno per le pagine delle squadre: una riga per persona,
 * con le stesse colonne che la Dashboard mostra nelle sue due tabelle.
 *
 * COSA C'E' QUI E COSA NO. Qui c'e' tutto tranne i soldi. Chiusure, venduto e
 * storni le pagine delle squadre se li vanno a prendere su HubSpot ogni volta
 * che qualcuno apre la pagina - vedi `src/lib/squadre/boom.ts` - perche' un
 * Boom cancellato due giorni dopo renderebbe falsa una fotografia scattata
 * prima, e sui soldi una cifra vecchia non e' accettabile. Tutto il resto -
 * assegnati, chiamate, connessioni, appuntamenti, consulenze, no show - una
 * volta passata la giornata non cambia piu', e si fotografa.
 *
 * LE REGOLE SONO QUELLE DELLE DUE TABELLE, non regole nuove. Un setter e un
 * advisor non leggono le stesse colonne nemmeno quando si chiamano uguale, e
 * il confronto riga per riga del 5 novembre 2026 lo ha misurato: su 26 persone
 * delle squadre, 26 avevano almeno un numero diverso da quello della Dashboard.
 * Per questo ogni voce qui sotto porta scritto da quale tabella viene.
 *
 *   assegnati, chiamate,  dal foglio Operatori, come le prime tre colonne di
 *   connessioni           tutte e due le tabelle. Nel foglio le intestazioni
 *                         convivono in due grafie ("Chiamate"/"Chiamati"), e
 *                         si leggono tutte e due come in src/lib/analytics.ts.
 *
 *   appuntamenti          trattative NATE quel giorno nella pipeline High
 *                         Ticket, contate a chi le ha FISSATE. Vale per tutte
 *                         e due le tabelle: anche la colonna Appuntamenti di
 *                         un advisor conta le trattative in cui e' lui il
 *                         setter. Quando il campo `setter` e' vuoto si ripiega
 *                         sul proprietario, come /api/hubspot-deals: sono 9
 *                         trattative su 871 in trenta giorni, e buttarle via
 *                         faceva sparire 2 appuntamenti a Tiffany Armel.
 *
 *   consulenze            DUE NUMERI DIVERSI, uno per lato, DALLA STESSA
 *                         FONTE: lo storico dei passaggi di fase. Al setter
 *                         quelle nate dai suoi appuntamenti, a chi vende
 *                         quelle che ha tenuto (`svolteComeProprietario`).
 *                         Dal 7 novembre 2026: prima il lato advisor leggeva
 *                         il foglio piu' le call senza appuntamento, e quella
 *                         somma gonfiava la colonna - a Mattia Primo 16
 *                         invece di 9 fra l'1 e il 6 novembre. `consulenzeFoglio`
 *                         e `fuoriCrm` restano nella fotografia perche' servono
 *                         ai confronti, ma non sono piu' la fonte di nessuna
 *                         colonna. Qui sotto com'era, e perche':
 *                         Tabella Setter: le consulenze nate dai suoi
 *                         appuntamenti, dal database per `setter_id`, come
 *                         /api/setter-trattative. Contarle al proprietario
 *                         lasciava i setter a zero - Mariarosaria 68 nella
 *                         tabella Setter, 1 sulle pagine delle squadre.
 *                         Tabella Advisor: la colonna Consulenze del foglio
 *                         Operatori piu' le call registrate senza
 *                         appuntamento, come effConsulenze() in
 *                         OperatorStatsTable. Verificato il 5 novembre 2026 su
 *                         Asma Bouchrit, 5 ottobre -> 4 novembre: la Dashboard
 *                         dice 74, cioe' 64 dal foglio piu' 10 fuori CRM. Il
 *                         database per proprietario ne direbbe 65.
 *
 *   no show               al setter i suoi, dal database per `setter_id`, come
 *                         fa la tabella Setter. All'advisor quelli delle
 *                         trattative di cui e' proprietario: quella colonna
 *                         nella tabella Advisor non c'e', e resta qui perche'
 *                         a una squadra serve saperlo. La legenda lo dice.
 *
 *   in programma          consulenze che erano in agenda quel giorno, al
 *                         proprietario. Non viene da nessuna tabella: e' una
 *                         colonna delle pagine delle squadre e basta.
 *
 * IL DATABASE SI SVEGLIA UNA VOLTA SOLA per esecuzione, e solo qui dentro: le
 * pagine aperte durante il giorno non lo toccano mai. Neon si paga a ore di
 * accensione, non a query.
 */
import { getDb } from "@/lib/db";
import { fetchCsv } from "@/lib/csv";
import { chiaveNome } from "@/lib/nomi";
import { PIPELINE_HT, FASE, estremiRoma, sfoglia } from "@/lib/report/giornaliero";
import { proprietari } from "@/lib/squadre/proprietari";

/** Il foglio Operatori: assegnati, chiamate, connessioni e consulenze. */
const FOGLIO_OPERATORI = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID_OPERATORI = "245526930";

/**
 * Il foglio "Hubspot User List": l'elenco di chi lavora, oggi.
 *
 * SERVE A FAR SPARIRE CHI NON C'E' PIU' dalle pagine delle squadre. La mappa
 * persona -> squadra viene dalle slide di ottobre ed e' ferma li': chi esce
 * dall'azienda resta scritto in una squadra per sempre, e la sua riga continua
 * a comparire a zero in fondo alla tabella. Il foglio invece lo tiene
 * aggiornato una persona, ed e' la stessa fonte che decide chi e' un operatore
 * sulla Dashboard.
 *
 * NON E' IN CONTRADDIZIONE col fatto che la Dashboard tenga il passato di chi
 * e' uscito: li' la domanda e' "quel giorno chi ha lavorato", e la risposta
 * non cambia perche' uno se ne va. Qui la domanda e' "come va la squadra
 * adesso", e di uno che non c'e' piu' non si puo' dire come va.
 */
const FOGLIO_UTENTI = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_UTENTI = "0";

/** Un giorno piu' o meno n, senza farsi ingannare dall'ora legale. */
export const piuGiorni = (d: string, n: number) =>
  new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** Il giorno di Roma di un istante, comunque sia scritto. */
function giornoRoma(grezzo: string | undefined): string {
  const v = (grezzo ?? "").trim();
  if (!v) return "";
  const ms = /^\d+$/.test(v) ? Number(v) : new Date(v).getTime();
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
}

/**
 * I numeri di una persona in un giorno, come li direbbero le due tabelle.
 *
 * I nomi dicono da quale lato arrivano: `comeSetter` e' la riga della tabella
 * Setter, `comeAdvisor` quella della tabella Advisor. Chi disegna sceglie il
 * lato secondo il ruolo, e il totale di squadra somma un lato solo per
 * colonna, cosi' la stessa consulenza non si conta due volte.
 */
export type Voci = {
  /** Foglio Operatori, uguale per tutte e due le tabelle. */
  assegnati: number;
  chiamate: number;
  connessioni: number;
  /**
   * IL TEMPO DI RISPOSTA, in due numeri invece che in una media.
   *
   * `latenzaMinuti` e' la somma dei minuti, `latenzaGiorni` quante righe del
   * foglio l'hanno misurata. La media si fa dividendo, e si puo' fare a
   * qualunque livello - una persona, una squadra, un mese - senza che le
   * medie si medino fra loro: la media di due medie non e' la media, e chi ha
   * lavorato un giorno peserebbe come chi ha lavorato venti.
   *
   * Le righe senza misura (zero o vuoto) non contano nel denominatore: zero
   * minuti non vuol dire "ha risposto subito", vuol dire "non si sa".
   */
  latenzaMinuti: number;
  latenzaGiorni: number;
  /** Appuntamenti fissati: sempre a chi ha fissato, in tutte e due le tabelle. */
  appuntamenti: number;
  /** Tabella Setter: consulenze nate dai suoi appuntamenti, e suoi no show. */
  svolteComeSetter: number;
  svolteComeSetterPrime: number;
  noShowComeSetter: number;
  /** Tabella Advisor: la colonna Consulenze e' questa piu' `fuoriCrm`. */
  consulenzeFoglio: number;
  fuoriCrm: number;
  /** Lato proprietario, per le colonne che solo le squadre mostrano. */
  inProgramma: number;
  nonRegistrati: number;
  svolteComeProprietario: number;
  noShowComeProprietario: number;
};

export type Finestra = {
  generato: string;
  finestra: { da: string; a: string };
  nomi: Record<string, string>;
  giorni: Record<string, Record<string, Voci>>;
  /**
   * Gli id HubSpot di chi e' nel foglio utenti ADESSO, non in questa finestra:
   * e' una fotografia del presente dentro una risposta che parla del passato.
   * Chi la legge toglie dalle squadre chi non c'e' piu'. Vuoto quando il
   * foglio non si e' letto, e allora non si toglie nessuno.
   */
  utenti: string[];
};

export type Storico = {
  generato: string;
  primoGiorno: string;
  ultimoGiorno: string;
  nomi: Record<string, string>;
  giorni: Record<string, Record<string, Voci>>;
  utenti?: string[];
};

const vuote = (): Voci => ({
  assegnati: 0,
  chiamate: 0,
  connessioni: 0,
  latenzaMinuti: 0,
  latenzaGiorni: 0,
  appuntamenti: 0,
  svolteComeSetter: 0,
  svolteComeSetterPrime: 0,
  noShowComeSetter: 0,
  consulenzeFoglio: 0,
  fuoriCrm: 0,
  inProgramma: 0,
  nonRegistrati: 0,
  svolteComeProprietario: 0,
  noShowComeProprietario: 0
});

/**
 * Consulenze e no show della finestra, giorno per giorno, dai DUE lati.
 *
 * TUTTO DAL DATABASE, in una lettura sola. `setter_id` e' il setter di allora,
 * congelato alla data dell'evento: e' la stessa colonna che legge
 * /api/setter-trattative per la tabella Setter. Il proprietario sta in
 * `trattativa.proprietario_id`, quindi nemmeno per quello serve chiamare
 * HubSpot - la versione precedente leggeva 500 trattative a blocchi di 100
 * per sapere una cosa che era gia' in casa.
 */
async function consulenze(da: string, a: string) {
  const db = getDb();
  const dentro = (colonna: string) =>
    `${colonna} >= ($1::date::timestamp AT TIME ZONE 'Europe/Rome')
     AND ${colonna} <  (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Rome')`;
  const giorno = (colonna: string) =>
    `to_char((${colonna} AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM-DD')`;

  const [svolteSetter, svolteProprietario, noShowSetter, noShowProprietario, fuori] =
    await Promise.all([
      db.query<{ giorno: string; id: string; n: string; prime: string }>(
        `SELECT ${giorno("t.svolta_ts")} AS giorno, t.setter_id::text AS id,
                COUNT(*)::text AS n,
                COUNT(*) FILTER (WHERE t.ripianificata_al IS NULL)::text AS prime
           FROM trattativa t
          WHERE ${dentro("t.svolta_ts")} AND t.setter_id IS NOT NULL
          GROUP BY 1, 2`,
        [da, a]
      ),
      db.query<{ giorno: string; id: string; n: string }>(
        `SELECT ${giorno("t.svolta_ts")} AS giorno, t.proprietario_id::text AS id,
                COUNT(*)::text AS n
           FROM trattativa t
          WHERE ${dentro("t.svolta_ts")} AND t.proprietario_id IS NOT NULL
          GROUP BY 1, 2`,
        [da, a]
      ),
      db.query<{ giorno: string; id: string; n: string }>(
        `SELECT ${giorno("n.ts")} AS giorno, n.setter_id::text AS id, COUNT(*)::text AS n
           FROM no_show n
          WHERE ${dentro("n.ts")} AND n.setter_id IS NOT NULL
          GROUP BY 1, 2`,
        [da, a]
      ),
      // La tabella `no_show` il proprietario non ce l'ha: si prende dalla
      // trattativa a cui l'evento appartiene.
      db.query<{ giorno: string; id: string; n: string }>(
        `SELECT ${giorno("n.ts")} AS giorno, t.proprietario_id::text AS id, COUNT(*)::text AS n
           FROM no_show n
           JOIN trattativa t ON t.deal_id = n.deal_id
          WHERE ${dentro("n.ts")} AND t.proprietario_id IS NOT NULL
          GROUP BY 1, 2`,
        [da, a]
      ),
      // LE CONSULENZE CHE SUL CRM NON ESISTONO: call registrate senza nessun
      // appuntamento. Non hanno trattativa, quindi non hanno setter:
      // appartengono all'advisor e basta, e la tabella Advisor le somma alla
      // colonna del foglio.
      db.query<{ giorno: string; id: string; n: string }>(
        `SELECT ${giorno("f.inizio_ts")} AS giorno, f.advisor_id::text AS id, COUNT(*)::text AS n
           FROM consulenza_fuori_crm f
          WHERE ${dentro("f.inizio_ts")} AND f.advisor_id IS NOT NULL
          GROUP BY 1, 2`,
        [da, a]
      )
    ]);

  return {
    svolteSetter: svolteSetter.rows,
    svolteProprietario: svolteProprietario.rows,
    noShowSetter: noShowSetter.rows,
    noShowProprietario: noShowProprietario.rows,
    fuori: fuori.rows
  };
}

/** La data del foglio, normalizzata: dentro ci sono tutte e due le scritture. */
function dataFoglio(v: string): string {
  const s = (v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
}

const numeroFoglio = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * QUELLO CHE SANNO I DUE FOGLI, senza toccare HubSpot: chi lavora oggi e
 * quanto si e' fatto aspettare, giorno per giorno.
 *
 * NIENTE ELENCO DEI PROPRIETARI, ed e' il punto. Il foglio Operatori scrive
 * le persone col nome e basta, e per attaccare quei numeri a qualcuno serve
 * il suo id HubSpot: la prima versione lo chiedeva a HubSpot, che vuol dire
 * leggere cinquecento proprietari a pagine da cento, una dozzina di
 * richieste - a ogni apertura di pagina, accanto a quelle dei Boom. Il
 * risultato e' stato un 429 e tre colonne vuote sulla pagina.
 *
 * Ma l'id di chi lavora sta gia' nell'altro foglio, "Hubspot User List",
 * colonna "Hubspot ID": e' lo stesso numero, lo tiene aggiornato una
 * persona, e lo stiamo leggendo comunque per sapere chi c'e'. Due letture di
 * foglio, zero chiamate a HubSpot, un secondo e mezzo.
 *
 * CHI NON E' PIU' NEL FOGLIO NON SI AGGANCIA, e va bene cosi': e' la stessa
 * persona che le pagine delle squadre tolgono dalle tabelle. Il suo tempo di
 * risposta non interessa piu' nessuno.
 */
export type DalFoglio = {
  /** Gli id HubSpot di chi e' nel foglio utenti adesso. */
  utenti: string[];
  /** giorno -> id -> minuti sommati e giornate misurate. */
  giorni: Record<string, Record<string, { latenzaMinuti: number; latenzaGiorni: number }>>;
};

export async function dalFoglio(da: string, a: string): Promise<DalFoglio> {
  // I DUE FOGLI IN PARALLELO: sono due letture indipendenti e una attesa sola.
  const [righeUtenti, righeOperatori] = await Promise.all([
    fetchCsv(
      `https://docs.google.com/spreadsheets/d/${FOGLIO_UTENTI}/export?format=csv&gid=${GID_UTENTI}`,
      { next: { revalidate: 0 } }
    ),
    fetchCsv(
      `https://docs.google.com/spreadsheets/d/${FOGLIO_OPERATORI}/export?format=csv&gid=${GID_OPERATORI}`,
      { next: { revalidate: 0 } }
    )
  ]);

  const utenti: string[] = [];
  const perNome = new Map<string, string>();
  for (const r of righeUtenti) {
    const id = (r["Hubspot ID"] ?? "").toString().trim();
    if (!id) continue;
    utenti.push(id);
    const nome = chiaveNome((r["User"] ?? "").toString());
    if (nome && !perNome.has(nome)) perNome.set(nome, id);
  }

  const giorni: Record<string, Record<string, { latenzaMinuti: number; latenzaGiorni: number }>> = {};
  for (const r of righeOperatori) {
    const g = dataFoglio((r["Data"] ?? "").toString());
    if (!g || g < da || g > a) continue;
    const id = perNome.get(chiaveNome((r["Operatore"] ?? "").toString()));
    if (!id) continue;
    // LE RIGHE SENZA MISURA NON CONTANO: zero minuti non vuol dire "ha
    // risposto subito", vuol dire che nessuno l'ha misurato.
    const minuti = numeroFoglio(r["Latenza"]);
    if (minuti <= 0) continue;
    const perGiorno = giorni[g] ?? (giorni[g] = {});
    const v = perGiorno[id] ?? (perGiorno[id] = { latenzaMinuti: 0, latenzaGiorni: 0 });
    v.latenzaMinuti += minuti;
    v.latenzaGiorni += 1;
  }

  return { utenti, giorni };
}

/**
 * Il calcolo vero e proprio, da un giorno all'altro, estremi compresi.
 *
 * Non scrive niente e non sa dove finira' il risultato: lo script lo mette su
 * file, la rotta lo manda per rete.
 */
export async function calcolaFinestra(
  token: string,
  da: string,
  a: string,
  racconta: (riga: string) => void = () => {}
): Promise<Finestra> {
  const giorni: string[] = [];
  for (let g = da; g <= a; g = piuGiorni(g, 1)) giorni.push(g);
  racconta(`finestra: ${da} -> ${a}  (${giorni.length} giorni)`);

  const nomi = await proprietari(token);

  const per: Record<string, Record<string, Voci>> = {};
  for (const g of giorni) per[g] = {};
  const voce = (giorno: string, chi: string): Voci => {
    const id = (chi ?? "").trim();
    if (!id || !per[giorno]) return vuote(); // senza persona il numero non ha dove andare
    per[giorno][id] ??= vuote();
    return per[giorno][id];
  };

  const estremiDa = estremiRoma(da).da;
  const estremiA = estremiRoma(a).a;

  // 1. APPUNTAMENTI FISSATI, a chi li ha fissati.
  const fissate = await sfoglia(
    token,
    "deals",
    [
      { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT },
      { propertyName: "createdate", operator: "GTE", value: String(estremiDa) },
      { propertyName: "createdate", operator: "LT", value: String(estremiA) }
    ],
    ["setter", "hubspot_owner_id", "createdate"],
    400
  );
  for (const t of fissate) {
    const g = giornoRoma(t.properties.createdate);
    if (!per[g]) continue;
    const chi =
      (t.properties.setter ?? "").trim() || (t.properties.hubspot_owner_id ?? "").trim();
    voce(g, chi).appuntamenti += 1;
  }
  racconta(`  trattative nate nella finestra: ${fissate.length}`);

  // 2. CONSULENZE IN PROGRAMMA, al proprietario. Due ricerche e poi il
  //    setaccio sul valore, come nel report: i due campi sono sfasati di due
  //    ore e nessuno dei due da solo copre tutte le trattative.
  const largoDa = estremiDa - 24 * 3600 * 1000;
  const largoA = estremiA + 24 * 3600 * 1000;
  const perId = new Map<string, Record<string, string>>();
  for (const campo of ["data_e_ora_appuntamento", "data_appuntamento"]) {
    const righe = await sfoglia(
      token,
      "deals",
      [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT },
        { propertyName: campo, operator: "GTE", value: String(largoDa) },
        { propertyName: campo, operator: "LT", value: String(largoA) }
      ],
      ["dealstage", "data_appuntamento", "data_e_ora_appuntamento", "hubspot_owner_id"],
      400
    );
    for (const t of righe) if (!perId.has(t.id)) perId.set(t.id, t.properties);
  }
  for (const [, p] of perId) {
    const g = giornoRoma(p.data_e_ora_appuntamento || p.data_appuntamento);
    if (!per[g]) continue;
    const v = voce(g, (p.hubspot_owner_id ?? "").trim());
    v.inProgramma += 1;
    if ((p.dealstage ?? "").trim() === FASE.daSvolgere) v.nonRegistrati += 1;
  }
  racconta(`  consulenze in programma nella finestra: ${perId.size}`);

  // 3. CONSULENZE E NO SHOW, dal database, dai due lati.
  const c = await consulenze(da, a);
  for (const r of c.svolteSetter) {
    const v = voce(r.giorno, r.id);
    v.svolteComeSetter += Number(r.n) || 0;
    v.svolteComeSetterPrime += Number(r.prime) || 0;
  }
  for (const r of c.svolteProprietario) voce(r.giorno, r.id).svolteComeProprietario += Number(r.n) || 0;
  for (const r of c.noShowSetter) voce(r.giorno, r.id).noShowComeSetter += Number(r.n) || 0;
  for (const r of c.noShowProprietario) voce(r.giorno, r.id).noShowComeProprietario += Number(r.n) || 0;
  for (const r of c.fuori) voce(r.giorno, r.id).fuoriCrm += Number(r.n) || 0;
  racconta(
    `  consulenze: ${c.svolteSetter.length} righe per setter, ${c.svolteProprietario.length} per proprietario;` +
      ` no show: ${c.noShowSetter.length} / ${c.noShowProprietario.length}; fuori CRM: ${c.fuori.length}`
  );

  // 4. IL FOGLIO OPERATORI: assegnati, chiamate, connessioni, consulenze.
  //
  // UNA LETTURA SOLA PER TUTTA LA FINESTRA: il foglio e' una fotografia presa
  // a fine giornata, rileggerlo per ogni giorno darebbe sempre le stesse righe.
  //
  // SI AGGANCIA PER NOME, perche' il foglio di id non ne ha. Verificato il 5
  // novembre 2026: tutte e 26 le persone delle squadre si agganciano, e resta
  // fuori una riga sola - "Nora D'Ascanio (Secondario)", 15 chiamate in un
  // mese - che la Dashboard ignora allo stesso modo.
  try {
    const righe = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${FOGLIO_OPERATORI}/export?format=csv&gid=${GID_OPERATORI}`,
      { next: { revalidate: 0 } }
    );
    let agganciate = 0;
    for (const r of righe) {
      const g = dataFoglio((r["Data"] ?? "").toString());
      if (!per[g]) continue;
      const id = nomi.perNome.get(chiaveNome((r["Operatore"] ?? "").toString()));
      if (!id) continue;
      agganciate++;
      const v = voce(g, id);
      v.assegnati += numeroFoglio(r["Assegnati"]);
      // Le due grafie convivono nel foglio, come in src/lib/analytics.ts.
      v.chiamate += numeroFoglio(r["Chiamati"] || r["Chiamate"]);
      v.connessioni += numeroFoglio(r["Connessi"] || r["Connessioni"]);
      v.consulenzeFoglio += numeroFoglio(r["Consulenze"]);
      // La stessa colonna che la Dashboard chiama Latenza e mostra come
      // "Reattivita'": vedi reattivitaMediaMin in src/lib/metrics.ts.
      const latenza = numeroFoglio(r["Latenza"]);
      if (latenza > 0) {
        v.latenzaMinuti += latenza;
        v.latenzaGiorni += 1;
      }
    }
    racconta(`  righe del foglio Operatori agganciate: ${agganciate}`);
  } catch (e) {
    // SENZA FOGLIO SI VA AVANTI LO STESSO: tre colonne vuote sono meglio di
    // nessuna pagina, e il resto dei numeri non dipende da lui.
    racconta(`  foglio Operatori non letto: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5. CHI C'E' ADESSO, dal foglio utenti. Una colonna sola - "Hubspot ID" -
  //    che e' la stessa chiave con cui le squadre sono scritte.
  const utenti: string[] = [];
  try {
    const righe = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${FOGLIO_UTENTI}/export?format=csv&gid=${GID_UTENTI}`,
      { next: { revalidate: 0 } }
    );
    for (const r of righe) {
      const id = (r["Hubspot ID"] ?? "").toString().trim();
      if (id) utenti.push(id);
    }
    racconta(`  utenti nel foglio: ${utenti.length}`);
  } catch (e) {
    // SENZA FOGLIO NON SI TOGLIE NESSUNO: un elenco vuoto farebbe sparire
    // tutte le squadre in una volta, che e' il danno peggiore del danno che
    // stiamo evitando.
    racconta(`  foglio utenti non letto: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    generato: new Date().toISOString(),
    finestra: { da, a },
    utenti,
    nomi: Object.fromEntries(
      [...new Set(giorni.flatMap((g) => Object.keys(per[g] ?? {})))].map((id) => [
        id,
        nomi.perId.get(id) ?? `(proprietario ${id})`
      ])
    ),
    giorni: per
  };
}

/**
 * Lo storico nuovo, fuso con quello vecchio.
 *
 * SI FONDE, NON SI SOVRASCRIVE: i giorni fuori dalla finestra restano quelli
 * di prima. E' tutto il punto del ricalcolo a 30 giorni - e il motivo per cui
 * chiunque riscriva lo storico deve passare di qui, che sia lo script sul PC o
 * il cron su Vercel.
 */
export function fondi(vecchio: Partial<Storico>, nuovo: Finestra): Storico {
  const giorni = { ...(vecchio.giorni ?? {}), ...nuovo.giorni };
  return {
    generato: nuovo.generato,
    primoGiorno: Object.keys(giorni).sort()[0],
    ultimoGiorno: nuovo.finestra.a,
    nomi: { ...(vecchio.nomi ?? {}), ...nuovo.nomi },
    // L'ELENCO NON SI FONDE, SI SOSTITUISCE: dice chi c'e' adesso, e tenere
    // anche quelli di ieri vorrebbe dire non togliere mai nessuno. Se la
    // lettura e' fallita si tiene quello di prima, che e' vecchio di un giro.
    utenti: nuovo.utenti.length ? nuovo.utenti : vecchio.utenti ?? [],
    giorni
  };
}
