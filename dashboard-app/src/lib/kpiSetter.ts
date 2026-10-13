import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";
import { agganciaPersone, kpiGiorni, personeCopilot, type Candidato } from "@/lib/salescopilot";

/**
 * I KPI dei setter di Sales Copilot, conservati da noi e rinfrescati a scadenza.
 *
 * NON C'E' UN CRON, E NON SERVE. "Ogni cinque minuti" si ottiene con una
 * scadenza, non con un orologio: un giorno si rilegge quando la sua lettura ha
 * piu' di cinque minuti, e a rileggerlo e' chi apre la pagina. Se nessuno
 * guarda, non si chiama nessuno - ed e' giusto, non c'e' nessuno a cui
 * mostrare il dato. Il piano Vercel attuale non accetta comunque cron piu'
 * frequenti di uno al giorno.
 *
 * COSTA UNA CHIAMATA OGNI CINQUE MINUTI, NON UNA PER SPETTATORE. Dieci colleghi
 * sulla stessa pagina leggono le stesse righe: la scadenza vive nel database,
 * non nella pagina e nemmeno in memoria. In memoria non funzionerebbe - su
 * Vercel ogni richiesta puo' finire su un'istanza diversa, che parte senza
 * ricordarsi niente, e una cache che si svuota di continuo non e' una scadenza.
 *
 * E UNA CHIAMATA SOLA PER INTERVALLO, non una per giorno: a Copilot si chiede
 * `from`-`to` in un colpo. Un mese di tabella sono trentuno giorni, e trentuno
 * chiamate a ogni apertura di pagina sarebbero diventate un problema loro
 * prima che nostro.
 *
 * I GIORNI CHIUSI CHE HANNO DATO NUMERI NON SI RICHIEDONO MAI PIU'. Copilot
 * garantisce che un giorno passato riletto dia sempre la stessa risposta,
 * quindi una volta congelato il dato e' definitivo.
 *
 * I GIORNI CHIUSI TORNATI VUOTI, INVECE, SI RICHIEDONO ANCORA. Al 13 ottobre
 * 2026 `/setters/daily` risponde 200 senza nessuna persona per ogni giorno
 * provato: congelare quei vuoti vorrebbe dire una tabella a trattini anche il
 * giorno in cui l'API si accende, e nessuno capirebbe perche'. Un vuoto scade
 * dopo cinque minuti come oggi, e si riempie da solo.
 */

/** Quanto vale una lettura prima di rifarla. */
const FRESCHEZZA_MINUTI = 5;

/** Il limite dichiarato da Copilot: tre mesi per chiamata. */
const GIORNI_MASSIMI = 92;

export type RigaKpi = {
  giorno: string;
  personaId: string;
  nome: string | null;
  /** Il nome nostro, null quando non si e' agganciata a nessuno. */
  nostro: string | null;
  via: string | null;
  assegnati: number | null;
  qualificati: number | null;
  messaggi: number | null;
  appuntamenti: number | null;
  ore: number | null;
};

export type EsitoKpi = {
  /** Una riga per persona e per giorno: la somma la fa chi disegna. */
  righe: RigaKpi[];
  /** Quando la lettura piu' vecchia dell'intervallo e' stata fatta. */
  presoAt: string | null;
  /** Vero quando si e' chiamato Copilot adesso, non letto solo l'archivio. */
  appenaLetto: boolean;
  /** Quello che Copilot ha da dire: si mostra, non si butta. */
  note: string[];
  /**
   * Perche' non ci sono righe, quando non ce ne sono.
   *
   * ZERO PERSONE NON E' ZERO LAVORO. Al 13 ottobre 2026 l'API risponde 200 con
   * zero persone per ogni giorno: finche' e' cosi', un intervallo senza righe
   * significa "non ancora collegato", non "nessuno ha lavorato". Senza questa
   * distinzione la Dashboard mostrerebbe zeri veri al posto di un silenzio.
   */
  vuotoPerche: string | null;
};

const oggiRoma = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

/** I giorni da `da` ad `a` compresi, al massimo GIORNI_MASSIMI partendo dalla fine. */
function elencoGiorni(da: string, a: string): string[] {
  const giorni: string[] = [];
  const fine = new Date(`${a}T00:00:00Z`);
  const inizio = new Date(`${da}T00:00:00Z`);
  if (!Number.isFinite(fine.getTime()) || !Number.isFinite(inizio.getTime())) return [];
  for (const d = new Date(inizio); d <= fine; d.setUTCDate(d.getUTCDate() + 1)) {
    giorni.push(d.toISOString().slice(0, 10));
  }
  // SI TAGLIA DALL'INIZIO, non dalla fine: se il filtro chiede sei mesi, i
  // giorni che interessano sono i piu' recenti.
  return giorni.slice(-GIORNI_MASSIMI);
}

type RigaDb = {
  giorno: Date | string;
  persona_id: string;
  nome: string | null;
  nostro: string | null;
  via: string | null;
  assegnati: number | null;
  qualificati: number | null;
  messaggi: number | null;
  appuntamenti: number | null;
  ore: string | null;
};

/**
 * La data di una colonna DATE, come stringa.
 *
 * SI CHIEDE GIA' TESTO AL DATABASE (`giorno::text`) e questa funzione e' la
 * rete: un DATE che arriva come oggetto Date e' mezzanotte nel fuso locale, e
 * `toISOString` lo riporta a UTC spostandolo al giorno prima. Succedeva
 * davvero - tutte le letture finivano con la chiave sbagliata, nessun giorno
 * risultava fresco e Copilot veniva richiamato a ogni apertura di pagina - ed
 * e' il genere di errore che non si vede perche' i numeri restano giusti.
 */
const soloData = (g: Date | string): string => {
  if (typeof g === "string") return g.slice(0, 10);
  const m = `${g.getMonth() + 1}`.padStart(2, "0");
  const d = `${g.getDate()}`.padStart(2, "0");
  return `${g.getFullYear()}-${m}-${d}`;
};

const dallaRiga = (r: RigaDb): RigaKpi => ({
  giorno: soloData(r.giorno),
  personaId: r.persona_id,
  nome: r.nome,
  nostro: r.nostro,
  via: r.via,
  assegnati: r.assegnati,
  qualificati: r.qualificati,
  messaggi: r.messaggi,
  appuntamenti: r.appuntamenti,
  ore: r.ore === null ? null : Number(r.ore)
});

/**
 * I KPI di un intervallo di giorni, letti dall'archivio e rinfrescati a scadenza.
 *
 * Le nostre persone, per l'aggancio, si passano da fuori: questo file non deve
 * sapere da dove vengono - e cosi' si puo' provare senza rete.
 */
export async function kpiIntervallo(
  da: string,
  a: string,
  chiave: string,
  candidati: Candidato[]
): Promise<EsitoKpi> {
  const giorni = elencoGiorni(da, a);
  if (!giorni.length) {
    return { righe: [], presoAt: null, appenaLetto: false, note: [], vuotoPerche: "intervallo non valido" };
  }
  const primo = giorni[0];
  const ultimo = giorni[giorni.length - 1];
  const oggi = oggiRoma();
  const db = getDb();

  const [{ rows: righeDb }, { rows: letture }] = await Promise.all([
    db.query<RigaDb>(
      `SELECT giorno::text AS giorno, persona_id, nome, nostro, via, assegnati, qualificati,
              messaggi, appuntamenti, ore
         FROM copilot_setter_kpi
        WHERE giorno BETWEEN $1::date AND $2::date
        ORDER BY giorno, nome`,
      [primo, ultimo]
    ),
    db.query<{ giorno: Date | string; persone: number; note: string | null; preso_at: Date }>(
      `SELECT giorno::text AS giorno, persone, note, preso_at FROM copilot_setter_letture
        WHERE giorno BETWEEN $1::date AND $2::date`,
      [primo, ultimo]
    )
  ]);

  const perGiorno = new Map(letture.map((l) => [soloData(l.giorno), l]));
  const scaduto = (g: string) => {
    const l = perGiorno.get(g);
    if (!l) return true;
    // Un giorno chiuso che ha dato numeri e' definitivo. Uno tornato vuoto no:
    // vedi l'intestazione del file.
    if (g < oggi && l.persone > 0) return false;
    return Date.now() - new Date(l.preso_at).getTime() >= FRESCHEZZA_MINUTI * 60_000;
  };
  // NON SI CHIEDE IL FUTURO. Un filtro che arriva a fine mese ha giorni che non
  // sono ancora accaduti: chiederli e' rumore, e la risposta vuota li
  // marcherebbe come letti.
  const daLeggere = giorni.filter((g) => g <= oggi && scaduto(g));

  const noteVecchie = letture
    .map((l) => l.note)
    .filter((n): n is string => !!n);
  const presoAt = letture.length
    ? new Date(Math.min(...letture.map((l) => new Date(l.preso_at).getTime()))).toISOString()
    : null;

  if (!daLeggere.length) {
    return {
      righe: righeDb.map(dallaRiga),
      presoAt,
      appenaLetto: false,
      note: [...new Set(noteVecchie)],
      vuotoPerche: righeDb.length ? null : perche(giorni, oggi)
    };
  }

  // SE LA LETTURA FALLISCE SI TIENE QUELLO CHE C'E'. Una pagina con i numeri di
  // cinque minuti fa e' meglio di una pagina vuota, e un errore di rete loro non
  // deve svuotare la nostra tabella.
  let risposta;
  try {
    risposta = await kpiGiorni(chiave, daLeggere[0], daLeggere[daLeggere.length - 1]);
  } catch (e) {
    console.error("[kpiSetter]", e);
    return {
      righe: righeDb.map(dallaRiga),
      presoAt,
      appenaLetto: false,
      note: [...new Set(noteVecchie)],
      vuotoPerche: righeDb.length ? null : "la lettura da Sales Copilot non e' riuscita"
    };
  }

  // L'aggancio si risolve al momento della scrittura, non della lettura: cosi'
  // resta scritto accanto al numero con quale regola e' stato fatto.
  const anagrafica = await personeCopilot(chiave).catch(() => []);
  const agganci = new Map(agganciaPersone(anagrafica, candidati).map((x) => [x.copilot.id, x]));
  const dentro = new Set(daLeggere);

  const nuove: RigaKpi[] = [];
  const quante = new Map<string, number>();
  for (const giorno of daLeggere) quante.set(giorno, 0);
  for (const g of risposta.days) {
    if (!dentro.has(g.date)) continue;
    quante.set(g.date, (g.people ?? []).length);
    for (const p of g.people ?? []) {
      const x =
        agganci.get(p.id) ??
        agganciaPersone([{ id: p.id, name: p.name ?? "", emails: p.emails ?? [] }], candidati)[0];
      nuove.push({
        giorno: g.date,
        personaId: p.id,
        nome: p.name ?? null,
        nostro: x?.nostro ?? null,
        via: x?.via ?? null,
        assegnati: p.assigned,
        qualificati: p.qualified,
        messaggi: p.messagesSent,
        appuntamenti: p.appointmentsSet,
        ore: p.hoursWorked
      });
    }
  }

  const nota = risposta.notes.join(" · ") || null;
  await db.query(
    `INSERT INTO copilot_setter_letture (giorno, persone, note, preso_at)
     SELECT x.giorno::date, x.persone, $2, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(giorno text, persone int)
     ON CONFLICT (giorno) DO UPDATE SET
       persone = EXCLUDED.persone, note = EXCLUDED.note, preso_at = now()`,
    [JSON.stringify([...quante].map(([giorno, persone]) => ({ giorno, persone }))), nota]
  );

  if (nuove.length) {
    await db.query(
      `INSERT INTO copilot_setter_kpi
         (giorno, persona_id, nome, nostro, via, assegnati, qualificati, messaggi,
          appuntamenti, ore, preso_at)
       SELECT x.giorno::date, x.persona_id, x.nome, x.nostro, x.via, x.assegnati,
              x.qualificati, x.messaggi, x.appuntamenti, x.ore, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           giorno text, persona_id text, nome text, nostro text, via text,
           assegnati int, qualificati int, messaggi int, appuntamenti int, ore numeric)
       ON CONFLICT (giorno, persona_id) DO UPDATE SET
         nome = EXCLUDED.nome, nostro = EXCLUDED.nostro, via = EXCLUDED.via,
         assegnati = EXCLUDED.assegnati, qualificati = EXCLUDED.qualificati,
         messaggi = EXCLUDED.messaggi, appuntamenti = EXCLUDED.appuntamenti,
         ore = EXCLUDED.ore, preso_at = now()`,
      [
        JSON.stringify(
          nuove.map((r) => ({
            giorno: r.giorno,
            persona_id: r.personaId,
            nome: r.nome,
            nostro: r.nostro,
            via: r.via,
            assegnati: r.assegnati,
            qualificati: r.qualificati,
            messaggi: r.messaggi,
            appuntamenti: r.appuntamenti,
            ore: r.ore
          }))
        )
      ]
    );
  }

  // I giorni appena letti sostituiscono quelli vecchi; gli altri restano come
  // stavano, ed e' il motivo per cui l'archivio si rilegge invece di fidarsi
  // solo della risposta.
  const righe = [...righeDb.map(dallaRiga).filter((r) => !dentro.has(r.giorno)), ...nuove].sort(
    (x, y) => x.giorno.localeCompare(y.giorno) || (x.nome ?? "").localeCompare(y.nome ?? "")
  );

  return {
    righe,
    presoAt: new Date().toISOString(),
    appenaLetto: true,
    note: [...new Set([...risposta.notes, ...noteVecchie])],
    vuotoPerche: righe.length ? null : perche(giorni, oggi)
  };
}

/** Un intervallo di un giorno solo: la forma comoda per una pagina al giorno. */
export const kpiDelGiorno = (giorno: string, chiave: string, candidati: Candidato[]) =>
  kpiIntervallo(giorno, giorno, chiave, candidati);

function perche(giorni: string[], oggi: string): string {
  if (giorni[0] > oggi) return "l'intervallo chiesto e' tutto nel futuro";
  return "Sales Copilot non ha ancora numeri per questo periodo: risponde senza nessuna persona";
}

/**
 * I numeri pronti per la tabella: per nome nostro normalizzato, sommati sui
 * giorni dell'intervallo.
 *
 * SOLO CHI SI E' AGGANCIATO. Una persona di Copilot che non corrisponde a
 * nessuno dei nostri non ha una riga dove finire: comparirebbe da nessuna
 * parte, e sommarla a qualcun altro sarebbe peggio. Chi resta fuori si legge in
 * `senzaAggancio`, perche' il silenzio non deve essere comodo.
 *
 * NULL NON VALE ZERO NEMMENO NELLA SOMMA: si sommano i giorni misurati, e se
 * per una persona non ce n'e' nemmeno uno il totale resta null e la cella
 * mostra un trattino. Un mese con tre giorni misurati su trenta da' la somma di
 * quei tre - che e' meno della verita', ma e' un numero vero e non un invento.
 *
 * TRE COLONNE, NON DUE: `qualificati` finisce sotto "Connessioni", che e' una
 * sistemazione provvisoria e non una corrispondenza - vedi CHATTER_QUALIFICATI.
 * Gli altri due campi che Copilot manda, `appuntamenti` e `ore`, restano
 * nell'archivio senza una colonna dove andare: appuntamenti li contiamo da
 * HubSpot e sono i nostri, le ore non le abbiamo mai chieste.
 */
export function perTabella(righe: RigaKpi[]) {
  const mappa: Record<
    string,
    { assegnati: number | null; messaggi: number | null; qualificati: number | null }
  > = {};
  for (const r of righe) {
    if (!r.nostro) continue;
    const k = chiaveNome(r.nostro);
    const g = (mappa[k] ??= { assegnati: null, messaggi: null, qualificati: null });
    if (r.assegnati !== null) g.assegnati = (g.assegnati ?? 0) + r.assegnati;
    if (r.messaggi !== null) g.messaggi = (g.messaggi ?? 0) + r.messaggi;
    if (r.qualificati !== null) g.qualificati = (g.qualificati ?? 0) + r.qualificati;
  }
  return mappa;
}
