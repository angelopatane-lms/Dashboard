import { getDb } from "@/lib/db";
import {
  cercaContattiRilevanti,
  filtroModificatoDa,
  leggiCronologiaContatti,
  type VoceCronologia
} from "./hubspotSync";

type Evento = { contactId: number; campagna: string; ts: Date; posizione: number };

type ContattoDaScrivere = {
  contactId: number;
  eventi: Evento[];
  mergedIds: number[];
};

function estraiEventi(contactId: number, history: VoceCronologia[]): Evento[] {
  const grezzi = history
    .map((v) => ({ contactId, campagna: (v.value ?? "").trim(), ts: new Date(v.timestamp) }))
    .filter((e) => e.campagna && !Number.isNaN(e.ts.getTime()));

  // La cronologia HubSpot non garantisce l'ordine: ordiniamo per data prima
  // di assegnare la posizione (1 = prima conversione assoluta del contatto).
  grezzi.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return grezzi.map((e, i) => ({ ...e, posizione: i + 1 }));
}

// Cache nome campagna -> id, viva per tutta la durata del processo. Le campagne
// sono poche centinaia, quindi dopo i primi blocchi non si interroga quasi piu'
// il database.
const idCampagne = new Map<string, number>();

/**
 * Risolve (creandoli se mancano) gli id delle campagne citate nel blocco.
 * Due statement per blocco invece di uno per riga.
 *
 * Volutamente FUORI dalla transazione che scrive gli eventi: se quella andasse
 * in rollback, gli id appena creati sparirebbero dal database ma resterebbero
 * nella cache in memoria, e il blocco successivo inserirebbe eventi con una
 * campagna_id inesistente. Le righe di `campagna` sono solo additive: una
 * campagna creata e poi non usata e' innocua.
 */
async function risolviIdCampagne(nomi: string[]): Promise<void> {
  const mancanti = Array.from(new Set(nomi.filter((n) => !idCampagne.has(n))));
  if (!mancanti.length) return;

  const db = getDb();

  // ON CONFLICT DO NOTHING non restituisce le righe gia' esistenti, quindi
  // dopo l'inserimento rileggiamo comunque tutti i nomi mancanti.
  await db.query(
    `INSERT INTO campagna (nome) SELECT DISTINCT unnest($1::text[]) ON CONFLICT (nome) DO NOTHING`,
    [mancanti]
  );

  const { rows } = await db.query(`SELECT id, nome FROM campagna WHERE nome = ANY($1::text[])`, [
    mancanti
  ]);

  for (const r of rows) idCampagne.set(r.nome as string, r.id as number);

  const irrisolte = mancanti.filter((n) => !idCampagne.has(n));
  if (irrisolte.length) {
    throw new Error(`Impossibile risolvere l'id di ${irrisolte.length} campagne (es. "${irrisolte[0]}")`);
  }
}

/**
 * Scrive un intero blocco di contatti in UNA sola transazione.
 *
 * La versione precedente apriva una connessione e una transazione per ogni
 * singolo contatto (BEGIN/DELETE/INSERT/COMMIT = 4 round trip a testa): su
 * ~570.000 contatti significavano oltre 2 milioni di viaggi di rete, cioe'
 * 10-20 ore di bootstrap. Raggruppando per blocchi di 100 il costo di rete
 * scende di due ordini di grandezza.
 *
 * Tutti gli INSERT usano UNNEST su array: il numero di parametri resta fisso
 * qualunque sia il numero di righe, quindi non si rischia di sbattere contro
 * il limite di 65.535 parametri per statement.
 */
async function scriviBlocco(
  contatti: ContattoDaScrivere[],
  tipo: TipoSync,
  checkpointId: number,
  totali: { contatti: number; eventi: number }
): Promise<void> {
  const tuttiEventi = contatti.flatMap((c) => c.eventi);
  await risolviIdCampagne(tuttiEventi.map((e) => e.campagna));

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Si cancella solo per i contatti effettivamente riletti da HubSpot, mai
    // per quelli saltati: riscrivere significa prima azzerare lo storico
    // precedente di quel contatto.
    const contactIds = contatti.map((c) => c.contactId);
    await client.query(`DELETE FROM eventi_conversione WHERE contact_id = ANY($1::bigint[])`, [
      contactIds
    ]);

    if (tuttiEventi.length) {
      await client.query(
        `INSERT INTO eventi_conversione (contact_id, campagna_id, ts, posizione)
         SELECT * FROM UNNEST($1::bigint[], $2::int[], $3::timestamptz[], $4::int[])
         ON CONFLICT DO NOTHING`,
        [
          tuttiEventi.map((e) => e.contactId),
          tuttiEventi.map((e) => idCampagne.get(e.campagna)),
          tuttiEventi.map((e) => e.ts),
          tuttiEventi.map((e) => e.posizione)
        ]
      );
    }

    // hs_merged_object_ids: mai cancellare eventi dei vecchi ID, solo
    // registrare che ora puntano a questo contatto (per la risoluzione in
    // lettura). I dati storici di quei vecchi ID restano intatti.
    //
    // La deduplica per vecchio_id non e' facoltativa: "ON CONFLICT DO UPDATE"
    // fallisce con "cannot affect row a second time" se la stessa chiave
    // compare due volte nello STESSO statement. Prima le scritture erano una
    // per alias e il caso era innocuo; ora che il blocco e' unico un id
    // ripetuto farebbe abortire l'intera transazione - e siccome il
    // checkpoint non avanzerebbe, ogni ripartenza ricadrebbe sullo stesso
    // blocco all'infinito.
    const alias = new Map<number, number>();
    for (const c of contatti) {
      for (const v of c.mergedIds) alias.set(v, c.contactId);
    }
    if (alias.size) {
      await client.query(
        `INSERT INTO alias_contatto (vecchio_id, nuovo_id)
         SELECT * FROM UNNEST($1::bigint[], $2::bigint[])
         ON CONFLICT (vecchio_id) DO UPDATE SET nuovo_id = EXCLUDED.nuovo_id`,
        [Array.from(alias.keys()), Array.from(alias.values())]
      );
    }

    // Il punto di ripresa si sposta nella STESSA transazione che scrive i dati:
    // o entrambi o nessuno dei due, quindi non puo' restare avanti rispetto a
    // cio' che e' stato effettivamente salvato.
    //
    // Solo per il bootstrap: vedi usaCheckpoint().
    if (usaCheckpoint(tipo)) {
      await client.query(
        `INSERT INTO sync_checkpoint (tipo, ultimo_id, contatti, eventi, aggiornato_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (tipo) DO UPDATE
           SET ultimo_id = EXCLUDED.ultimo_id,
               contatti = EXCLUDED.contatti,
               eventi = EXCLUDED.eventi,
               aggiornato_at = now()`,
        [tipo, checkpointId, totali.contatti, totali.eventi]
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

/**
 * Il punto di ripresa vale SOLO per il bootstrap.
 *
 * Riprendere per id e' corretto solo se il filtro della scansione e' lo stesso
 * dell'esecuzione interrotta. Per il bootstrap lo e' (nessun filtro oltre a
 * HAS_PROPERTY). Per i cron NO: il loro filtro e' temporale ("modificato da...")
 * o di stato, e viene ricalcolato a ogni esecuzione. Un cron ucciso dal limite
 * di 60 secondi lascerebbe un checkpoint che fa saltare all'esecuzione
 * successiva tutti i contatti con id piu' basso - i quali, essendo la finestra
 * temporale nel frattempo avanzata, non verrebbero MAI piu' ripresi. Perdita
 * di dati silenziosa.
 *
 * I cron sono brevi e idempotenti: rifarli da capo costa poco ed e' corretto.
 */
function usaCheckpoint(tipo: TipoSync): boolean {
  return tipo === "bootstrap";
}

async function leggiCheckpoint(tipo: TipoSync): Promise<{
  ultimoId: number;
  contatti: number;
  eventi: number;
} | null> {
  if (!usaCheckpoint(tipo)) return null;

  const db = getDb();
  const { rows } = await db.query(
    `SELECT ultimo_id, contatti, eventi FROM sync_checkpoint WHERE tipo = $1`,
    [tipo]
  );
  if (!rows[0]) return null;
  return {
    ultimoId: Number(rows[0].ultimo_id),
    contatti: Number(rows[0].contatti),
    eventi: Number(rows[0].eventi)
  };
}

// "prova" si comporta esattamente come "bootstrap" (nessun filtro extra) ma e'
// un tipo distinto di proposito: le sue righe in sync_log e il suo eventuale
// checkpoint restano separati, cosi' una prova da 500 contatti non puo' far
// sembrare completato il bootstrap vero ne' fargli saltare dei contatti.
export type TipoSync = "bootstrap" | "prova" | "incrementale";
export type EsitoSync = { contatti: number; eventi: number; ripreso: boolean };

export type OpzioniSync = {
  /** Chiamata dopo ogni blocco scritto: serve allo script di bootstrap per
   *  stampare l'avanzamento di una scansione che dura ore. */
  onProgresso?: (stato: { contatti: number; eventi: number; ultimoId: number }) => void;
  /** Ferma la scansione dopo N contatti. Serve solo alla modalita' di prova:
   *  il bootstrap vero non lo passa mai. */
  limite?: number;
};

// - "incrementale" (ogni ora): solo i contatti segnalati come cambiati
//   dall'ultima esecuzione riuscita (data_ultima_modifica_campagna_refresh).
// Una riconciliazione completa si ottiene rilanciando il bootstrap: e' la
// stessa scansione, idempotente, e reintegra qualunque conversione sfuggita.
// - "bootstrap" (una tantum, manuale, vedi scripts/bootstrap-campaign-conversions.ts):
//   nessun filtro extra oltre a HAS_PROPERTY(id_campagna_refresh) - copre
//   TUTTA la popolazione, perche' e' l'unica esecuzione che deve garantire
//   di non perdere nessuno storico pregresso. Da lanciare come script
//   locale, non tramite Vercel (supera abbondantemente i limiti di timeout).
//
// Solo il bootstrap salva un punto di ripresa (vedi usaCheckpoint): e' l'unico
// abbastanza lungo da doversi poter interrompere, e l'unico il cui filtro di
// scansione non cambia fra un'esecuzione e l'altra.
export async function eseguiSync(
  tipo: TipoSync,
  token: string,
  opzioni: OpzioniSync = {}
): Promise<EsitoSync> {
  const db = getDb();
  const {
    rows: [log]
  } = await db.query(`INSERT INTO sync_log (tipo) VALUES ($1) RETURNING id`, [tipo]);

  const checkpoint = await leggiCheckpoint(tipo);
  let nContatti = checkpoint?.contatti ?? 0;
  let nEventi = checkpoint?.eventi ?? 0;

  try {
    // Solo l'incrementale filtra: bootstrap e prova scansionano tutta la
    // popolazione con id_campagna_refresh valorizzata.
    const filtriExtra =
      tipo === "incrementale" ? [filtroModificatoDa(await dataUltimaEsecuzioneIncrementale())] : [];

    for await (const batch of cercaContattiRilevanti(token, filtriExtra, checkpoint?.ultimoId ?? 0)) {
      // In modalita' di prova si taglia l'ultimo blocco per fermarsi esattamente
      // al numero richiesto, cosi' le medie misurate sono su un campione noto.
      const rimanenti = opzioni.limite ? opzioni.limite - nContatti : Infinity;
      const ids = batch.map((c) => c.id).slice(0, Math.max(0, rimanenti));
      if (!ids.length) break;

      const dettagli = await leggiCronologiaContatti(token, ids);

      const daScrivere: ContattoDaScrivere[] = [];
      for (const idStr of ids) {
        const info = dettagli.get(idStr);
        if (!info) continue;

        const contactId = Number(idStr);
        daScrivere.push({
          contactId,
          eventi: estraiEventi(contactId, info.history),
          mergedIds: info.mergedIds
        });
      }

      // hs_object_id dell'ultimo contatto del blocco: la ricerca pagina per
      // hs_object_id crescente, quindi e' il punto da cui riprendere.
      const ultimoId = Number(ids[ids.length - 1]);
      const totaliBlocco = {
        contatti: nContatti + ids.length,
        eventi: nEventi + daScrivere.reduce((acc, c) => acc + c.eventi.length, 0)
      };

      if (daScrivere.length) {
        await scriviBlocco(daScrivere, tipo, ultimoId, totaliBlocco);
      }

      nContatti = totaliBlocco.contatti;
      nEventi = totaliBlocco.eventi;
      opzioni.onProgresso?.({ contatti: nContatti, eventi: nEventi, ultimoId });

      if (opzioni.limite && nContatti >= opzioni.limite) break;
    }

    // Prima si cancella il punto di ripresa, poi si marca l'esecuzione come
    // riuscita. L'ordine conta: se il processo muore fra le due istruzioni,
    // il checkpoint e' gia' sparito e la riesecuzione riparte da capo
    // (spreco di tempo, dati corretti). Nell'ordine opposto resterebbe un
    // checkpoint orfano che farebbe saltare tutti i contatti precedenti.
    await db.query(`DELETE FROM sync_checkpoint WHERE tipo = $1`, [tipo]);

    await db.query(
      `UPDATE sync_log SET finito_at = now(), contatti = $2, eventi = $3, esito = 'ok' WHERE id = $1`,
      [log.id, nContatti, nEventi]
    );

    return { contatti: nContatti, eventi: nEventi, ripreso: checkpoint !== null };
  } catch (err) {
    await db.query(`UPDATE sync_log SET finito_at = now(), esito = 'errore', messaggio = $2 WHERE id = $1`, [
      log.id,
      err instanceof Error ? err.message : String(err)
    ]);
    throw err;
  }
}
