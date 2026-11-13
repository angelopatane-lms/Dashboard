/**
 * DA DOVE NASCE UN'ASSEGNAZIONE: chi ha cambiato il proprietario.
 *
 * PERCHE' NON BASTA GUARDARE IL LEAD. Per sapere quali assegnazioni vengono
 * dal marketing abbiamo provato, il 13 novembre 2026, tutti i segnali
 * indiretti che il contatto porta con se': quanto e' recente la conversione,
 * quando e' cambiato `id_campagna_refresh`, il countdown e `dispatch_outcome`
 * com'erano al momento del cambio di mano. Nessuno separa, e ognuno sbaglia da
 * una parte diversa - su 46 assegnazioni con la campagna cambiata nell'ultima
 * ora solo 22 venivano dai flussi, e un quarto delle assegnazioni dei flussi
 * ha la campagna vecchia, perche' i flussi ripescano anche lead gia' in casa.
 *
 * QUELLO CHE SEPARA E' CHI HA FATTO IL GESTO, e HubSpot lo registra: ogni
 * voce della cronologia di `hubspot_owner_id` porta un `sourceType` e un
 * `sourceId`. Da li' escono le categorie che si leggono in pagina:
 *
 *   flusso        AUTOMATION_PLATFORM - i workflow, cioe' le assegnazioni
 *                 automatiche che seguono una conversione o una riconversione:
 *                 e' questo che in pagina si chiama "dal marketing";
 *   app           l'app di riassegnazione di Alessio (integrazione 6848397):
 *                 il setter CHIEDE i lead, non gli arrivano;
 *   integrazione  un'altra applicazione collegata - un bot, Zapier - col suo
 *                 numero, che resta scritto per poterla riconoscere;
 *   manuale       CRM_UI e CRM_UI_BULK_ACTION: una persona, dall'interfaccia,
 *                 da sola o in blocco;
 *   fusione       MERGE_OBJECTS: due schede unite, e il proprietario cambia
 *                 per conseguenza. Non e' un'assegnazione vera.
 *
 * IL 7% NON SI AGGANCIA: contatti cancellati o fusi dopo, per cui la
 * cronologia non ha nessuna voce entro dieci minuti dall'evento che il foglio
 * ha registrato. Restano con origine vuota e in pagina non si contano: meglio
 * un pezzo dichiarato mancante di un numero gonfiato.
 */
import type { Pool } from "pg";

const HUB = "https://api.hubapi.com";

/** L'app di riassegnazione di Alessio, che ha una categoria sua. */
export const APP_ASSEGNAZIONE = "6848397";

/** Quanto lontano puo' stare la voce di cronologia dall'evento del foglio. */
const VICINANZA_MS = 10 * 60 * 1000;

export type Origine = "flusso" | "app" | "integrazione" | "manuale" | "fusione" | "altro";

export function categoria(sourceType: string, sourceId: string): { origine: Origine; id: string } {
  const st = (sourceType ?? "").toUpperCase();
  const sid = (sourceId ?? "").split(";")[0].trim();
  if (st === "AUTOMATION_PLATFORM") return { origine: "flusso", id: "" };
  if (st === "MERGE_OBJECTS") return { origine: "fusione", id: "" };
  if (st === "CRM_UI" || st === "CRM_UI_BULK_ACTION") return { origine: "manuale", id: sid.replace(/^userId:/, "") };
  if (st === "INTEGRATION") {
    return sid === APP_ASSEGNAZIONE ? { origine: "app", id: sid } : { origine: "integrazione", id: sid };
  }
  return { origine: "altro", id: sid };
}

type Riga = { contatto_id: string; ts: string };

/**
 * Riempie l'origine delle assegnazioni che non ce l'hanno ancora.
 *
 * SI LAVORA A BLOCCHI e si parte dalle piu' recenti: il giro notturno ne
 * sistema un pezzo per volta e in qualche giro l'archivio e' in pari da solo,
 * senza uno script da lanciare a mano. Lo stesso meccanismo con cui si marcano
 * i lead chiesti all'app.
 *
 * UNA LETTURA OGNI CINQUANTA CONTATTI, e la cronologia di una proprieta' sola.
 */
export async function riempiOrigine(
  db: Pool,
  token: string,
  quante: number,
  racconta: (riga: string) => void = () => {}
): Promise<{ guardate: number; scritte: number; senzaAggancio: number }> {
  const { rows } = await db.query<Riga>(
    `SELECT contatto_id::text, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts
       FROM assegnazione_evento
      WHERE origine IS NULL
      ORDER BY ts DESC
      LIMIT $1`,
    [quante]
  );
  if (!rows.length) return { guardate: 0, scritte: 0, senzaAggancio: 0 };

  const perContatto = new Map<string, Riga[]>();
  for (const r of rows) {
    const lista = perContatto.get(r.contatto_id) ?? [];
    lista.push(r);
    perContatto.set(r.contatto_id, lista);
  }
  const ids = [...perContatto.keys()];

  const scritture: Array<{ c: string; t: string; o: string; i: string }> = [];
  let senzaAggancio = 0;

  for (let i = 0; i < ids.length; i += 50) {
    const blocco = ids.slice(i, i + 50);
    const r = await fetch(`${HUB}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        propertiesWithHistory: ["hubspot_owner_id"],
        properties: ["hubspot_owner_id"],
        inputs: blocco.map((id) => ({ id }))
      })
    });
    if (!r.ok) {
      racconta(`  HubSpot ha risposto ${r.status}: mi fermo e riprendo al giro prossimo`);
      break;
    }
    const d = (await r.json()) as {
      results?: Array<{
        id: string;
        propertiesWithHistory?: { hubspot_owner_id?: Array<{ timestamp: string; sourceType: string; sourceId?: string }> };
      }>;
    };
    const storia = new Map<string, Array<{ timestamp: string; sourceType: string; sourceId?: string }>>();
    for (const x of d.results ?? []) storia.set(x.id, x.propertiesWithHistory?.hubspot_owner_id ?? []);

    for (const id of blocco) {
      const voci = storia.get(id) ?? [];
      for (const riga of perContatto.get(id) ?? []) {
        const quando = Date.parse(riga.ts);
        let vicina: (typeof voci)[0] | null = null;
        let distanza = Infinity;
        for (const v of voci) {
          const d2 = Math.abs(Date.parse(v.timestamp) - quando);
          if (d2 < distanza) {
            distanza = d2;
            vicina = v;
          }
        }
        if (!vicina || distanza > VICINANZA_MS) {
          // SI SCRIVE LO STESSO, con "ignota": altrimenti la riga resta senza
          // origine per sempre e ogni giro la rilegge, pagando la stessa
          // chiamata all'infinito.
          scritture.push({ c: riga.contatto_id, t: riga.ts, o: "ignota", i: "" });
          senzaAggancio++;
          continue;
        }
        const { origine, id: idOrigine } = categoria(vicina.sourceType, vicina.sourceId ?? "");
        scritture.push({ c: riga.contatto_id, t: riga.ts, o: origine, i: idOrigine });
      }
    }
  }

  for (let i = 0; i < scritture.length; i += 500) {
    await db.query(
      `UPDATE assegnazione_evento a
          SET origine = x.o, origine_id = NULLIF(x.i, '')
         FROM jsonb_to_recordset($1::jsonb) AS x(c text, t text, o text, i text)
        WHERE a.contatto_id = x.c::bigint AND a.ts = x.t::timestamptz`,
      [JSON.stringify(scritture.slice(i, i + 500))]
    );
  }

  racconta(`  origine: ${rows.length} righe guardate, ${scritture.length} scritte, ${senzaAggancio} senza aggancio`);
  return { guardate: rows.length, scritte: scritture.length, senzaAggancio };
}
