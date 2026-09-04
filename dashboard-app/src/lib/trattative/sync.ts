// Sincronizzazione delle trattative della pipeline "Appuntamenti (High Ticket)",
// per ricavare Appuntamenti e Consulenze per campagna.
//
// IL PROBLEMA CHE RISOLVE: la data in cui una consulenza e' stata svolta non e'
// leggibile dallo stato attuale della trattativa. Il workflow "Performance
// Tracker - Trattative Svolte" decide su fase_precedente, dealstage e motivo,
// che cambiano a ogni passaggio successivo: guardandoli oggi non si saprebbe
// piu' se e quando l'incontro e' avvenuto. Si legge quindi la CRONOLOGIA delle
// fasi, si applica la regola a ogni transizione in ordine cronologico, e si
// salva la data della PRIMA che la soddisfa.
//
// I CRITERI NON SONO SCRITTI QUI: vengono letti dal workflow via API, cosi' una
// modifica su HubSpot si riflette al sync successivo senza toccare il codice.

import { getDb } from "@/lib/db";

const HUBSPOT_API = "https://api.hubapi.com";
const FLOW_TRATTATIVE_SVOLTE = "4640743658";
export const PIPELINE_APPUNTAMENTI = "433643709";

// "Fase Precedente (Sergente)": e' il cambio di questa proprieta' a innescare il
// workflow, quindi ogni sua voce di cronologia e' una transizione da valutare.
// NON confondere con "provamultiriga", etichettata "Fase precedente", che e' un
// campo di testo libero inutilizzato.
const FASE_PRECEDENTE_SERGENTE = "fase_precedente";

// Le letture con cronologia accettano al massimo 50 input per volta.
const MAX_INPUT_STORICO = 50;

type Voce = { value: string; timestamp: string };
type Filtro = { proprieta: string; operatore: string; valori: string[] };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function chiamaHubSpot<T>(
  token: string,
  url: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {})
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

/** I gruppi di criteri del workflow, letti da HubSpot. Sono in OR fra loro. */
export async function leggiCriteriSvolte(token: string): Promise<Filtro[][]> {
  const flow = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/automation/v4/flows/${FLOW_TRATTATIVE_SVOLTE}`);
  const rc = flow.enrollmentCriteria?.refinementCriteria;

  if (rc?.filterBranchOperator && rc.filterBranchOperator !== "OR") {
    throw new Error(
      `I gruppi del workflow sono in ${rc.filterBranchOperator}, non in OR: la valutazione qui assume OR e darebbe risultati sbagliati.`
    );
  }

  return (rc?.filterBranches ?? []).map((b: any) =>
    (b.filters ?? []).map((f: any) => ({
      proprieta: f.property,
      operatore: f.operation.operator,
      valori: f.operation.values ?? (f.operation.value !== undefined ? [String(f.operation.value)] : [])
    }))
  );
}

function gruppoSoddisfatto(filtri: Filtro[], stato: Record<string, string>): boolean {
  for (const f of filtri) {
    const v = stato[f.proprieta] ?? "";
    if (f.operatore === "IS_ANY_OF") {
      if (!f.valori.includes(v)) return false;
    } else if (f.operatore === "IS_NONE_OF") {
      if (f.valori.includes(v)) return false;
    } else if (f.operatore === "IS_KNOWN") {
      if (!v) return false;
    } else {
      // Meglio fermarsi che dichiarare "svolta" una transizione che non
      // sappiamo valutare: un criterio nuovo su HubSpot deve farci accorgere.
      throw new Error(`Operatore non gestito nei criteri del workflow: ${f.operatore} su ${f.proprieta}`);
    }
  }
  return true;
}

function valoreAl(storico: Voce[], istante: number): string {
  let scelto = "";
  let migliore = -Infinity;
  for (const v of storico) {
    const t = new Date(v.timestamp).getTime();
    if (t <= istante && t > migliore) {
      migliore = t;
      scelto = (v.value ?? "").trim();
    }
  }
  return scelto;
}

/**
 * Data della prima consulenza svolta, o null se non e' mai avvenuta.
 *
 * PERCHE' NON SI USA LA PROPRIETA' fase_precedente: e' mantenuta dal workflow
 * "Sergente", creato il 1 agosto 2026, quindi per le trattative precedenti e'
 * semplicemente vuota (misurato: 0% di cronologia da gennaio a luglio, 90% da
 * agosto). Usandola si perderebbero sette mesi di consulenze.
 *
 * La cronologia di dealstage invece c'e' per il 100% delle trattative, e la
 * fase precedente sono le coppie consecutive: quando la trattativa passa da A
 * a B, la fase precedente e' A. L'unica finezza e' che fase_precedente
 * distingue "Ripianificata (No Show)" da "Ripianificata (Trattativa)", mentre
 * dealstage ha una sola "Ripianificata": la variante si ricava dal Motivo in
 * quell'istante, che vale esattamente "Mancata Presenza" o "Trattativa".
 *
 * Ricostruzione verificata dove esistono entrambi (agosto-settembre 2026):
 * coincide nel 97,5% dei confronti.
 */
function primaSvolta(
  gruppi: Filtro[][],
  storici: Record<string, Voce[]>,
  correnti: Record<string, string>,
  etichettaFase: Map<string, string>
): Date | null {
  const fasi = [...(storici.dealstage ?? [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (let i = 1; i < fasi.length; i++) {
    const t = new Date(fasi[i].timestamp).getTime();
    if (Number.isNaN(t)) continue;

    const motivo = valoreAl(storici.motivo ?? [], t);
    const precedente = etichettaFase.get((fasi[i - 1].value ?? "").trim()) ?? "";
    const faseP =
      precedente === "Ripianificata"
        ? motivo === "Mancata Presenza"
          ? "Ripianificata (No Show)"
          : "Ripianificata (Trattativa)"
        : precedente;

    const stato: Record<string, string> = {
      // hubspot_team_id non ha una cronologia utile: si usa il valore attuale.
      hubspot_team_id: (correnti.hubspot_team_id ?? "").trim(),
      // I criteri confrontano dealstage con gli ID delle fasi e
      // fase_precedente con le etichette: si passano quindi cosi' come sono.
      dealstage: (fasi[i].value ?? "").trim(),
      motivo,
      [FASE_PRECEDENTE_SERGENTE]: faseP
    };

    if (gruppi.some((g) => gruppoSoddisfatto(g, stato))) return new Date(t);
  }
  return null;
}

/** Id delle trattative della pipeline create da `daIso` in poi. */
async function* cercaTrattative(token: string, daIso: string): AsyncGenerator<string[]> {
  const daMs = new Date(daIso).getTime();
  let ultimoId = 0;

  while (true) {
    const d = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/crm/v3/objects/deals/search`, {
      method: "POST",
      body: {
        limit: 100,
        properties: ["hs_object_id"],
        // Paginazione per id crescente invece che con il cursore "after":
        // evita il tetto di 10.000 risultati per query.
        sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
        filterGroups: [
          {
            filters: [
              { propertyName: "hs_object_id", operator: "GT", value: String(ultimoId) },
              { propertyName: "pipeline", operator: "EQ", value: PIPELINE_APPUNTAMENTI },
              { propertyName: "createdate", operator: "GTE", value: String(daMs) }
            ]
          }
        ]
      }
    });
    const risultati: Array<{ id: string }> = d.results ?? [];
    if (!risultati.length) return;

    yield risultati.map((r) => r.id);
    ultimoId = Number(risultati[risultati.length - 1].id);
    await sleep(150);
  }
}

const idCampagne = new Map<string, number>();

async function risolviIdCampagne(nomi: string[]): Promise<void> {
  const mancanti = Array.from(new Set(nomi.filter((n) => n && !idCampagne.has(n))));
  if (!mancanti.length) return;

  const db = getDb();
  await db.query(
    `INSERT INTO campagna (nome) SELECT DISTINCT unnest($1::text[]) ON CONFLICT (nome) DO NOTHING`,
    [mancanti]
  );
  const { rows } = await db.query(`SELECT id, nome FROM campagna WHERE nome = ANY($1::text[])`, [mancanti]);
  for (const r of rows) idCampagne.set(r.nome as string, r.id as number);
}

export type EsitoTrattative = { trattative: number; svolte: number; senzaCampagna: number };
export type OpzioniTrattative = {
  daIso?: string;
  onProgresso?: (s: EsitoTrattative) => void;
};

export async function sincronizzaTrattative(
  token: string,
  opzioni: OpzioniTrattative = {}
): Promise<EsitoTrattative> {
  const daIso = opzioni.daIso ?? "2026-01-01";
  const db = getDb();

  const {
    rows: [log]
  } = await db.query(`INSERT INTO sync_log (tipo) VALUES ('trattative') RETURNING id`);

  const gruppi = await leggiCriteriSvolte(token);
  if (!gruppi.length) throw new Error("Nessun criterio letto dal workflow: non si puo' stabilire cosa sia svolto.");
  const proprieta = [...new Set(gruppi.flat().map((f) => f.proprieta))];
  // La cronologia serve su dealstage (le transizioni) e motivo (la variante di
  // Ripianificata). fase_precedente NON viene letta: si ricostruisce, vedi
  // primaSvolta().
  const conStorico = ["dealstage", "motivo"];

  // Etichette delle fasi: i criteri confrontano fase_precedente con i nomi
  // ("Da Svolgere", "No Show"...), mentre la cronologia contiene gli ID.
  const pipeline = await chiamaHubSpot<any>(
    token,
    `${HUBSPOT_API}/crm/v3/pipelines/deals/${PIPELINE_APPUNTAMENTI}`
  );
  const etichettaFase = new Map<string, string>(
    (pipeline.stages ?? []).map((s: any) => [String(s.id), String(s.label)])
  );
  if (!etichettaFase.size) throw new Error("Nessuna fase letta dalla pipeline: impossibile ricostruire le transizioni.");

  const esito: EsitoTrattative = { trattative: 0, svolte: 0, senzaCampagna: 0 };

  try {
    for await (const blocco of cercaTrattative(token, daIso)) {
      for (let i = 0; i < blocco.length; i += MAX_INPUT_STORICO) {
        const gruppoIds = blocco.slice(i, i + MAX_INPUT_STORICO);
        const d = await chiamaHubSpot<any>(token, `${HUBSPOT_API}/crm/v3/objects/deals/batch/read`, {
          method: "POST",
          body: {
            inputs: gruppoIds.map((id) => ({ id })),
            properties: [...proprieta, "id_campagna_track", "createdate"],
            propertiesWithHistory: conStorico
          }
        });

        const righe: Array<{ dealId: number; campagna: string; creata: Date; svolta: Date | null }> = [];
        for (const r of d.results ?? []) {
          const creata = new Date(r.properties?.createdate ?? "");
          if (Number.isNaN(creata.getTime())) continue;
          righe.push({
            dealId: Number(r.id),
            campagna: (r.properties?.id_campagna_track ?? "").trim(),
            creata,
            svolta: primaSvolta(gruppi, r.propertiesWithHistory ?? {}, r.properties ?? {}, etichettaFase)
          });
        }
        if (!righe.length) continue;

        await risolviIdCampagne(righe.map((x) => x.campagna));

        await db.query(
          `INSERT INTO trattativa (deal_id, campagna_id, creata_ts, svolta_ts)
           SELECT * FROM UNNEST($1::bigint[], $2::int[], $3::timestamptz[], $4::timestamptz[])
           ON CONFLICT (deal_id) DO UPDATE
             SET campagna_id = EXCLUDED.campagna_id,
                 creata_ts   = EXCLUDED.creata_ts,
                 svolta_ts   = EXCLUDED.svolta_ts`,
          [
            righe.map((x) => x.dealId),
            righe.map((x) => (x.campagna ? idCampagne.get(x.campagna) ?? null : null)),
            righe.map((x) => x.creata),
            righe.map((x) => x.svolta)
          ]
        );

        esito.trattative += righe.length;
        esito.svolte += righe.filter((x) => x.svolta).length;
        esito.senzaCampagna += righe.filter((x) => !x.campagna).length;
        opzioni.onProgresso?.({ ...esito });
        await sleep(120);
      }
    }

    await db.query(
      `UPDATE sync_log SET finito_at = now(), contatti = $2, eventi = $3, esito = 'ok' WHERE id = $1`,
      [log.id, esito.trattative, esito.svolte]
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
