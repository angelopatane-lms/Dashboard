import { getDb } from "@/lib/db";
import {
  cercaContattiRilevanti,
  filtroModificatoDa,
  filtroStatoLeadRilevante,
  leggiCronologiaContatti,
  type VoceCronologia
} from "./hubspotSync";

type Evento = { contactId: number; campagna: string; ts: Date; posizione: number };

function estraiEventi(contactId: number, history: VoceCronologia[]): Evento[] {
  const grezzi = history
    .map((v) => ({ contactId, campagna: (v.value ?? "").trim(), ts: new Date(v.timestamp) }))
    .filter((e) => e.campagna && !Number.isNaN(e.ts.getTime()));

  // La cronologia HubSpot non garantisce l'ordine: ordiniamo per data prima
  // di assegnare la posizione (1 = prima conversione assoluta del contatto).
  grezzi.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return grezzi.map((e, i) => ({ ...e, posizione: i + 1 }));
}

async function scriviContatto(
  contactId: number,
  eventi: Evento[],
  mergedIds: number[]
): Promise<void> {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM eventi_conversione WHERE contact_id = $1", [contactId]);

    if (eventi.length) {
      const values: unknown[] = [];
      const placeholders = eventi
        .map((e, i) => {
          const base = i * 4;
          values.push(e.contactId, e.campagna, e.ts, e.posizione);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
        })
        .join(",");

      await client.query(
        `INSERT INTO eventi_conversione (contact_id, campagna, ts, posizione)
         VALUES ${placeholders}
         ON CONFLICT DO NOTHING`,
        values
      );
    }

    // hs_merged_object_ids: mai cancellare eventi dei vecchi ID, solo
    // registrare che ora puntano a questo contatto (per la risoluzione in
    // lettura). I dati storici di quei vecchi ID restano intatti.
    for (const vecchioId of mergedIds) {
      await client.query(
        `INSERT INTO alias_contatto (vecchio_id, nuovo_id) VALUES ($1, $2)
         ON CONFLICT (vecchio_id) DO UPDATE SET nuovo_id = EXCLUDED.nuovo_id`,
        [vecchioId, contactId]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function dataUltimaEsecuzioneIncrementale(): Promise<string> {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT iniziato_at FROM sync_log WHERE tipo = 'incrementale' AND esito = 'ok'
     ORDER BY iniziato_at DESC LIMIT 1`
  );
  if (rows[0]?.iniziato_at) {
    // margine di sicurezza di 30 minuti, per non perdere modifiche a cavallo
    // dell'esecuzione precedente
    return new Date(new Date(rows[0].iniziato_at).getTime() - 30 * 60_000).toISOString();
  }
  return new Date(Date.now() - 24 * 3600_000).toISOString();
}

export type TipoSync = "bootstrap" | "full" | "incrementale";
export type EsitoSync = { contatti: number; eventi: number };

// - "incrementale" (ogni ora): solo i contatti segnalati come cambiati
//   dall'ultima esecuzione riuscita (data_ultima_modifica_campagna_refresh).
// - "full" (settimanale, rete di sicurezza): filtro leggero su stato_lead,
//   NON tutta la popolazione - va bene che perda qualche caso raro, perche'
//   e' solo un controllo supplementare sopra l'incrementale, non l'unica
//   fonte di verita'.
// - "bootstrap" (una tantum, manuale, vedi scripts/bootstrap-campaign-conversions.ts):
//   nessun filtro extra oltre a HAS_PROPERTY(id_campagna_refresh) - copre
//   TUTTA la popolazione, perche' e' l'unica esecuzione che deve garantire
//   di non perdere nessuno storico pregresso. Da lanciare come script
//   locale, non tramite Vercel (supera abbondantemente i limiti di timeout).
export async function eseguiSync(tipo: TipoSync, token: string): Promise<EsitoSync> {
  const db = getDb();
  const {
    rows: [log]
  } = await db.query(`INSERT INTO sync_log (tipo) VALUES ($1) RETURNING id`, [tipo]);

  let nContatti = 0;
  let nEventi = 0;

  try {
    const filtriExtra =
      tipo === "incrementale"
        ? [filtroModificatoDa(await dataUltimaEsecuzioneIncrementale())]
        : tipo === "full"
          ? [filtroStatoLeadRilevante()]
          : [];

    for await (const batch of cercaContattiRilevanti(token, filtriExtra)) {
      const ids = batch.map((c) => c.id);
      const dettagli = await leggiCronologiaContatti(token, ids);

      for (const idStr of ids) {
        const contactId = Number(idStr);
        const info = dettagli.get(idStr);
        if (!info) continue;

        const eventi = estraiEventi(contactId, info.history);
        await scriviContatto(contactId, eventi, info.mergedIds);
        nEventi += eventi.length;
      }

      nContatti += ids.length;
    }

    await db.query(
      `UPDATE sync_log SET finito_at = now(), contatti = $2, eventi = $3, esito = 'ok' WHERE id = $1`,
      [log.id, nContatti, nEventi]
    );

    return { contatti: nContatti, eventi: nEventi };
  } catch (err) {
    await db.query(`UPDATE sync_log SET finito_at = now(), esito = 'errore', messaggio = $2 WHERE id = $1`, [
      log.id,
      err instanceof Error ? err.message : String(err)
    ]);
    throw err;
  }
}
