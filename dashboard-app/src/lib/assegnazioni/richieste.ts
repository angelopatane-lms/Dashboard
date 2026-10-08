import { getDb } from "@/lib/db";

/**
 * Le richieste di lead, come le racconta l'app che le gestisce.
 *
 * PERCHE' NON SI RICAVANO DA HUBSPOT. Un rifiuto non tocca nessun contatto,
 * quindi su HubSpot non esiste: la meta' di giornata fatta di "no" era
 * invisibile per costruzione. Il 6 ottobre 2026, su sedici richieste, nove non
 * sono state servite, e per sapere il perche' e' servito aprire il database
 * dell'app a mano.
 *
 * PERCHE' NON SI CHIEDONO ALL'APP. Si era valutato di leggerle da `lead_assignments`
 * con una rotta nuova sul suo server: non basta, perche' li' dentro una
 * richiesta rifiutata non lascia righe. L'unico momento in cui quell'informazione
 * esiste e' l'istante della decisione, e in quell'istante solo l'app ce l'ha.
 */

export type Richiesta = {
  id: string;
  chiestoAt: string;
  nome: string | null;
  ruolo: string | null;
  esito: string;
  motivo: string | null;
  lead: number;
  serie: string | null;
  richiestaN: number | null;
  pendenti: number | null;
  appuntamenti: number | null;
};

/** Quello che l'app ci manda. Tutto facoltativo tranne l'identificativo. */
export type RichiestaInArrivo = {
  id?: unknown;
  chiesto_at?: unknown;
  slack_user?: unknown;
  employee_id?: unknown;
  nome?: unknown;
  ruolo?: unknown;
  esito?: unknown;
  motivo?: unknown;
  lead?: unknown;
  serie?: unknown;
  richiesta_n?: unknown;
  pendenti?: unknown;
  appuntamenti?: unknown;
  contatti?: unknown;
};

function testo(v: unknown, max = 500): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Scrive una richiesta, o riscrive quella che c'era con lo stesso id.
 *
 * RISCRIVE INVECE DI AGGIUNGERE perche' l'app puo' riprovare: un tentativo
 * ripetuto non deve diventare una seconda richiesta. E' la stessa ragione per
 * cui la cronologia degli Stati Lead ha una chiave composta.
 */
export async function scriviRichiesta(d: RichiestaInArrivo): Promise<{ id: string }> {
  const id = testo(d.id, 200);
  if (!id) throw new Error("manca l'identificativo della richiesta");

  const quando = testo(d.chiesto_at, 40);
  const istante = quando && !Number.isNaN(Date.parse(quando)) ? new Date(quando) : new Date();

  // L'esito si normalizza ma non si traduce: un valore inatteso si conserva
  // com'e' invece di diventare "rifiutato" per difetto, che sarebbe
  // un'affermazione inventata su una richiesta vera.
  const esito = (testo(d.esito, 30) ?? "sconosciuto").toLowerCase();

  const contatti = Array.isArray(d.contatti)
    ? d.contatti.map((x) => numero(x)).filter((x): x is number => x !== null)
    : null;

  await getDb().query(
    `INSERT INTO assegnazione_richiesta
       (id, giorno, chiesto_at, slack_user, employee_id, nome, ruolo, esito, motivo,
        lead, serie, richiesta_n, pendenti, appuntamenti, contatti, ricevuto_at)
     VALUES ($1, ($2::timestamptz AT TIME ZONE 'Europe/Rome')::date, $2::timestamptz,
             $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
     ON CONFLICT (id) DO UPDATE SET
       chiesto_at = EXCLUDED.chiesto_at, giorno = EXCLUDED.giorno,
       slack_user = EXCLUDED.slack_user, employee_id = EXCLUDED.employee_id,
       nome = EXCLUDED.nome, ruolo = EXCLUDED.ruolo, esito = EXCLUDED.esito,
       motivo = EXCLUDED.motivo, lead = EXCLUDED.lead, serie = EXCLUDED.serie,
       richiesta_n = EXCLUDED.richiesta_n, pendenti = EXCLUDED.pendenti,
       appuntamenti = EXCLUDED.appuntamenti, contatti = EXCLUDED.contatti,
       ricevuto_at = now()`,
    [
      id,
      istante.toISOString(),
      testo(d.slack_user, 50),
      numero(d.employee_id),
      testo(d.nome, 120),
      testo(d.ruolo, 60),
      esito,
      testo(d.motivo, 1000),
      numero(d.lead) ?? 0,
      testo(d.serie, 30),
      numero(d.richiesta_n),
      numero(d.pendenti),
      numero(d.appuntamenti),
      contatti
    ]
  );
  return { id };
}

/**
 * Le richieste di una giornata, dalla piu' recente.
 *
 * IL GIORNO E' QUELLO ITALIANO, non quello del database, che e' in GMT:
 * altrimenti una richiesta delle 00:30 finirebbe nel giorno prima.
 */
export async function leggiRichieste(giornoIso?: string): Promise<Richiesta[]> {
  const { rows } = await getDb().query<{
    id: string;
    chiesto_at: Date;
    nome: string | null;
    ruolo: string | null;
    esito: string;
    motivo: string | null;
    lead: number;
    serie: string | null;
    richiesta_n: number | null;
    pendenti: number | null;
    appuntamenti: number | null;
  }>(
    `SELECT id, chiesto_at, nome, ruolo, esito, motivo, lead, serie,
            richiesta_n, pendenti, appuntamenti
       FROM assegnazione_richiesta
      WHERE giorno = COALESCE($1::date,
            (now() AT TIME ZONE 'Europe/Rome')::date)
      ORDER BY chiesto_at DESC`,
    [giornoIso ?? null]
  );
  return rows.map((r) => ({
    id: r.id,
    chiestoAt: new Date(r.chiesto_at).toISOString(),
    nome: r.nome,
    ruolo: r.ruolo,
    esito: r.esito,
    motivo: r.motivo,
    lead: Number(r.lead),
    serie: r.serie,
    richiestaN: r.richiesta_n,
    pendenti: r.pendenti,
    appuntamenti: r.appuntamenti
  }));
}
