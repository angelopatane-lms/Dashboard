// Client HubSpot per il tracciamento Lead Generati/Convertiti/Riconvertiti.
// Fonte eventi: cronologia della proprieta' "id_campagna_refresh" (si aggiorna
// solo quando un contatto si iscrive/converte su una campagna).

const HUBSPOT_API = "https://api.hubapi.com";
const ID_CAMPAGNA_REFRESH = "id_campagna_refresh";
const DATA_ULTIMA_MODIFICA = "data_ultima_modifica_campagna_refresh";

type HubSpotFilter = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry<T>(
  token: string,
  url: string,
  body: Record<string, unknown>
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) {
      await sleep(1000 * (attempt + 1));
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
 */
export async function* cercaContattiRilevanti(
  token: string,
  filtriExtra: HubSpotFilter[]
): AsyncGenerator<Array<{ id: string }>> {
  let lastId = 0;

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

export function filtroStatoLeadRilevante(): HubSpotFilter {
  return {
    propertyName: "stato_lead",
    operator: "IN",
    values: ["Nuovo", "Riconvertito", "Webinar"]
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

  const data = await postWithRetry<{ results?: BatchReadResult[] }>(
    token,
    `${HUBSPOT_API}/crm/v3/objects/contacts/batch/read`,
    {
      inputs: ids.map((id) => ({ id })),
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
      .map(Number);
    out.set(r.id, { history, mergedIds });
  }

  return out;
}
