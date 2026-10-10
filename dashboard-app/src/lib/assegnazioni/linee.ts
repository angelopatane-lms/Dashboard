import { getDb } from "@/lib/db";
import { formatoCampagna } from "@/lib/campagne";

/**
 * Le linee di campagna fra cui si sceglie la preferenza di una persona.
 *
 * COSA E' UNA LINEA. Le campagne non hanno nomi sparsi: hanno una parola in
 * testa che dice da quale linea vengono - `lms_rem_workshop_...`,
 * `lms_div_ew_...`, `lms_mbe_...`. Quella parola e' l'unita' con cui si
 * ragiona ("solo campagne REM a Manuel"), ed e' anche l'unita' che l'app sa
 * confrontare: il filtro in ricerca e' `CONTAINS_TOKEN` su
 * `id_campagna_refresh`, e "_" separa i pezzi, quindi "rem" e' gia' un
 * confronto esatto di parola. Misurato il 10 ottobre 2026: "rem", "*rem*",
 * "rem_*" e "*_rem_*" danno lo stesso identico numero di contatti.
 *
 * NON SI OFFRONO I NOMI INTERI, che sono 116 solo fra le vive: scegliere una
 * linea e' una casella, scegliere una campagna sarebbe un elenco da spulciare
 * ogni volta che ne nasce una nuova. E una preferenza per nome intero
 * scadrebbe da sola alla campagna successiva, che e' il contrario di
 * un'impostazione.
 *
 * SI CONTANO I CONTATTI, NON LE CAMPAGNE. E' la differenza fra un menu utile e
 * una trappola, misurata il 10 ottobre 2026:
 *
 *     MEP   32 campagne vive ->   18 contatti assegnabili
 *     REM    8 campagne vive ->  685
 *     ADE    4 campagne vive ->    0
 *     MM     4 campagne vive ->    0
 *
 * Ordinando per campagne, MEP sarebbe in cima e REM quasi in fondo; e ADE e MM
 * comparirebbero pur non potendo produrre un solo lead. Chi le sceglie
 * imposterebbe una preferenza che sembra fatta e non fa niente: riceverebbe
 * sempre e solo il riempitivo, senza capire perche'.
 *
 * FUORI GLI ICMD, perche' l'assegnatore li scarta comunque - due volte, una
 * sullo storico e una sulla campagna - ed e' la stessa trappola di sopra.
 */

const HUBSPOT = "https://api.hubapi.com";

/** Il prefisso aziendale, che non dice da quale linea viene la campagna. */
const PREFISSO = "lms";

/**
 * Le linee che l'assegnatore scarta comunque, a valle della ricerca.
 * Vedi `_is_icmd_excluded` e il controllo sullo storico in lead_assigner.py.
 */
const MAI = ["icmd"];

/** L'eta' massima del serbatoio principale, la stessa dell'app e di pool.ts. */
const GIORNI_MAX = 20;

/**
 * Quanto vale l'elenco prima di rifarlo.
 *
 * Costa una ricerca per linea per serie - una ventina - e cambia con il ritmo
 * con cui nascono le campagne, cioe' settimane. Rifarlo a ogni apertura della
 * pagina sarebbe spendere il budget condiviso con i flussi Zapier per un
 * elenco che non si muove.
 */
const FRESCHEZZA_MINUTI = 30;

/**
 * Una linea e' una parola, non una frase.
 *
 * Le campagne vecchie hanno il titolo per nome, spazi compresi, e la loro
 * prima parola non identifica niente: senza questo controllo nel menu
 * comparivano "IO CREDO TOUR INCONTRO LIVE ZOOM 3 GIUGNO 2021 ROMA",
 * "408037602-LMS" e "2021". Una linea vera e' una sigla breve.
 */
function sembraUnaLinea(parola: string): boolean {
  if (parola.length < 2 || parola.length > 20) return false;
  return /^[a-z][a-z0-9]*$/.test(parola);
}

export type Linea = {
  /** La parola da confrontare, minuscola: e' il valore che finisce nel filtro. */
  chiave: string;
  /** Come si legge nella tendina. */
  etichetta: string;
  /** Quanti contatti di questa linea sono assegnabili adesso. */
  assegnabili: number;
};

/** "lms_rem_workshop_x" -> "rem"; "rem_workshop_x" -> "rem". */
export function lineaDi(nome: string): string {
  const pezzi = nome.toLowerCase().split("_").filter(Boolean);
  const parola = pezzi[0] === PREFISSO ? pezzi[1] : pezzi[0];
  return parola ?? "";
}

/**
 * I cinque filtri dell'app, con lo slot della campagna ristretto alla linea.
 * La stessa sostituzione che fa `_gruppi_campagne` in lead_assigner.py: non si
 * aggiunge un filtro, si prende il posto di quello che c'e'.
 */
function filtri(serie: string, linea: string) {
  return [
    { propertyName: "dispatch_outcome", operator: "CONTAINS_TOKEN", value: `*${serie}*` },
    { propertyName: "hubspot_owner_id", operator: "NOT_HAS_PROPERTY" },
    { propertyName: "countdown", operator: "NOT_HAS_PROPERTY" },
    { propertyName: "id_campagna_refresh", operator: "CONTAINS_TOKEN", value: linea },
    { propertyName: "phone", operator: "HAS_PROPERTY" }
  ];
}

/**
 * QUANTE RICERCHE ALLA VOLTA.
 *
 * Il tetto di HubSpot e' 19 richieste al secondo ed e' condiviso con decine di
 * flussi Zapier: lanciando le linee tutte insieme - diciotto ricerche - sono
 * tornati 429 su quasi tutte, e il menu e' uscito vuoto. Vuoto non significa
 * "non ci sono linee", ma e' cosi' che si sarebbe letto.
 */
const ALLA_VOLTA = 5;

/** Un attimo di respiro prima di riprovare, quando HubSpot dice di rallentare. */
const RESPIRO_MS = 1200;

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cerca(token: string, corpo: unknown, dove: string): Promise<number | null> {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(corpo)
    });
    if (r.ok) {
      const d = (await r.json()) as { total?: number };
      return typeof d.total === "number" ? d.total : 0;
    }
    if (r.status !== 429) {
      console.error(`[linee] ${dove}: HubSpot ${r.status}`);
      return null;
    }
    await attendi(RESPIRO_MS * tentativo);
  }
  console.error(`[linee] ${dove}: HubSpot continua a rispondere 429`);
  return null;
}

async function quanti(token: string, linea: string, daMs: number): Promise<number | null> {
  const quando = String(daMs);
  let totale = 0;
  for (const serie of ["serie_a", "serie_b"]) {
    const base = filtri(serie, linea);
    const n = await cerca(
      token,
      {
        filterGroups: [
          { filters: [...base, { propertyName: "createdate", operator: "GTE", value: quando }] },
          {
            filters: [
              ...base,
              { propertyName: "recent_conversion_date", operator: "GTE", value: quando }
            ]
          }
        ],
        limit: 1
      },
      `${linea}/${serie}`
    );
    // NULL E NON ZERO: una linea non misurata e una linea vuota si leggono
    // diversissime, e qui uno zero la farebbe sparire dal menu in silenzio.
    if (n === null) return null;
    totale += n;
  }
  return totale;
}

/** L'ultimo elenco calcolato, finche' e' fresco. */
let inCaldo: { quando: number; linee: Linea[] } | null = null;

export async function lineeCampagne(token: string): Promise<Linea[]> {
  if (inCaldo && Date.now() - inCaldo.quando < FRESCHEZZA_MINUTI * 60_000) {
    return inCaldo.linee;
  }

  // I CANDIDATI DALL'ARCHIVIO DI QUI, i numeri da HubSpot. L'archivio dice
  // quali linee esistono senza costare niente; solo HubSpot sa quali hanno
  // ancora contatti da dare.
  const { rows } = await getDb().query<{ nome: string }>(
    `SELECT DISTINCT nome FROM campagna WHERE nome IS NOT NULL`
  );

  const candidate = new Set<string>();
  for (const r of rows) {
    if (formatoCampagna(r.nome) !== "live") continue;
    const linea = lineaDi(r.nome);
    if (!linea || !sembraUnaLinea(linea)) continue;
    if (MAI.some((m) => linea.startsWith(m))) continue;
    candidate.add(linea);
  }

  const da = new Date();
  da.setHours(0, 0, 0, 0);
  da.setDate(da.getDate() - GIORNI_MAX);

  const elenco = [...candidate];
  const contate: { chiave: string; etichetta: string; assegnabili: number | null }[] = [];
  for (let i = 0; i < elenco.length; i += ALLA_VOLTA) {
    const scaglione = await Promise.all(
      elenco.slice(i, i + ALLA_VOLTA).map(async (chiave) => ({
        chiave,
        etichetta: chiave.toUpperCase(),
        assegnabili: await quanti(token, chiave, da.getTime())
      }))
    );
    contate.push(...scaglione);
  }

  // Se HubSpot non ha risposto per nessuna linea, non si restituisce un menu
  // vuoto - che si leggerebbe "non ci sono linee" - ma l'ultimo elenco buono,
  // o niente se non ce n'e' mai stato uno.
  const misurate = contate.filter(
    (l): l is Linea => l.assegnabili !== null && l.assegnabili > 0
  );
  if (!misurate.length && contate.every((l) => l.assegnabili === null)) {
    return inCaldo?.linee ?? [];
  }

  const linee = misurate.sort(
    (a, b) => b.assegnabili - a.assegnabili || a.chiave.localeCompare(b.chiave)
  );
  inCaldo = { quando: Date.now(), linee };
  return linee;
}
