import { getDb } from "@/lib/db";

/**
 * QUANTO TEMPO PASSA FRA L'ASSEGNAZIONE DI UN LEAD E LA PRIMA TELEFONATA.
 *
 * LA DEFINIZIONE, decisa il 12 novembre 2026:
 *
 *  1. l'orologio parte dal PRIMO ORARIO UTILE. Un lead assegnato alle 2 di
 *     notte non si puo' chiamare alle 2 di notte: l'attesa comincia alle 7
 *     del primo giorno in cui si lavora. Senza questa correzione le sette ore
 *     di sonno finivano nel conto come se fossero lentezza di qualcuno, e il
 *     26% dei lead viene assegnato di notte;
 *  2. si contano solo le ORE LAVORATIVE, 7-21. Il sabato si lavora, la
 *     domenica no;
 *  3. si misura fino alla PRIMA CHIAMATA A QUEL CONTATTO, in qualunque giorno
 *     arrivi. Il conto del foglio guardava invece la prima chiamata
 *     dell'operatore nella giornata, chiunque avesse chiamato: misurava
 *     l'ora in cui una persona attacca a telefonare, non la risposta a quel
 *     lead;
 *  4. L'OROLOGIO SI FERMA QUANDO IL LEAD PASSA DI MANO. Un lead non chiamato
 *     viene tolto dal countdown e dato a un altro, che magari lo chiama il
 *     giorno dopo: senza questo confine quella telefonata finirebbe sul conto
 *     di chi NON ha chiamato, e sono 1.772 casi su 13.293 (13%). Ogni
 *     assegnazione si giudica quindi solo per quello che e' successo mentre
 *     quel lead era davvero in mano a quella persona;
 *  5. SI GIUDICANO SOLO LE ASSEGNAZIONI DI LEAD DA CHIAMARE. I marketing
 *     manager affidano un lead da lavorare mettendogli lo stato su "New" -
 *     anche quando il contatto era gia' di un advisor. Un'assegnazione con un
 *     altro stato e' un altro gesto: un advisor che si riprende un cliente
 *     per registrargli una rata, un passaggio di mano su un lead gia'
 *     lavorato, un BIN che gira. Si vede dai numeri: le assegnazioni su
 *     contatti "Cliente" restano senza telefonata nel 95% dei casi, quelle su
 *     "Numero errato" e "BIN" nel 94%, e giustamente - non c'e' niente da
 *     chiamare. Contarle significava addebitare a un advisor il fatto di aver
 *     incassato una rata;
 *  6. RESTANO FUORI I LEAD CHIESTI ALL'APP DI ALESSIO. Li' il lead non
 *     arriva: il setter lo chiede quando e' pronto a telefonare, e infatti
 *     li chiama in 48 minuti di mediana contro le 2,1 ore degli altri. E'
 *     un altro gesto, e mescolarlo abbassava il numero senza dire niente di
 *     vero su nessuno dei due. L'app tiene l'elenco dei contatti di ogni
 *     richiesta, quindi sono riconoscibili con certezza, non per indizi;
 *  7. CHI NON E' STATO CHIAMATO STA FUORI dalla media. Mettercelo con un
 *     tetto di 24 ore - come si faceva prima - mescola due informazioni
 *     opposte: Marvin Alessandrin col tetto risultava a 24 ore, senza
 *     risulta a 4; non e' lento, chiama pochi lead ma in fretta. Quanti lead
 *     restano senza telefonata e' una metrica a parte, qui sotto.
 *
 * LA MATURITA' VALE SOLO PER LA SECONDA METRICA. Un lead chiamato e' un dato
 * completo, anche se e' stato assegnato un'ora fa. Un lead NON chiamato no:
 * assegnato alle 20 di ieri non e' "mai chiamato", e' "ancora in tempo". Per
 * questo la quota dei non chiamati si calcola solo su chi ha avuto davanti
 * 24 ore lavorative piene, e su un periodo troppo recente non si mostra.
 *
 * DA DOVE VENGONO I DATI: le assegnazioni da `assegnazione_evento`, che il
 * cron notturno travasa dalla scheda Tracking Eventi (HubSpot la storia non
 * la tiene); le chiamate dalla tabella `chiamata`, completa dal 2023.
 */

/**
 * Gli stati con cui si affida un lead DA CHIAMARE. "Riconvertito" e' il lead
 * che torna da una seconda conversione; vale come un lead nuovo.
 */
const STATI_DA_CHIAMARE = ["New", "Riconvertito"];

const APERTURA = 7;
const CHIUSURA = 21;
const MATURITA_MIN = 24 * 60;

/**
 * Gli istanti si trattano come OROLOGI NUDI: l'ora di Roma viene letta dal
 * database come testo e montata con Date.UTC, cosi' l'aritmetica non passa
 * mai dal fuso del processo - che su Vercel e' UTC e su questo PC e' Roma, e
 * darebbe due risultati diversi per lo stesso dato.
 */
function orologio(testo: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(testo);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

const GIORNO = 86_400_000;
const siLavora = (t: number) => new Date(t).getUTCDay() !== 0;
const alle = (t: number, ora: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), ora, 0, 0);
};

/** Il primo momento in cui quel lead si poteva chiamare. */
function primoOrarioUtile(t: number): number {
  let g = t;
  for (let i = 0; i < 9; i++) {
    if (siLavora(g)) {
      const apre = alle(g, APERTURA);
      const chiude = alle(g, CHIUSURA);
      if (g < apre) return apre;
      if (g <= chiude) return g;
    }
    g = alle(g + GIORNO, 0);
  }
  return t;
}

/** Minuti in cui si poteva telefonare, fra due istanti. */
function minutiLavorativi(a: number, b: number): number {
  if (b <= a) return 0;
  let tot = 0;
  for (let g = a; g <= b + GIORNO; g = alle(g + GIORNO, 0)) {
    if (!siLavora(g)) continue;
    const i = Math.max(a, alle(g, APERTURA));
    const f = Math.min(b, alle(g, CHIUSURA));
    if (f > i) tot += (f - i) / 60_000;
    if (g > b) break;
  }
  return tot;
}

const mediana = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type PersonaTempoRisposta = {
  proprietarioId: string | null;
  nome: string;
  lead: number;
  medianaMin: number;
  nonChiamati: number;
};

export type TempoRisposta = {
  /** Su quante assegnazioni poggia la mediana. */
  chiamati: number;
  medianaMin: number;
  mediaMin: number;
  /** Percentuali cumulate: quanti sono stati chiamati entro quella soglia. */
  entro: Array<{ soglia: string; percento: number }>;
  /** Assegnazioni che hanno avuto davanti 24 ore lavorative piene. */
  maturi: number;
  nonChiamati: number;
  quotaNonChiamati: number;
  perPersona: PersonaTempoRisposta[];
};

export async function tempoRisposta(dal: string, al: string): Promise<TempoRisposta> {
  const { rows } = await getDb().query<{
    prop: string | null;
    nome: string | null;
    ass: string;
    chiam: string | null;
    fine: string | null;
  }>(
    // La finestra si calcola su TUTTE le assegnazioni e si filtra dopo: quella
    // che chiude un'assegnazione di fine mese puo' cadere il mese successivo,
    // e dentro il solo periodo non si vedrebbe.
    `WITH a AS (
       SELECT contatto_id, ts, proprietario_id, nome, stato_lead,
              lead(ts) OVER (PARTITION BY contatto_id ORDER BY ts) AS prossima
         FROM assegnazione_evento
        WHERE COALESCE(da_app, false) = false
     )
     SELECT a.proprietario_id::text AS prop,
            a.nome,
            to_char(a.ts AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD HH24:MI:SS') AS ass,
            to_char(a.prossima AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD HH24:MI:SS') AS fine,
            to_char((SELECT min(c.ts) FROM chiamata c
                      WHERE c.contact_id = a.contatto_id
                        AND c.ts > a.ts
                        AND (a.prossima IS NULL OR c.ts < a.prossima))
                    AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD HH24:MI:SS') AS chiam
       FROM a
      WHERE a.ts >= ($1::timestamp AT TIME ZONE 'Europe/Rome')
        AND a.ts <  ($2::timestamp AT TIME ZONE 'Europe/Rome')
        AND a.stato_lead = ANY($3::text[])`,
    [`${dal} 00:00:00`, `${al} 00:00:00`, STATI_DA_CHIAMARE]
  );

  // "Adesso" come orologio nudo di Roma, per sapere chi ha avuto il tempo.
  const adesso = orologio(
    new Date().toLocaleString("sv-SE", { timeZone: "Europe/Rome" }).replace(" ", "T")
  );

  const valori: number[] = [];
  const per = new Map<string, { nome: string; prop: string | null; v: number[]; muti: number }>();
  let maturi = 0;
  let nonChiamati = 0;

  for (const r of rows) {
    const inizio = primoOrarioUtile(orologio(r.ass));
    if (!Number.isFinite(inizio)) continue;
    const nome = (r.nome ?? "").trim();
    const chiave = r.prop ?? nome ?? "?";
    if (!per.has(chiave)) per.set(chiave, { nome, prop: r.prop, v: [], muti: 0 });
    const p = per.get(chiave)!;

    // MATURO = giudicabile. Due strade: o il lead gli e' stato TOLTO senza
    // che l'abbia chiamato - e allora e' un fatto compiuto, non serve
    // aspettare altro - oppure ce l'ha ancora e gli si danno 24 ore
    // lavorative prima di dire che non l'ha chiamato.
    const fine = r.fine ? orologio(r.fine) : null;
    const maturo = fine !== null || minutiLavorativi(inizio, adesso) >= MATURITA_MIN;
    if (maturo) maturi++;

    if (!r.chiam) {
      if (maturo) {
        nonChiamati++;
        p.muti++;
      }
      continue;
    }
    const v = minutiLavorativi(inizio, orologio(r.chiam));
    valori.push(v);
    p.v.push(v);
  }

  const soglie: Array<[string, number]> = [
    ["15 min", 15],
    ["30 min", 30],
    ["1 ora", 60],
    ["2 ore", 120],
    ["4 ore", 240]
  ];

  return {
    chiamati: valori.length,
    medianaMin: mediana(valori),
    mediaMin: valori.length ? valori.reduce((a, b) => a + b, 0) / valori.length : 0,
    entro: soglie.map(([soglia, m]) => ({
      soglia,
      percento: valori.length ? (valori.filter((v) => v <= m).length / valori.length) * 100 : 0
    })),
    maturi,
    nonChiamati,
    quotaNonChiamati: maturi ? (nonChiamati / maturi) * 100 : 0,
    perPersona: [...per.values()]
      .filter((p) => p.v.length > 0)
      .map((p) => ({
        proprietarioId: p.prop,
        nome: p.nome,
        lead: p.v.length,
        medianaMin: mediana(p.v),
        nonChiamati: p.muti
      }))
      .sort((a, b) => a.medianaMin - b.medianaMin)
  };
}
