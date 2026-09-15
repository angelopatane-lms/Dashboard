import { getDb } from "@/lib/db";
import { leggiFrasi } from "@/lib/fireflies";
import { chiEraInCall, type Frase } from "@/lib/presenza";
import type { Abbinamento, Registrazione } from "@/lib/abbinamento";

/**
 * Registra, per ogni appuntamento abbinato, se il cliente si e' presentato.
 *
 * E' il pezzo che rende l'agenda viva durante la giornata: il dato delle
 * trattative arriva quando l'advisor sposta la fase, e misurato sui no show di
 * settembre questo accade fra le 18:00 e le 19:46. Le voci nella registrazione
 * lo dicono due minuti dopo la fine della call.
 *
 * NON TOCCA trattativa.svolta_ts. Quella colonna alimenta Consulenze nella
 * pagina Campagne e ha una definizione precisa - i criteri del workflow
 * HubSpot. Mescolarci dentro una seconda definizione cambierebbe la metrica in
 * silenzio, e i numeri smetterebbero di tornare con i report di HubSpot senza
 * che nessuno capisca perche'. Questo dato vive per conto suo e serve alla
 * vista operativa, non al conteggio.
 */

/** Quanto aspettare fra una lettura e l'altra su Fireflies. */
const PAUSA_MS = 280;

export type EsitoPresenze = { nuove: number; gia: number; falliti: number };

export async function registraPresenze(
  chiaveFireflies: string,
  abbinamenti: Abbinamento[],
  registrazioni: Registrazione[]
): Promise<EsitoPresenze> {
  const esito: EsitoPresenze = { nuove: 0, gia: 0, falliti: 0 };
  if (!abbinamenti.length) return esito;

  const db = getDb();

  // SI RICALCOLA SOLO QUELLO CHE NON C'E' GIA'. Ogni consegna del webhook
  // rilancia l'abbinamento su dodici ore, quindi senza questo controllo le
  // stesse dieci registrazioni verrebbero riscaricate a ogni call che finisce -
  // e a fine giornata sono decine di letture inutili, con un tetto di sessanta
  // al minuto. La chiave comprende la trascrizione: se a un appuntamento viene
  // abbinata una registrazione diversa, si ricalcola.
  const gia = await db.query(
    `SELECT riunione_id, trascrizione FROM presenza_call WHERE riunione_id = ANY($1::text[])`,
    [abbinamenti.map((x) => x.riunione.id)]
  );
  const fatte = new Set(gia.rows.map((r: { riunione_id: string; trascrizione: string }) =>
    `${r.riunione_id}|${r.trascrizione}`));

  const frasiDi = new Map<string, Frase[]>();
  for (const r of registrazioni) if (r.frasi) frasiDi.set(r.id, r.frasi);

  for (const x of abbinamenti) {
    if (fatte.has(`${x.riunione.id}|${x.registrazione.id}`)) {
      esito.gia++;
      continue;
    }

    // Le frasi possono essere gia' state lette dall'abbinamento, che le chiede
    // dove una registrazione copre piu' appuntamenti: in quel caso si riusano.
    let frasi = frasiDi.get(x.registrazione.id);
    if (!frasi) {
      try {
        frasi = await leggiFrasi(chiaveFireflies, x.registrazione.id);
        frasiDi.set(x.registrazione.id, frasi);
        await new Promise((r) => setTimeout(r, PAUSA_MS));
      } catch (e) {
        console.error(
          `[presenze] frasi non leggibili per ${x.registrazione.id}:`,
          e instanceof Error ? e.message : e
        );
        esito.falliti++;
        continue;
      }
    }

    const p = chiEraInCall(frasi, x.daSec, x.aSec, x.riunione.contattoNome);

    try {
      // LA DURATA SI SALVA ANCHE SE OGGI NON LA USA NESSUNO. La colonna Resa
      // stima le ore a 45 minuti per consulenza, perche' le registrazioni
      // coprono solo un terzo delle consulenze e su un terzo non si costruisce
      // un denominatore. Il giorno in cui le postazioni saranno tutte a posto
      // si passera' alle durate vere - e a quel punto serviranno i mesi
      // precedenti, non solo quelli successivi. La durata e' gia' dentro la
      // risposta che leggiamo: conservarla ora costa una colonna, ricostruirla
      // dopo sarebbe impossibile.
      const durata = x.aSec > x.daSec ? (x.aSec - x.daSec) / 60 : x.registrazione.durataMin;

      await db.query(
        `INSERT INTO presenza_call
           (riunione_id, contatto_id, trascrizione, esito, motivo, voci, quota_secondo, inizio_ts, durata_min, aggiornato_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (riunione_id) DO UPDATE
           SET contatto_id = EXCLUDED.contatto_id,
               trascrizione = EXCLUDED.trascrizione,
               esito = EXCLUDED.esito,
               motivo = EXCLUDED.motivo,
               voci = EXCLUDED.voci,
               quota_secondo = EXCLUDED.quota_secondo,
               inizio_ts = EXCLUDED.inizio_ts,
               durata_min = EXCLUDED.durata_min,
               aggiornato_at = now()`,
        [
          x.riunione.id,
          x.riunione.contattoId ? Number(x.riunione.contattoId) : null,
          x.registrazione.id,
          p.esito,
          p.motivo,
          p.voci,
          p.quotaSecondo,
          new Date(x.riunione.inizio),
          Math.round(durata * 10) / 10
        ]
      );
      esito.nuove++;
    } catch (e) {
      console.error("[presenze] scrittura fallita:", e instanceof Error ? e.message : e);
      esito.falliti++;
    }
  }

  return esito;
}
