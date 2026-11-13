/**
 * APPUNTAMENTI E CONSULENZE DI CHI LAVORA SOLO AL TELEFONO.
 *
 * Gli advisor eventi seguono il low ticket senza fissare videochiamate: niente
 * appuntamento sul calendario, quindi niente trattativa in pipeline High
 * Ticket, quindi le due colonne che tutto il resto della casa calcola dalle
 * trattative restano a zero su persone che vendono decine di biglietti al
 * mese. Qui le due colonne si ricostruiscono dagli STATI LEAD e dai loro
 * movimenti, che per loro sono l'unica traccia.
 *
 * QUESTO FILE NON DECIDE NIENTE DI NUOVO. La regola era gia' scritta dentro
 * `/api/advisor-telefonici` e vale dal 9 ottobre 2026; da qui la leggono due
 * posti - quella rotta e la fotografia delle pagine squadre - invece di
 * averne due copie che prima o poi divergono. Il ragionamento, per esteso, sta
 * nel commento di testa di quella rotta.
 *
 * IN BREVE:
 *
 *  - si conta IL PRIMO, non ogni volta: di ogni coppia advisor-contatto vale
 *    il primo appuntamento e la prima consulenza, o chi porta avanti la
 *    pratica verrebbe contato due volte;
 *  - "Appuntamento fissato" vale appuntamento; gli stati post-consulenza
 *    valgono appuntamento E consulenza, tranne No Show, dove l'appuntamento
 *    c'e' stato e la consulenza no;
 *  - le trattative Vinte e Perse valgono come consulenza: per loro sono gli
 *    unici casi in cui una trattativa nasce davvero;
 *  - LE CHIUSURE VALGONO COME CONSULENZA, ed e' il pezzo grosso: quando la
 *    vendita si chiude in giornata lo stato salta dritto a "Cliente" e di
 *    post-consulenza non resta traccia. Una vendita chiusa e' una consulenza
 *    fatta: non si vende senza aver esposto il prodotto.
 */
import type { Pool } from "pg";
import { ADVISOR_TELEFONICI, STATI_POST_CONSULENZA, STATO_NO_SHOW } from "@/lib/statiLead";
import { squadraTelefonici } from "@/lib/statiLead/squadra";

const HUBSPOT = "https://api.hubapi.com";
const BOOM_OBJECT_ID = "2-130365112";
/** Le tipologie che segnano una vendita nuova: le rate e gli upgrade no. */
const TIPOLOGIE_CHIUSURA = new Set(["Acconto", "Quota unica"]);

/**
 * Da quando si guarda indietro per stabilire qual e' il "primo".
 *
 * E' la data del primo caricamento della cronologia degli stati: prima di
 * questa non sappiamo niente, quindi un contatto gia' visto nel 2025 e
 * ripreso oggi risulterebbe nuovo. Il limite va spostato solo insieme a un
 * nuovo caricamento piu' indietro.
 */
export const ORIGINE = "2026-01-01T00:00:00.000Z";

export const chiaveNome = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Gli id delle fasi Vinta e Persa, dal nome: gli id cambiano fra i portali. */
async function fasiEsito(token: string): Promise<string[]> {
  const res = await fetch(`${HUBSPOT}/crm/v3/pipelines/deals`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) return [];
  const d = (await res.json()) as { results?: Array<{ stages?: Array<{ id: string; label: string }> }> };
  const out: string[] = [];
  for (const p of d.results ?? [])
    for (const st of p.stages ?? []) {
      const l = (st.label ?? "").trim().toLowerCase();
      if (l === "vinta" || l === "persa") out.push(String(st.id));
    }
  return out;
}

/** Le chiusure dei telefonici, dall'origine a `aMs`: proprietario, contatto, data. */
async function chiusure(
  token: string,
  idProprietari: string[],
  aMs: number,
  campagna: string | null
): Promise<Array<{ proprietario: string; contatto: string; ms: number }>> {
  const out: Array<{ proprietario: string; contatto: string; ms: number }> = [];
  if (!idProprietari.length) return out;
  let after: string | undefined;
  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            // LE DATE VANNO IN EPOCH MILLISECONDI. Con una data ISO HubSpot
            // risponde "There was a problem with the request" senza dire quale.
            { propertyName: "data_di_pagamento", operator: "GTE", value: String(Date.parse(ORIGINE)) },
            { propertyName: "data_di_pagamento", operator: "LTE", value: String(aMs) },
            { propertyName: "hubspot_owner_id", operator: "IN", values: idProprietari }
          ]
        }
      ],
      // id_contatto_associato evita una chiamata di associazione per ogni Boom:
      // su un anno sarebbero centinaia.
      properties: [
        "hubspot_owner_id",
        "tipologia_di_incasso",
        "data_di_pagamento",
        "id_contatto_associato",
        "id_campagna_track"
      ],
      limit: 100,
      ...(after ? { after } : {})
    };
    const res = await fetch(`${HUBSPOT}/crm/v3/objects/${BOOM_OBJECT_ID}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if (!res.ok) break;
    const d = (await res.json()) as {
      results?: Array<{ properties: Record<string, string | null> }>;
      paging?: { next?: { after?: string } };
    };
    for (const r of d.results ?? []) {
      const p = r.properties;
      if (!TIPOLOGIE_CHIUSURA.has((p.tipologia_di_incasso ?? "").trim())) continue;
      if (campagna && !(p.id_campagna_track ?? "").toLowerCase().includes(campagna)) continue;
      const contatto = (p.id_contatto_associato ?? "").trim();
      const proprietario = (p.hubspot_owner_id ?? "").trim();
      const grezza = p.data_di_pagamento ?? "";
      const ms = /^\d+$/.test(grezza) ? Number(grezza) : Date.parse(grezza);
      if (!contatto || !proprietario || !Number.isFinite(ms)) continue;
      out.push({ proprietario, contatto, ms });
    }
    after = d.paging?.next?.after;
  } while (after);
  return out;
}

export type PrimiTelefonici = {
  /** id proprietario -> nome, per chi e' stato considerato. */
  nomePerId: Map<string, string>;
  /** "<idProprietario>|<idContatto>" -> istante del PRIMO appuntamento. */
  primoApp: Map<string, number>;
  /** "<idProprietario>|<idContatto>" -> istante della PRIMA consulenza. */
  primoCons: Map<string, number>;
};

/**
 * Il primo appuntamento e la prima consulenza di ogni coppia advisor-contatto.
 *
 * Si guarda SEMPRE TUTTA LA STORIA dall'origine, anche quando interessa una
 * settimana: per sapere se quello di martedi' era il primo bisogna sapere cosa
 * c'era prima. A filtrare per periodo ci pensa chi chiama, sui valori che
 * tornano.
 */
export async function primiTelefonici(
  db: Pool,
  token: string,
  aMs: number,
  campagna: string | null = null
): Promise<PrimiTelefonici> {
  const statiConsulenza = STATI_POST_CONSULENZA.filter((s) => s !== STATO_NO_SHOW);
  const statiAppuntamento = [...STATI_POST_CONSULENZA, "Appuntamento fissato"];

  // CHI SONO: il team su HubSpot, e la lista scritta a mano come riserva. Una
  // lista vuota qui farebbe sparire le colonne di tutti, e uno zero somiglia
  // troppo a una giornata tranquilla.
  let nomiSquadra: string[] = [...ADVISOR_TELEFONICI];
  if (token) {
    try {
      const s = await squadraTelefonici(token);
      if (s.perNome.size) nomiSquadra = [...s.perNome.keys()];
    } catch (e) {
      console.error("[telefonici] team non letto, uso la lista di riserva:", e);
    }
  }
  const { rows: persone } = await db.query<{ id: string; nome: string }>(
    `SELECT id::text, nome FROM proprietario WHERE nome = ANY($1::text[])`,
    [nomiSquadra]
  );
  const nomePerId = new Map(persone.map((p) => [p.id, p.nome]));

  const fasi = token ? await fasiEsito(token) : [];
  const { rows: eventi } = await db.query<{ proprietario: string; contatto: string; ms: string; tipo: string }>(
    `
    SELECT s.proprietario_id::text AS proprietario, s.contatto_id::text AS contatto,
           (extract(epoch from s.ts) * 1000)::bigint::text AS ms,
           CASE WHEN s.stato = ANY($3::text[]) THEN 'consulenza' ELSE 'appuntamento' END AS tipo
      FROM stato_lead_storia s
     WHERE s.ts >= $1::timestamptz AND s.proprietario_id = ANY($4::bigint[])
       AND s.stato = ANY($2::text[])
       AND ($6::text IS NULL OR lower(coalesce(s.campagna, '')) LIKE '%' || $6 || '%')
    UNION ALL
    SELECT t.proprietario_id::text, t.contact_id::text,
           (extract(epoch from t.fase_ts) * 1000)::bigint::text, 'consulenza'
      FROM trattativa t
      LEFT JOIN campagna k ON k.id = t.campagna_id
     WHERE t.fase_ts >= $1::timestamptz AND t.proprietario_id = ANY($4::bigint[])
       AND t.fase = ANY($5::text[]) AND t.contact_id IS NOT NULL
       AND ($6::text IS NULL OR lower(coalesce(k.nome, '')) LIKE '%' || $6 || '%')
    `,
    [ORIGINE, statiAppuntamento, statiConsulenza, persone.map((p) => Number(p.id)), fasi.length ? fasi : ["-"], campagna]
  );

  const vendite = token ? await chiusure(token, persone.map((p) => p.id), aMs, campagna) : [];

  const primoApp = new Map<string, number>();
  const primoCons = new Map<string, number>();
  const segna = (mappa: Map<string, number>, k: string, ms: number) => {
    const attuale = mappa.get(k);
    if (attuale === undefined || ms < attuale) mappa.set(k, ms);
  };
  for (const e of eventi) {
    const k = `${e.proprietario}|${e.contatto}`;
    const ms = Number(e.ms);
    if (!Number.isFinite(ms)) continue;
    // Una consulenza porta con se' anche l'appuntamento: per esporre il
    // prodotto un appuntamento c'e' stato.
    segna(primoApp, k, ms);
    if (e.tipo === "consulenza") segna(primoCons, k, ms);
  }
  for (const v of vendite) {
    const k = `${v.proprietario}|${v.contatto}`;
    segna(primoApp, k, v.ms);
    segna(primoCons, k, v.ms);
  }

  return { nomePerId, primoApp, primoCons };
}

/**
 * Gli stessi numeri, contati GIORNO PER GIORNO e per id proprietario.
 *
 * E' la forma che serve alla fotografia delle pagine squadre, dove ogni voce
 * appartiene a un giorno: il "primo" resta quello calcolato su tutta la
 * storia, e qui si limita a finire nel giorno in cui e' successo.
 */
export function perGiornoEPersona(
  primi: PrimiTelefonici,
  giornoDi: (ms: number) => string
): Map<string, Map<string, { appuntamenti: number; consulenze: number }>> {
  const out = new Map<string, Map<string, { appuntamenti: number; consulenze: number }>>();
  const voce = (giorno: string, id: string) => {
    const perGiorno = out.get(giorno) ?? out.set(giorno, new Map()).get(giorno)!;
    return perGiorno.get(id) ?? perGiorno.set(id, { appuntamenti: 0, consulenze: 0 }).get(id)!;
  };
  for (const [k, ms] of primi.primoApp) {
    const id = k.split("|")[0];
    if (!primi.nomePerId.has(id)) continue;
    voce(giornoDi(ms), id).appuntamenti += 1;
  }
  for (const [k, ms] of primi.primoCons) {
    const id = k.split("|")[0];
    if (!primi.nomePerId.has(id)) continue;
    voce(giornoDi(ms), id).consulenze += 1;
  }
  return out;
}
