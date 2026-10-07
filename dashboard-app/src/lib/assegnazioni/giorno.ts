import { getDb } from "@/lib/db";

/**
 * A chi ha dato lead l'app di assegnazione, oggi.
 *
 * COSA RIEMPIE. L'app Employee Manager espone due totali - quanti lead e a
 * quante persone - e nient'altro. Per sapere A CHI bisognava aprire il suo
 * database, che gira sul suo server (host.docker.internal) e da Vercel non si
 * raggiunge. Questo modulo ricava la stessa informazione da HubSpot, che la
 * sede ce l'ha gia': quando il bot assegna, scrive il proprietario sul
 * contatto, e HubSpot conserva la cronologia di quel campo con l'origine del
 * cambio.
 *
 * PERCHE' IL FILTRO SULL'ORIGINE NON E' UN DETTAGLIO. Il 7 ottobre 2026 i
 * contatti che avevano cambiato proprietario erano 1.071; di quelli, 560
 * venivano dal bot e il resto da workflow, azioni in blocco dalla scheda e
 * fusioni di contatti. Senza il filtro il report direbbe numeri quasi doppi, e
 * sarebbero numeri CREDIBILI - il modo peggiore di sbagliare.
 *
 * LA CONTROPROVA E' IL PUNTO. L'app dichiara `assegnati_oggi`; noi contiamo da
 * un'altra parte. Se i due numeri coincidono - e il 7 ottobre coincidevano al
 * lead, 560 e 560 - il dettaglio e' affidabile. Se divergono, il posto giusto
 * per dirlo e' la pagina, non un registro che nessuno legge.
 */

const HUBSPOT = "https://api.hubapi.com";

/**
 * L'app di Alessio, come la firma HubSpot nella cronologia.
 *
 * E' un id di integrazione, non un segreto: identifica quale applicazione ha
 * scritto il campo. Si e' ricavato guardando chi assegna a blocchi di ~20 e
 * confrontando il totale con quello che l'app dichiara di se'. Sta in una
 * variabile d'ambiente perche' se un giorno quell'app viene reinstallata il
 * numero cambia, e allora il report si svuoterebbe in silenzio: meglio poterlo
 * correggere senza un rilascio.
 */
const APP_ASSEGNAZIONE = process.env.LMS_HUBSPOT_APP_ID || "6848397";

/** Quanto puo' essere vecchio il calcolo prima di rifarlo. */
const FRESCHEZZA_MINUTI = 5;

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RigaGiorno = {
  proprietarioId: string;
  nome: string;
  lead: number;
  prima: string | null;
  ultima: string | null;
};

export type Giorno = {
  giorno: string;
  righe: RigaGiorno[];
  totale: number;
  persone: number;
  /** Quanto dichiara l'app. null quando non gliel'abbiamo chiesto. */
  atteso: number | null;
  /** Stringa vuota quando il giorno non e' mai stato fotografato. */
  aggiornatoAt: string;
  /** Vero quando il dato arriva dall'archivio e non da un calcolo appena fatto. */
  dallArchivio: boolean;
};

async function hubspot<T>(token: string, url: string, body?: unknown): Promise<T> {
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (res.status === 429) {
      await attesa(1000 * (tentativo + 1));
      continue;
    }
    if (!res.ok) {
      throw new Error(`HubSpot ${res.status} su ${url}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`HubSpot continua a rispondere 429 su ${url}`);
}

async function nomiProprietari(token: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let after: string | undefined;
  do {
    const u = `${HUBSPOT}/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`;
    const d = await hubspot<{
      results?: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
      paging?: { next?: { after?: string } };
    }>(token, u);
    for (const o of d.results ?? []) {
      const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
      out.set(String(o.id), nome || o.email || String(o.id));
    }
    after = d.paging?.next?.after;
  } while (after);
  return out;
}

type Voce = { value?: string; timestamp: string; sourceType?: string; sourceId?: string };

/**
 * Il calcolo vero, contro HubSpot.
 *
 * VALE SOLO PER OGGI, e non per una svista: `hubspot_owner_assigneddate` tiene
 * l'ULTIMA assegnazione, non tutte. Un contatto dato a Tizio ieri e ripassato a
 * Caio oggi porta la data di oggi, e da ieri sparisce. Rifare il conto di un
 * giorno passato darebbe quindi un numero piu' basso del vero, senza che nulla
 * lo segnali. Per questo i giorni passati si leggono dall'archivio e non si
 * ricalcolano mai: vedi leggiGiorno().
 */
async function calcola(
  token: string,
  giorno: Date
): Promise<{ righe: RigaGiorno[]; esaminati: number }> {
  const inizio = new Date(giorno);
  inizio.setHours(0, 0, 0, 0);
  const fine = new Date(inizio);
  fine.setDate(fine.getDate() + 1);

  // 1. I contatti che hanno cambiato proprietario nella giornata.
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const d = await hubspot<{
      results?: Array<{ id: string }>;
      paging?: { next?: { after?: string } };
    }>(token, `${HUBSPOT}/crm/v3/objects/contacts/search`, {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hubspot_owner_assigneddate",
              operator: "GTE",
              value: String(inizio.getTime())
            },
            {
              propertyName: "hubspot_owner_assigneddate",
              operator: "LT",
              value: String(fine.getTime())
            }
          ]
        }
      ],
      properties: ["hubspot_owner_id"],
      limit: 100,
      after
    });
    for (const c of d.results ?? []) ids.push(c.id);
    after = d.paging?.next?.after;
  } while (after);

  // 2. La cronologia, che e' l'unico posto dove c'e' scritto CHI ha assegnato.
  //    Il lotto e' da 50: con propertiesWithHistory HubSpot non ne accetta di piu'.
  const per = new Map<string, { lead: number; prima: Date; ultima: Date }>();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await hubspot<{
      results?: Array<{ propertiesWithHistory?: { hubspot_owner_id?: Voce[] } }>;
    }>(token, `${HUBSPOT}/crm/v3/objects/contacts/batch/read`, {
      inputs: ids.slice(i, i + 50).map((id) => ({ id })),
      propertiesWithHistory: ["hubspot_owner_id"]
    });
    for (const c of d.results ?? []) {
      for (const v of c.propertiesWithHistory?.hubspot_owner_id ?? []) {
        if (v.sourceType !== "INTEGRATION" || String(v.sourceId) !== APP_ASSEGNAZIONE) continue;
        const t = new Date(v.timestamp);
        if (t < inizio || t >= fine) continue;
        const chi = String(v.value ?? "").trim();
        if (!chi) continue;
        const e = per.get(chi);
        if (!e) {
          per.set(chi, { lead: 1, prima: t, ultima: t });
        } else {
          e.lead += 1;
          if (t < e.prima) e.prima = t;
          if (t > e.ultima) e.ultima = t;
        }
      }
    }
  }

  const nomi = await nomiProprietari(token);
  const righe: RigaGiorno[] = [...per.entries()]
    .map(([id, e]) => ({
      proprietarioId: id,
      // Un id che non risolve a nessun nome non si nasconde: il 7 ottobre ce
      // n'era uno (35226043) con un lead assegnato, cioe' un contatto finito a
      // un proprietario che non e' piu' nella lista. Mostrarlo come id nudo e'
      // il modo in cui ce ne accorgiamo.
      nome: nomi.get(id) ?? `id ${id}`,
      lead: e.lead,
      prima: e.prima.toISOString(),
      ultima: e.ultima.toISOString()
    }))
    .sort((a, b) => b.lead - a.lead);

  return { righe, esaminati: ids.length };
}

function aIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const g = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${g}`;
}

/**
 * Il giorno richiesto, dall'archivio quando basta e ricalcolato quando serve.
 *
 * `atteso` e' quanto dichiara l'app: si conserva insieme al conto nostro, cosi'
 * una divergenza resta visibile anche domani, quando l'app avra' azzerato i
 * suoi contatori giornalieri e il confronto non si potrebbe piu' rifare.
 */
export async function leggiGiorno(
  token: string,
  opzioni: { giorno?: Date; atteso?: number | null; forza?: boolean } = {}
): Promise<Giorno> {
  const giorno = opzioni.giorno ?? new Date();
  const chiave = aIso(giorno);
  const oggi = chiave === aIso(new Date());
  const db = getDb();

  const { rows: calcolo } = await db.query<{
    aggiornato_at: Date;
    totale: number;
    persone: number;
    atteso: number | null;
  }>(
    `SELECT aggiornato_at, totale, persone, atteso
       FROM assegnazione_giorno_calcolo WHERE giorno = $1`,
    [chiave]
  );

  const vecchio =
    !calcolo.length ||
    Date.now() - new Date(calcolo[0].aggiornato_at).getTime() > FRESCHEZZA_MINUTI * 60_000;

  // I GIORNI PASSATI NON SI RICALCOLANO MAI (vedi calcola()): quello che c'e'
  // in archivio e' l'unica versione fedele che avremo. Se non c'e', non c'e'.
  const daRifare = oggi && (opzioni.forza || vecchio);

  if (daRifare) {
    const { righe, esaminati } = await calcola(token, giorno);
    const totale = righe.reduce((s, r) => s + r.lead, 0);
    const ora = new Date().toISOString();

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Si cancella e si riscrive: il calcolo e' sempre l'intera giornata, e
      // una persona che sparisce dal risultato deve sparire anche qui.
      await client.query(`DELETE FROM assegnazione_giorno WHERE giorno = $1`, [chiave]);
      for (const r of righe) {
        await client.query(
          `INSERT INTO assegnazione_giorno (giorno, proprietario_id, lead, prima, ultima)
           VALUES ($1, $2, $3, $4, $5)`,
          [chiave, r.proprietarioId, r.lead, r.prima, r.ultima]
        );
      }
      await client.query(
        `INSERT INTO assegnazione_giorno_calcolo
           (giorno, aggiornato_at, totale, persone, contatti_esaminati, atteso)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (giorno) DO UPDATE SET
           aggiornato_at = EXCLUDED.aggiornato_at,
           totale = EXCLUDED.totale,
           persone = EXCLUDED.persone,
           contatti_esaminati = EXCLUDED.contatti_esaminati,
           atteso = COALESCE(EXCLUDED.atteso, assegnazione_giorno_calcolo.atteso)`,
        [chiave, ora, totale, righe.length, esaminati, opzioni.atteso ?? null]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return {
      giorno: chiave,
      righe,
      totale,
      persone: righe.length,
      atteso: opzioni.atteso ?? null,
      aggiornatoAt: ora,
      dallArchivio: false
    };
  }

  const { rows } = await db.query<{
    proprietario_id: string;
    lead: number;
    prima: Date | null;
    ultima: Date | null;
  }>(
    `SELECT proprietario_id, lead, prima, ultima
       FROM assegnazione_giorno WHERE giorno = $1 ORDER BY lead DESC`,
    [chiave]
  );

  // Niente righe E niente riga di calcolo: il giorno non e' mai stato
  // fotografato. Non e' uno zero, e chi legge deve poterlo distinguere.
  if (!rows.length && !calcolo.length) {
    return {
      giorno: chiave,
      righe: [],
      totale: 0,
      persone: 0,
      atteso: opzioni.atteso ?? null,
      aggiornatoAt: "",
      dallArchivio: true
    };
  }

  const nomi = await nomiProprietari(token).catch(() => new Map<string, string>());
  return {
    giorno: chiave,
    righe: rows.map((r) => ({
      proprietarioId: String(r.proprietario_id),
      nome: nomi.get(String(r.proprietario_id)) ?? `id ${r.proprietario_id}`,
      lead: r.lead,
      prima: r.prima ? new Date(r.prima).toISOString() : null,
      ultima: r.ultima ? new Date(r.ultima).toISOString() : null
    })),
    totale: calcolo[0]?.totale ?? rows.reduce((s, r) => s + r.lead, 0),
    persone: calcolo[0]?.persone ?? rows.length,
    atteso: opzioni.atteso ?? calcolo[0]?.atteso ?? null,
    aggiornatoAt: calcolo[0] ? new Date(calcolo[0].aggiornato_at).toISOString() : "",
    dallArchivio: true
  };
}
