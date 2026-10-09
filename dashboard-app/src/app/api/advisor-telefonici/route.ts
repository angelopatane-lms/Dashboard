import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ADVISOR_TELEFONICI, STATI_POST_CONSULENZA, STATO_NO_SHOW } from "@/lib/statiLead";

/**
 * Appuntamenti e Consulenze di chi lavora solo al telefono.
 *
 * Quattro advisor seguono il low ticket senza fissare videochiamate: niente
 * appuntamento sul calendario, quindi niente trattativa, quindi le due colonne
 * della tabella Advisor restavano a zero su persone che a settembre hanno
 * chiuso 69 vendite. Qui si ricostruiscono da tre fonti.
 *
 * SI CONTA IL PRIMO, NON OGNI VOLTA. Di ogni coppia advisor-contatto vale il
 * PRIMO appuntamento e la PRIMA consulenza: se lo stesso contatto viene
 * ripreso il mese dopo non conta una seconda volta, e un contatto che passa da
 * "Appuntamento fissato" a "in Trattative" ha avuto un appuntamento e una
 * consulenza, non due appuntamenti. Sommare ogni passaggio gonfierebbe proprio
 * chi lavora bene, perche' chi porta avanti la pratica tocca piu' stati.
 *
 * LE TRE FONTI, e perche' servono tutte e tre:
 *
 *  1. LA CRONOLOGIA DEGLI STATI LEAD (stato_lead_storia). E' la traccia
 *     principale: "Appuntamento fissato" vale come appuntamento, gli stati
 *     post-consulenza valgono come appuntamento E consulenza, tranne No Show
 *     che e' l'unico in cui l'appuntamento c'e' stato e la consulenza no.
 *
 *  2. LE TRATTATIVE VINTE E PERSE. Per loro sono gli unici due casi in cui una
 *     trattativa nasce davvero. Sono poche - sei a settembre - ma gratis.
 *
 *  3. LE CHIUSURE (Boom con tipologia Acconto o Quota unica). SENZA QUESTE
 *     MANCA IL GROSSO: misurato su settembre, delle 68 chiusure con un
 *     contatto associato solo 27 avevano uno stato post-consulenza. Le altre
 *     41 erano invisibili, perche' quando la vendita si chiude in giornata lo
 *     stato salta dritto a "Cliente" - lo mette il Modulo di Iscrizione - e di
 *     post-consulenza non resta traccia. Su Chiara Soldati erano 7 su 7: 3
 *     consulenze calcolate contro 8 vendite chiuse, che e' impossibile.
 *     Una vendita chiusa e' una consulenza fatta: non si vende senza aver
 *     esposto il prodotto.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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
const ORIGINE = "2026-01-01T00:00:00.000Z";

const chiave = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * La stessa normalizzazione che la dashboard applica al filtro Campagna
 * altrove: l'etichetta scelta nel menu ("ICMD 14", "REM") diventa un pezzo di
 * stringa da cercare dentro l'id della campagna. Deve restare identica a quella
 * di DashboardEnterprise, altrimenti le stesse righe si filtrano in due modi.
 */
const normalizzaCampagna = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

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

/** Le chiusure dei quattro, dall'origine a oggi: proprietario, contatto, data. */
async function chiusure(
  token: string,
  idProprietari: string[],
  aMs: number,
  campagna: string | null
): Promise<Array<{ proprietario: string; contatto: string; ms: number }>> {
  const out: Array<{ proprietario: string; contatto: string; ms: number }> = [];
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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  // Vuoto quando non c'e' filtro: in quel caso non si scarta niente.
  const campagna = normalizzaCampagna(searchParams.get("campagna") ?? "") || null;

  const daMs = Date.parse(`${from}T00:00:00.000Z`);
  const aMs = Date.parse(`${to}T23:59:59.999Z`);

  try {
    const db = getDb();
    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN ?? "";

    const statiConsulenza = STATI_POST_CONSULENZA.filter((s) => s !== STATO_NO_SHOW);
    const statiAppuntamento = [...STATI_POST_CONSULENZA, "Appuntamento fissato"];

    // Chi sono, con il loro id: serve sia per leggere i Boom sia per dare un
    // nome alle righe.
    // QUI LA LISTA RESTA QUELLA SCRITTA A MANO, e non il team Eventi, perche'
    // le due domande sono diverse: il team dice di chi RACCOGLIERE gli Stati
    // Lead, questa rotta decide di chi SOSTITUIRE i numeri con quelli
    // ricavati da li'. Misurato il 9 ottobre 2026: degli otto del team, tre
    // fanno 22-30 trattative al mese, e sostituirli vorrebbe dire cancellarle
    // - a Roberto Esposito resterebbero 2 consulenze su 11. La sostituzione
    // vale solo per chi trattative non ne ha, e sparira' del tutto quando le
    // due fonti verranno unite con deduplica sulla coppia persona-contatto.
    const { rows: persone } = await db.query<{ id: string; nome: string }>(
      `SELECT id::text, nome FROM proprietario WHERE nome = ANY($1::text[])`,
      [[...ADVISOR_TELEFONICI]]
    );
    const nomePerId = new Map(persone.map((p) => [p.id, p.nome]));

    // 1 e 2: stati e trattative, dall'origine - serve tutta la storia per
    // sapere qual e' il primo, non solo quella del periodo.
    const fasi = token ? await fasiEsito(token) : [];
    const { rows: eventi } = await db.query<{ proprietario: string; contatto: string; ms: string; tipo: string }>(
      `
      SELECT s.proprietario_id::text AS proprietario, s.contatto_id::text AS contatto,
             (extract(epoch from s.ts) * 1000)::bigint::text AS ms,
             CASE WHEN s.stato = ANY($3::text[]) THEN 'consulenza' ELSE 'appuntamento' END AS tipo
        FROM stato_lead_storia s
       WHERE s.ts >= $1::timestamptz AND s.proprietario_id = ANY($4::bigint[])
         AND s.stato = ANY($2::text[])
         -- Il filtro campagna: la colonna campagna e' l'id grezzo che il
         -- contatto aveva in quell'istante, e si cerca dentro come fa il resto
         -- della dashboard. Senza filtro $6 e' NULL e la riga passa sempre.
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

    // 3: le chiusure.
    const vendite = token ? await chiusure(token, persone.map((p) => p.id), aMs, campagna) : [];

    // Il primo appuntamento e la prima consulenza di ogni coppia.
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

    const conteggi: Record<string, { appuntamenti: number; consulenze: number }> = {};
    for (const nome of nomePerId.values()) conteggi[chiave(nome)] = { appuntamenti: 0, consulenze: 0 };
    const dentro = (ms: number) => ms >= daMs && ms <= aMs;
    for (const [k, ms] of primoApp) {
      if (!dentro(ms)) continue;
      const nome = nomePerId.get(k.split("|")[0]);
      if (nome) conteggi[chiave(nome)].appuntamenti += 1;
    }
    for (const [k, ms] of primoCons) {
      if (!dentro(ms)) continue;
      const nome = nomePerId.get(k.split("|")[0]);
      if (nome) conteggi[chiave(nome)].consulenze += 1;
    }

    return NextResponse.json({ conteggi }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[advisor-telefonici]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
