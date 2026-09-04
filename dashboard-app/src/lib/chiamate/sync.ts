// Sincronizzazione delle chiamate telefoniche, per ricavare Chiamate e
// Connessioni per campagna.
//
// COME SI ATTRIBUISCE UNA CHIAMATA A UNA CAMPAGNA: la chiamata sa solo a quale
// contatto e' associata. La campagna e' quella che il contatto aveva IN QUEL
// MOMENTO, cioe' la sua ultima conversione precedente alla telefonata. Non
// "l'ultima campagna in assoluto": attribuirebbe retroattivamente vecchie
// chiamate a campagne successive. Lo storico con i timestamp ce l'abbiamo in
// eventi_conversione, ed e' l'unico motivo per cui questa attribuzione e'
// possibile.
//
// La risoluzione avviene QUI, al sync, e non in lettura: cercare la campagna di
// ogni chiamata a ogni caricamento della pagina significherebbe scandagliare
// 740.000 eventi ogni volta.
//
// Copertura misurata su 600 chiamate campionate: 99,5% attribuite.

import { getDb } from "@/lib/db";

const HUBSPOT_API = "https://api.hubapi.com";

// Disposizione standard "Connected". Le altre (No answer, Busy, Wrong number,
// voicemail) restano registrate ma con connessa = false.
const DISPOSIZIONE_CONNESSO = "f240bbac-87c9-4f6e-bf70-924b57d47db7";

// Le letture in blocco delle associazioni accettano 100 input per volta.
const MAX_INPUT_ASSOCIAZIONI = 100;

export type TipoSyncChiamate = "bootstrap" | "incrementale";
export type EsitoChiamate = {
  chiamate: number;
  connesse: number;
  senzaContatto: number;
  senzaCampagna: number;
  troncato: boolean;
};
export type OpzioniChiamate = {
  daIso?: string;
  onProgresso?: (s: EsitoChiamate & { ultimoId: number }) => void;
};

// Un giro incrementale gira in una funzione Vercel da 60 secondi. A ~35
// chiamate/secondo, 1200 sono circa 35s: resta margine. Superato il tetto ci si
// ferma e lo si dichiara, invece di farsi uccidere a meta'.
const MAX_INCREMENTALE = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postHubSpot<T>(token: string, url: string, body: unknown): Promise<T> {
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) return res.json();
    if (res.status === 429 && tentativo < 3) {
      await sleep(1000 * (tentativo + 1));
      continue;
    }
    throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  }
  throw new Error("Troppi tentativi");
}

type Chiamata = { id: string; ts: Date; connessa: boolean };

/**
 * Chiamate del periodo, paginate per hs_object_id crescente invece che con il
 * cursore "after": evita il tetto di 10.000 risultati per query, che su 216.000
 * chiamate scatterebbe quasi subito.
 */
async function* cercaChiamate(
  token: string,
  daIso: string,
  tipo: TipoSyncChiamate,
  daId: number
): AsyncGenerator<Chiamata[]> {
  const daMs = new Date(daIso).getTime();
  const proprietaData = tipo === "incrementale" ? "hs_lastmodifieddate" : "hs_timestamp";
  let ultimoId = daId;

  while (true) {
    const d = await postHubSpot<any>(token, `${HUBSPOT_API}/crm/v3/objects/calls/search`, {
      limit: 100,
      properties: ["hs_call_disposition", "hs_timestamp"],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_object_id", operator: "GT", value: String(ultimoId) },
            { propertyName: proprietaData, operator: "GTE", value: String(daMs) }
          ]
        }
      ]
    });
    const risultati: any[] = d.results ?? [];
    if (!risultati.length) return;

    yield risultati
      .map((r) => ({
        id: r.id,
        ts: new Date(r.properties?.hs_timestamp ?? ""),
        connessa: r.properties?.hs_call_disposition === DISPOSIZIONE_CONNESSO
      }))
      .filter((c) => !Number.isNaN(c.ts.getTime()));

    ultimoId = Number(risultati[risultati.length - 1].id);
    await sleep(150);
  }
}

/** Contatto associato a ogni chiamata: la ricerca non lo restituisce. */
async function contattiDelleChiamate(token: string, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += MAX_INPUT_ASSOCIAZIONI) {
    const d = await postHubSpot<any>(token, `${HUBSPOT_API}/crm/v4/associations/calls/contacts/batch/read`, {
      inputs: ids.slice(i, i + MAX_INPUT_ASSOCIAZIONI).map((id) => ({ id }))
    });
    for (const r of d.results ?? []) {
      const contatto = r.to?.[0]?.toObjectId;
      const chiamata = r.from?.id ?? r._from?.id;
      if (contatto && chiamata) out.set(String(chiamata), Number(contatto));
    }
    await sleep(150);
  }
  return out;
}

/**
 * Per ogni coppia (contatto, istante) la campagna che il contatto aveva allora.
 * Gli alias risolvono i contatti fusi: gli eventi restano salvati sotto il
 * vecchio id, quindi vanno cercati anche li'.
 */
async function campagneAlMomento(
  coppie: Array<{ contactId: number; ts: Date }>
): Promise<Array<number | null>> {
  if (!coppie.length) return [];
  const db = getDb();
  const { rows } = await db.query(
    `SELECT x.idx::int AS idx, ev.campagna_id
     FROM unnest($1::bigint[], $2::timestamptz[]) WITH ORDINALITY AS x(cid, t, idx)
     LEFT JOIN LATERAL (
       SELECT e.campagna_id
       FROM eventi_conversione e
       WHERE (e.contact_id = x.cid
              OR e.contact_id IN (SELECT vecchio_id FROM alias_contatto WHERE nuovo_id = x.cid))
         AND e.ts <= x.t
       ORDER BY e.ts DESC
       LIMIT 1
     ) ev ON true`,
    [coppie.map((c) => c.contactId), coppie.map((c) => c.ts)]
  );

  const out = new Array<number | null>(coppie.length).fill(null);
  for (const r of rows) out[r.idx - 1] = r.campagna_id ?? null;
  return out;
}

async function inizioFinestraIncrementale(): Promise<string> {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT iniziato_at FROM sync_log WHERE tipo = 'chiamate' AND esito = 'ok'
     ORDER BY iniziato_at DESC LIMIT 1`
  );
  if (rows[0]?.iniziato_at) {
    return new Date(new Date(rows[0].iniziato_at).getTime() - 30 * 60_000).toISOString();
  }
  return new Date(Date.now() - 24 * 3600_000).toISOString();
}

export async function sincronizzaChiamate(
  token: string,
  tipo: TipoSyncChiamate = "bootstrap",
  opzioni: OpzioniChiamate = {}
): Promise<EsitoChiamate> {
  const daIso =
    opzioni.daIso ?? (tipo === "incrementale" ? await inizioFinestraIncrementale() : "2026-01-01");
  const db = getDb();

  const {
    rows: [log]
  } = await db.query(`INSERT INTO sync_log (tipo) VALUES ('chiamate') RETURNING id`);

  // Il bootstrap dura un'ora: se si interrompe deve riprendere dall'ultimo
  // blocco salvato. L'incrementale e' breve e riparte sempre da capo.
  let daId = 0;
  if (tipo === "bootstrap") {
    const { rows } = await db.query(`SELECT ultimo_id FROM sync_checkpoint WHERE tipo = 'chiamate'`);
    daId = rows[0] ? Number(rows[0].ultimo_id) : 0;
  }

  const esito: EsitoChiamate = {
    chiamate: 0,
    connesse: 0,
    senzaContatto: 0,
    senzaCampagna: 0,
    troncato: false
  };

  try {
    for await (const blocco of cercaChiamate(token, daIso, tipo, daId)) {
      const contatti = await contattiDelleChiamate(
        token,
        blocco.map((c) => c.id)
      );

      const conContatto = blocco.filter((c) => contatti.has(c.id));
      esito.senzaContatto += blocco.length - conContatto.length;

      const campagne = await campagneAlMomento(
        conContatto.map((c) => ({ contactId: contatti.get(c.id)!, ts: c.ts }))
      );

      if (conContatto.length) {
        await db.query(
          `INSERT INTO chiamata (call_id, contact_id, campagna_id, ts, connessa)
           SELECT * FROM UNNEST($1::bigint[], $2::bigint[], $3::int[], $4::timestamptz[], $5::boolean[])
           ON CONFLICT (call_id) DO UPDATE
             SET contact_id  = EXCLUDED.contact_id,
                 campagna_id = EXCLUDED.campagna_id,
                 ts          = EXCLUDED.ts,
                 connessa    = EXCLUDED.connessa`,
          [
            conContatto.map((c) => Number(c.id)),
            conContatto.map((c) => contatti.get(c.id)!),
            campagne,
            conContatto.map((c) => c.ts),
            conContatto.map((c) => c.connessa)
          ]
        );
      }

      esito.chiamate += blocco.length;
      esito.connesse += blocco.filter((c) => c.connessa).length;
      esito.senzaCampagna += campagne.filter((c) => c === null).length;

      const ultimoId = Number(blocco[blocco.length - 1].id);
      if (tipo === "bootstrap") {
        await db.query(
          `INSERT INTO sync_checkpoint (tipo, ultimo_id, contatti, eventi, aggiornato_at)
           VALUES ('chiamate', $1, $2, $3, now())
           ON CONFLICT (tipo) DO UPDATE
             SET ultimo_id = EXCLUDED.ultimo_id, contatti = EXCLUDED.contatti,
                 eventi = EXCLUDED.eventi, aggiornato_at = now()`,
          [ultimoId, esito.chiamate, esito.connesse]
        );
      }

      opzioni.onProgresso?.({ ...esito, ultimoId });

      if (tipo === "incrementale" && esito.chiamate >= MAX_INCREMENTALE) {
        esito.troncato = true;
        break;
      }
    }

    if (tipo === "bootstrap") await db.query(`DELETE FROM sync_checkpoint WHERE tipo = 'chiamate'`);

    await db.query(
      `UPDATE sync_log SET finito_at = now(), contatti = $2, eventi = $3, esito = $4, messaggio = $5 WHERE id = $1`,
      [
        log.id,
        esito.chiamate,
        esito.connesse,
        // Un giro troncato non e' un successo: marcarlo 'ok' sposterebbe la
        // finestra del giro successivo, lasciando un buco permanente.
        esito.troncato ? "errore" : "ok",
        esito.troncato
          ? `Troncato al tetto di ${MAX_INCREMENTALE}: finestra troppo ampia. Rilanciare "npm run bootstrap:chiamate".`
          : null
      ]
    );
    return esito;
  } catch (err) {
    await db.query(`UPDATE sync_log SET finito_at = now(), esito = 'errore', messaggio = $2 WHERE id = $1`, [
      log.id,
      err instanceof Error ? err.message : String(err)
    ]);
    throw err;
  }
}
