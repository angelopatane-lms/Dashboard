// Client HubSpot per il tracciamento Lead Generati/Convertiti/Riconvertiti.
// Fonte eventi: cronologia della proprieta' "id_campagna_refresh" (si aggiorna
// solo quando un contatto si iscrive/converte su una campagna).

const HUBSPOT_API = "https://api.hubapi.com";
const ID_CAMPAGNA_REFRESH = "id_campagna_refresh";
const DATA_ULTIMA_MODIFICA = "data_ultima_modifica_campagna_refresh";

// Limite imposto da HubSpot sui batch che richiedono la cronologia delle
// proprieta' (per i batch normali sarebbe 100).
const MAX_INPUT_STORICO = 50;

type HubSpotFilter = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Contatori diagnostici, per capire quanto il portale ci sta rallentando.
 * Non influenzano il comportamento: servono solo al report della prova.
 */
export const statistiche = {
  richieste: 0,
  risposte429: 0,
  msTotaliAttesa: 0,
  reset() {
    this.richieste = 0;
    this.risposte429 = 0;
    this.msTotaliAttesa = 0;
  }
};

async function postWithRetry<T>(
  token: string,
  url: string,
  body: Record<string, unknown>
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    statistiche.richieste += 1;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) {
      const attesa = 1000 * (attempt + 1);
      statistiche.risposte429 += 1;
      statistiche.msTotaliAttesa += attesa;
      await sleep(attesa);
      continue;
    }
    throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  }
  throw new Error("Max retries exceeded");
}

/**
 * Scarica, paginando per hs_object_id crescente (non c'e' limite di 10k come
 * con il cursore "after"), i contatti che soddisfano i filtri extra passati,
 * sempre in combinazione con HAS_PROPERTY su id_campagna_refresh.
 *
 * `daId` e' il punto di ripresa: si riparte dai contatti con hs_object_id
 * maggiore di quel valore. Passare 0 (default) significa partire dall'inizio.
 */
export async function* cercaContattiRilevanti(
  token: string,
  filtriExtra: HubSpotFilter[],
  daId = 0
): AsyncGenerator<Array<{ id: string }>> {
  let lastId = daId;

  while (true) {
    const body = {
      limit: 100,
      properties: ["hs_object_id"],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_object_id", operator: "GT", value: String(lastId) },
            { propertyName: ID_CAMPAGNA_REFRESH, operator: "HAS_PROPERTY" },
            ...filtriExtra
          ]
        }
      ]
    };

    const data = await postWithRetry<{ results?: Array<{ id: string }> }>(
      token,
      `${HUBSPOT_API}/crm/v3/objects/contacts/search`,
      body
    );
    const results: Array<{ id: string }> = data.results ?? [];
    if (!results.length) return;

    yield results;

    lastId = Number(results[results.length - 1].id);
    await sleep(150); // limite: 5 richieste/secondo sul portale
  }
}

export function filtroModificatoDa(isoDate: string): HubSpotFilter {
  return {
    propertyName: DATA_ULTIMA_MODIFICA,
    operator: "GTE",
    value: String(new Date(isoDate).getTime())
  };
}

export type VoceCronologia = {
  value: string;
  timestamp: string;
};

export type DettaglioContatto = {
  history: VoceCronologia[];
  mergedIds: number[];
};

/**
 * Legge, per un batch di fino a 100 contatti, la cronologia completa di
 * id_campagna_refresh (ogni valore che ha avuto nel tempo, con timestamp) e
 * hs_merged_object_ids (elenco cumulativo degli ID assorbiti da fusioni).
 */
export async function leggiCronologiaContatti(
  token: string,
  ids: string[]
): Promise<Map<string, DettaglioContatto>> {
  const out = new Map<string, DettaglioContatto>();
  if (!ids.length) return out;

  type BatchReadResult = {
    id: string;
    properties?: Record<string, string | null>;
    propertiesWithHistory?: Record<string, VoceCronologia[]>;
  };

  const leggiGruppo = async (gruppo: string[]) => {
    const data = await postWithRetry<{ results?: BatchReadResult[] }>(
      token,
      `${HUBSPOT_API}/crm/v3/objects/contacts/batch/read`,
      {
        inputs: gruppo.map((id) => ({ id })),
        properties: ["hs_merged_object_ids"],
        propertiesWithHistory: [ID_CAMPAGNA_REFRESH]
      }
    );

    for (const r of data.results ?? []) {
      const history: VoceCronologia[] = r.propertiesWithHistory?.[ID_CAMPAGNA_REFRESH] ?? [];
      const mergedRaw: string = r.properties?.hs_merged_object_ids ?? "";
      const mergedIds = mergedRaw
        .split(";")
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map(Number)
        // Un id non numerico o fuori dalla precisione sicura di JS
        // corromperebbe la mappa degli alias: meglio scartarlo.
        .filter((n) => Number.isSafeInteger(n) && n > 0);
      out.set(r.id, { history, mergedIds });
    }
  };

  // I batch normali accettano 100 input, ma chiedendo propertiesWithHistory il
  // tetto scende a 50 ("The maximum number of inputs supported in a batch
  // request for property histories is 50"): oltre, HubSpot risponde 400 e la
  // scansione muore al primo blocco. Si spezza quindi in gruppi da 50.
  const leggi = async (elenco: string[]) => {
    for (let i = 0; i < elenco.length; i += MAX_INPUT_STORICO) {
      await leggiGruppo(elenco.slice(i, i + MAX_INPUT_STORICO));
      if (i + MAX_INPUT_STORICO < elenco.length) await sleep(100);
    }
  };

  await leggi(ids);

  // batch/read risponde 207 (che fetch considera "ok") quando alcuni input
  // falliscono: quei contatti sparirebbero dai risultati senza alcun errore, il
  // checkpoint avanzerebbe oltre e le loro conversioni resterebbero perse per
  // sempre, con il bootstrap che dichiara comunque "completato".
  // Si ritenta una volta e, se ancora mancano, si solleva un errore: meglio
  // fermarsi e riprendere dal checkpoint che proseguire con un buco invisibile.
  const mancanti = ids.filter((id) => !out.has(id));
  if (mancanti.length) {
    await sleep(500);
    await leggi(mancanti);

    const ancoraMancanti = ids.filter((id) => !out.has(id));
    if (ancoraMancanti.length) {
      throw new Error(
        `HubSpot non ha restituito ${ancoraMancanti.length} contatti su ${ids.length} ` +
          `(es. ${ancoraMancanti.slice(0, 3).join(", ")}) neanche dopo un secondo tentativo`
      );
    }
  }

  return out;
}
