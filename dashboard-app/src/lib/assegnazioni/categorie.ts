import { CATEGORIE, categoriaResidua, guessCategoria } from "@/lib/campaignCategory";

/**
 * Le categorie di campagna fra cui si sceglie la preferenza di una persona.
 *
 * SONO QUELLE DEL MARKETING, non una tassonomia inventata qui. La regola e'
 * `guessCategoria`, la stessa del filtro Categoria della tabella Campagne, e i
 * valori che si salvano sono i FRAMMENTI di quella regola - "div_coach_",
 * "rem_", "mbe_sales_" - non le etichette. Cosi' la categoria che decide chi
 * riceve un lead e la categoria scritta in tabella sono la stessa cosa.
 *
 * UNA PRIMA VERSIONE RAGGRUPPAVA PER LA PAROLA IN TESTA AL NOME - rem, div,
 * mbe, workshop - e sembrava ragionevole finche' non la si e' confrontata con
 * la regola vera: "workshop", "webinar" e "da" non sono categorie ma parole
 * che attraversano tutte le linee; "mbe" era una voce sola dove ce ne sono
 * tre; "div_coach_" veniva troncato a "div".
 *
 * SI CONTANO I CONTATTI DEL SERBATOIO, non le campagne in archivio. Misurato
 * il 10 ottobre 2026: nell'archivio la categoria piu' numerosa e' MEP con 32
 * campagne vive, ma di contatti assegnabili ne ha 18, mentre REM ne ha 8 di
 * campagne e 693 di contatti. Un menu ordinato per campagne metterebbe in
 * cima la voce piu' povera.
 *
 * SI ENUMERA IL SERBATOIO UNA VOLTA SOLA invece di fare una ricerca per
 * categoria. Costa le stesse chiamate - una ventina - ma i numeri sono esatti
 * e si ottengono tutti insieme: una ricerca per categoria dovrebbe filtrare
 * per parola, e la parola e' un sovrainsieme del frammento. Enumerando si
 * applica la regola vera a ogni contatto.
 *
 * FUORI GLI ICMD, che l'assegnatore scarta comunque - due volte, una sullo
 * storico e una sulla campagna - e fuori "Altro" e "Nessuna", che categorie
 * non sono. Fuori anche quelle a zero contatti: una voce che si sceglie e non
 * produce niente e' una trappola.
 */

const HUBSPOT = "https://api.hubapi.com";

/** L'eta' massima del serbatoio principale, la stessa dell'app e di pool.ts. */
const GIORNI_MAX = 20;

/**
 * Quanto vale l'elenco prima di rifarlo. Cambia con il ritmo con cui nascono
 * le campagne, cioe' settimane; rifarlo a ogni apertura della pagina sarebbe
 * spendere il budget condiviso con i flussi Zapier per un elenco fermo.
 */
const FRESCHEZZA_MINUTI = 30;

/** Quante pagine al massimo per ogni interrogazione: una cintura, non un tetto atteso. */
const PAGINE_MAX = 40;

/**
 * Quante volte riprovare quando HubSpot dice di rallentare.
 *
 * SERVE DAVVERO, non e' prudenza: questa enumerazione fa una ventina di
 * ricerche di fila, e il tetto di 19 al secondo e' condiviso con decine di
 * flussi Zapier e con il conteggio dei due serbatoi, che gira sulla stessa
 * pagina. Senza un secondo tentativo bastava che le due cose si incrociassero
 * perche' i sei riquadri uscissero vuoti - e vuoto si legge "non ci sono
 * categorie", che e' falso.
 */
const TENTATIVI = 3;
const RESPIRO_MS = 1200;

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La categoria che l'assegnatore scarta comunque, a valle della ricerca. */
const MAI = "ICMD";

/**
 * QUANTE CATEGORIE SI POSSONO SCEGLIERE PER PERSONA.
 *
 * Misurato il 10 ottobre 2026: il tetto di HubSpot non e' sul numero di gruppi
 * di filtri ma sul TOTALE dei filtri in tutti i gruppi, DICIOTTO. Ogni
 * categoria scelta diventa un gruppo da cinque filtri, quindi tre passano e la
 * quarta da' 400 "too many total filters across filter groups (count: 20, max
 * allowed: 18)". Dentro l'app quel 400 fa `break` in silenzio: zero lead per
 * tutti, senza errore visibile.
 */
export const MAX_CATEGORIE = 3;

export type Categoria = {
  /** L'etichetta del marketing: "MBE SALES", "DIV COACH". */
  etichetta: string;
  /**
   * I frammenti che la definiscono, ed e' quello che si salva: l'app confronta
   * questi, non l'etichetta.
   */
  frammenti: string[];
  /** Quanti contatti di questa categoria sono assegnabili adesso. */
  assegnabili: number;
};

function comuni(serie: string) {
  return [
    { propertyName: "dispatch_outcome", operator: "CONTAINS_TOKEN", value: `*${serie}*` },
    { propertyName: "hubspot_owner_id", operator: "NOT_HAS_PROPERTY" },
    { propertyName: "countdown", operator: "NOT_HAS_PROPERTY" },
    { propertyName: "id_campagna_refresh", operator: "HAS_PROPERTY" },
    { propertyName: "phone", operator: "HAS_PROPERTY" }
  ];
}

type Pagina = {
  results?: Array<{ id: string; properties?: { id_campagna_refresh?: string } }>;
  paging?: { next?: { after?: string } };
};

/** L'ultimo elenco calcolato, finche' e' fresco. */
let inCaldo: { quando: number; categorie: Categoria[] } | null = null;

export async function categorieAssegnabili(token: string): Promise<Categoria[]> {
  if (inCaldo && Date.now() - inCaldo.quando < FRESCHEZZA_MINUTI * 60_000) {
    return inCaldo.categorie;
  }

  const da = new Date();
  da.setHours(0, 0, 0, 0);
  da.setDate(da.getDate() - GIORNI_MAX);
  const quando = String(da.getTime());

  const visti = new Set<string>();
  const conta = new Map<string, number>();
  let qualcosaAndatoStorto = false;

  for (const serie of ["serie_a", "serie_b"]) {
    // LE DUE DATE SONO DUE INTERROGAZIONI, non un OR: paginando, due gruppi in
    // OR darebbero un ordinamento su cui il cursore non e' stabile. Si
    // scorrono separatamente e si uniscono per id.
    for (const campo of ["createdate", "recent_conversion_date"]) {
      let dopo: string | undefined;
      for (let pagina = 0; pagina < PAGINE_MAX; pagina++) {
        let r: Response | null = null;
        for (let tentativo = 1; tentativo <= TENTATIVI; tentativo++) {
          r = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              filterGroups: [
                { filters: [...comuni(serie), { propertyName: campo, operator: "GTE", value: quando }] }
              ],
              properties: ["id_campagna_refresh"],
              sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
              limit: 100,
              after: dopo
            })
          });
          if (r.ok || r.status !== 429) break;
          await attendi(RESPIRO_MS * tentativo);
        }
        if (!r || !r.ok) {
          console.error(`[categorie] ${serie}/${campo}: HubSpot ${r?.status}`);
          qualcosaAndatoStorto = true;
          break;
        }
        const d = (await r.json()) as Pagina;
        for (const c of d.results ?? []) {
          if (visti.has(c.id)) continue;
          visti.add(c.id);
          const categoria = guessCategoria(c.properties?.id_campagna_refresh ?? "");
          conta.set(categoria, (conta.get(categoria) ?? 0) + 1);
        }
        dopo = d.paging?.next?.after;
        if (!dopo) break;
      }
    }
  }

  // UN CONTEGGIO INCOMPLETO NON SI PUBBLICA. Se una delle interrogazioni e'
  // caduta a meta', le categorie rimaste indietro sembrerebbero piu' povere di
  // quello che sono - e si sceglierebbe su quei numeri. Meglio l'elenco di
  // prima, o nessun elenco.
  if (qualcosaAndatoStorto) return inCaldo?.categorie ?? [];

  const categorie = CATEGORIE.filter((c) => c.etichetta !== MAI && !categoriaResidua(c.etichetta))
    .map((c) => ({
      etichetta: c.etichetta,
      frammenti: [...c.frammenti],
      assegnabili: conta.get(c.etichetta) ?? 0
    }))
    .filter((c) => c.assegnabili > 0)
    .sort((a, b) => b.assegnabili - a.assegnabili || a.etichetta.localeCompare(b.etichetta));

  inCaldo = { quando: Date.now(), categorie };
  return categorie;
}
