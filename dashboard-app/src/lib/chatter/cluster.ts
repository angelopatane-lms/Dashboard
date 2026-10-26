import { getDb } from "@/lib/db";

/**
 * I contatti che i setter hanno perso per countdown, passati ai Chatter.
 *
 * LA REGOLA (decisa da Angelo il 26 ottobre 2026). Dall'ultima conversione del
 * contatto, ogni volta che un SETTER perde la proprieta' perche' scade il
 * countdown e' un ciclo. Il numero di cicli e' il cluster: 1° Ciclo, 2° Ciclo...
 * fino all'8°, che vale anche per 8 e oltre. Restano fuori i contatti passati
 * da un ADVISOR dopo l'ultima conversione (hanno fissato un appuntamento) e i
 * Clienti. Al massimo 100 per cluster al giorno.
 *
 * COME SI RICONOSCE LA SCADENZA. Il flusso "Countdown Stati Improduttivi -
 * STEP 2", quando il countdown arriva a zero, scrive `dispatched` con l'ora,
 * mette `dispatch_outcome` a serie_a o serie_b e svuota il proprietario. Ogni
 * ciclo lascia quindi una voce datata nella cronologia di `dispatched`, e chi
 * era il proprietario prima si legge da quella di `hubspot_owner_id`.
 *
 * IN TEMPO REALE E NON LA MATTINA. Il 26 ottobre, su 343 contatti a cui il
 * countdown aveva tolto la proprieta' nelle 24 ore, 156 erano gia' stati
 * riassegnati ad altri setter dall'app di Alessio: un giro al mattino
 * prenderebbe solo gli avanzi.
 *
 * PRIMA IN SOLA LETTURA: senza CHATTER_CLUSTER_ATTIVO=1 non si assegna niente,
 * si annota solo cosa si sarebbe fatto ("simulato").
 */

const HUBSPOT = "https://api.hubapi.com";

/** Mihai Pislaru: chi riceve i contatti per il team Chatter. */
export const PROPRIETARIO_CHATTER = "39286816";

export const MASSIMO_PER_CLUSTER = 100;
const ULTIMO_CLUSTER = 8;

/** Proprieta' tolta e voce di `dispatched` sono la stessa azione del flusso:
 *  qualche minuto di distanza al massimo (nel flusso c'e' un'attesa di 3). */
const STESSA_AZIONE_MS = 10 * 60_000;

export type Valutazione = {
  contattoId: string;
  ciclo: number | null;
  esito: "simulato" | "assegnato" | "oltre_quota" | "scartato" | "errore";
  motivo: string;
};

type Voce = { t: number; v: string };

async function hs<T>(percorso: string, token: string, init?: RequestInit): Promise<T> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${HUBSPOT}${percorso}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store"
    });
    if (r.status === 429 || r.status >= 500) {
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`HubSpot ${r.status} su ${percorso.split("?")[0]}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  }
  throw new Error(`HubSpot non risponde su ${percorso.split("?")[0]}`);
}

/**
 * Setter o advisor: dal team PRINCIPALE della persona, nella fotografia dei
 * team della Dashboard. Il proprietario porta l'id dell'owner, la fotografia
 * l'id dell'utente, e non coincidono sempre (vedi copilot/trattative.ts): il
 * ponte sono gli owner di HubSpot, compresi gli archiviati, perche' un setter
 * che non c'e' piu' ha comunque fatto i suoi cicli.
 */
let cacheRuoli: { quando: number; ruolo: Map<string, "setter" | "advisor"> } | null = null;

async function ruoli(token: string): Promise<Map<string, "setter" | "advisor">> {
  if (cacheRuoli && Date.now() - cacheRuoli.quando < 30 * 60_000) return cacheRuoli.ruolo;
  const { rows } = await getDb().query<{ user_id: string; team_nome: string }>(
    `SELECT user_id::text, team_nome FROM utente_team_adesso
      WHERE genere = 'principale' AND team_nome IN ('Setter', 'Advisor')`
  );
  const perUtente = new Map(rows.map((r) => [r.user_id, r.team_nome === "Setter" ? "setter" : "advisor"] as const));
  const ruolo = new Map<string, "setter" | "advisor">();
  for (const archiviati of [false, true]) {
    let dopo: string | undefined;
    do {
      const d = await hs<{ results?: Array<{ id: string; userId?: number }>; paging?: { next?: { after?: string } } }>(
        `/crm/v3/owners?limit=100&archived=${archiviati}${dopo ? `&after=${dopo}` : ""}`,
        token
      );
      for (const o of d.results ?? []) {
        const r = perUtente.get(String(o.userId ?? ""));
        if (r) ruolo.set(String(o.id), r);
      }
      dopo = d.paging?.next?.after;
    } while (dopo);
  }
  cacheRuoli = { quando: Date.now(), ruolo };
  return ruolo;
}

/** Quanti contatti di quel cluster sono gia' passati (o passerebbero) oggi, giorno di Roma. */
async function giaOggi(ciclo: number): Promise<number> {
  const { rows } = await getDb().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM chatter_cluster_esito
      WHERE ciclo = $1 AND esito IN ('simulato', 'assegnato')
        AND (ricevuto_at AT TIME ZONE 'Europe/Rome')::date = (now() AT TIME ZONE 'Europe/Rome')::date`,
    [ciclo]
  );
  return Number(rows[0]?.n ?? 0);
}

async function annota(v: Valutazione): Promise<void> {
  try {
    await getDb().query(
      `INSERT INTO chatter_cluster_esito (contact_id, ciclo, esito, motivo) VALUES ($1::bigint, $2, $3, $4)`,
      [v.contattoId, v.ciclo, v.esito, v.motivo.slice(0, 500)]
    );
  } catch (e) {
    console.error("[chatter/cluster] non sono riuscito ad annotare", e);
  }
}

/**
 * I cicli da setter dall'ultima conversione, o il motivo per cui il contatto
 * non e' da mandare.
 */
export async function contaCicli(
  contattoId: string,
  token: string
): Promise<{ ciclo: number } | { scarto: string }> {
  const c = await hs<{
    properties?: Record<string, string | null>;
    propertiesWithHistory?: Record<string, Array<{ timestamp: string; value: string }>>;
  }>(
    `/crm/v3/objects/contacts/${contattoId}?properties=hubspot_owner_id,hs_lead_status,lifecyclestage,recent_conversion_date,dispatch_outcome` +
      `&propertiesWithHistory=hubspot_owner_id,dispatched`,
    token
  );
  const p = c.properties ?? {};
  // Arrivato tardi: l'app di Alessio l'ha gia' dato a un altro setter.
  if (p.hubspot_owner_id) return { scarto: "ha gia' un nuovo proprietario" };
  if (p.hs_lead_status === "Cliente" || p.lifecyclestage === "customer") return { scarto: "cliente" };
  if (p.dispatch_outcome !== "serie_a" && p.dispatch_outcome !== "serie_b") {
    return { scarto: `esito del countdown ${p.dispatch_outcome || "vuoto"}` };
  }

  const conversione = Date.parse(p.recent_conversion_date ?? "") || 0;
  const storia = (nome: string): Voce[] =>
    (c.propertiesWithHistory?.[nome] ?? [])
      .map((h) => ({ t: Date.parse(h.timestamp), v: h.value ?? "" }))
      .sort((a, b) => a.t - b.t);
  const proprietari = storia("hubspot_owner_id");
  const scadenze = storia("dispatched").filter((h) => h.t >= conversione);
  const ruolo = await ruoli(token);

  if (proprietari.some((h) => h.t >= conversione && h.v && ruolo.get(h.v) === "advisor")) {
    return { scarto: "passato da un advisor dopo l'ultima conversione" };
  }

  let cicli = 0;
  for (const s of scadenze) {
    const tolto = proprietari.find((h) => !h.v && Math.abs(h.t - s.t) <= STESSA_AZIONE_MS);
    if (!tolto) continue;
    // Il proprietario che c'era appena prima che il flusso lo togliesse.
    const prima = proprietari.filter((h) => h.t < tolto.t && h.v).pop();
    if (prima && ruolo.get(prima.v) === "setter") cicli++;
  }
  if (!cicli) return { scarto: "nessun ciclo da setter dall'ultima conversione" };
  return { ciclo: Math.min(cicli, ULTIMO_CLUSTER) };
}

/** Valuta un contatto appena uscito dal countdown e, se e' acceso, lo assegna. */
export async function valutaContatto(contattoId: string, token: string): Promise<Valutazione> {
  let v: Valutazione;
  try {
    const r = await contaCicli(contattoId, token);
    if ("scarto" in r) {
      v = { contattoId, ciclo: null, esito: "scartato", motivo: r.scarto };
    } else if ((await giaOggi(r.ciclo)) >= MASSIMO_PER_CLUSTER) {
      v = { contattoId, ciclo: r.ciclo, esito: "oltre_quota", motivo: `gia' ${MASSIMO_PER_CLUSTER} oggi per il ${r.ciclo}° Ciclo` };
    } else if (process.env.CHATTER_CLUSTER_ATTIVO === "1") {
      await hs(`/crm/v3/objects/contacts/${contattoId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          properties: { hubspot_owner_id: PROPRIETARIO_CHATTER, cluster_chatter: `ciclo_${r.ciclo}` }
        })
      });
      v = { contattoId, ciclo: r.ciclo, esito: "assegnato", motivo: "assegnato a Mihai Pislaru" };
    } else {
      v = { contattoId, ciclo: r.ciclo, esito: "simulato", motivo: "sola lettura: sarebbe andato a Mihai" };
    }
  } catch (e) {
    v = { contattoId, ciclo: null, esito: "errore", motivo: e instanceof Error ? e.message : String(e) };
  }
  await annota(v);
  return v;
}
