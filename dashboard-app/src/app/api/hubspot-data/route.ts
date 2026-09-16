import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { RE_SUFFISSO_VARIANTE, sqlEMarcatoreInstant, sqlNomeBase } from "@/lib/campagne";
import { nomiPerRotta } from "@/lib/proprietari";

/**
 * NESSUNA RISPOSTA MEMORIZZATA.
 *
 * Next.js conserva le risposte delle chiamate in uscita in .next/cache e le
 * riusa. Su dati di un CRM che cambia in continuazione questo significa
 * mostrare il passato senza dirlo: misurato il 16 settembre, il proprietario di
 * una trattativa cambiato alle 06:24 continuava a risultare quello vecchio
 * venticinque minuti dopo, in locale e in produzione, e la card dell'agenda
 * restava nella colonna della persona sbagliata. La stessa richiesta fatta da
 * uno script fuori da Next dava subito il valore nuovo, e svuotando la cache la
 * rotta si allineava all-istante.
 *
 * Non scade in modo prevedibile e non lascia traccia: l-unico segnale era
 * hs_lastmodifieddate fermo al giorno prima dentro la risposta. Meglio pagare
 * ogni volta la chiamata che servire un dato vecchio senza accorgersene.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const BOOM_OBJECT_ID = "2-130365112";
const HUBSPOT_API = "https://api.hubapi.com";

export type RawBoomRecord = {
  /** Chi ha VENDUTO: il proprietario dell'incasso. E' la colonna della pagina
   *  Advisor. */
  operatore: string;
  /**
   * Chi aveva FISSATO l'appuntamento da cui l'incasso e' nato. E' la colonna
   * della pagina Setter.
   *
   * Sono due persone diverse nel 39% dei casi (misurato su 335 incassi di
   * luglio-settembre), quindi aggregare per proprietario su una pagina di setter
   * attribuisce a ciascuno il lavoro di qualcun altro: per proprietario in
   * testa ci sono gli Advisor che vendono, per setter i setter che procurano.
   *
   * Vuoto quando non si riesce a stabilirlo, e chi aggrega lo salta: meglio un
   * totale che non torna di un totale attribuito alla persona sbagliata.
   */
  setter: string;
  tipologia_di_incasso: string;
  importo: number;
  tipo_di_vendita: string;
  prodotto: string;
  id_campagna_track: string;
  data_di_pagamento_ms: number;
  /** Il contatto dietro l'incasso, dalla proprieta' "ID Contatto Associato". */
  contact_id: number | null;
  /** La trattativa da cui l'incasso nasce, per risalire al setter quando
   *  l'incasso non lo porta scritto. Solo uso interno alla rotta. */
  id_trattativa: string;
  /** true se quel contatto, su quella campagna, era stato assegnato subito.
   *  Deciso dal CONTATTO e non dal nome campagna: vedi calcolaInstant(). */
  instant: boolean;
};

export type RawDealRecord = {
  operatore: string;
  id_campagna_track: string;
  createdate_ms: number;
};

// I nomi dei proprietari arrivano da src/lib/proprietari.ts.
//
// PERCHE' NON PIU' IN LOCALE. La versione precedente chiamava
// /crm/v3/owners?limit=500 senza `archived=true`, e quell'endpoint esclude di
// default gli utenti DISATTIVATI: leggeva 76 proprietari invece di 496. Ogni
// ex dipendente restava senza nome, e siccome il codice ricade sull'id quando
// il nome manca, in tabella compariva un numero - che non combacia con nessuna
// riga del foglio Operatori, quindi il suo lavoro spariva dal conteggio. Su un
// solo mese erano sette persone, fra cui chi aveva fissato 38 appuntamenti poi
// disertati.

async function searchWithRetry(
  token: string,
  url: string,
  body: Record<string, unknown>
): Promise<{ results: Array<{ properties: Record<string, string | null> }>; paging?: { next?: { after: string } } }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) {
      const wait = 1000 * (attempt + 1);
      console.warn(`[hubspot-data] 429 rate limit, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const err = await res.text();
    throw new Error(`HubSpot search ${res.status}: ${err}`);
  }
  throw new Error("Max retries exceeded");
}

async function fetchBoomRecords(
  token: string,
  fromMs: number,
  toMs: number,
  ownerMap: Record<string, string>
): Promise<RawBoomRecord[]> {
  const records: RawBoomRecord[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "data_di_pagamento", operator: "GTE", value: String(fromMs) },
          { propertyName: "data_di_pagamento", operator: "LTE", value: String(toMs) }
        ]
      }],
      // "setter" e "id_trattativa" servono all'attribuzione della pagina
      // Setter: il primo e' compilato sull'87% degli incassi, il secondo sul
      // 98% e fa da ripiego per il resto. Sono proprieta' dello stesso oggetto,
      // quindi non costano una chiamata in piu'.
      properties: ["data_di_pagamento", "tipologia_di_incasso", "importo", "hubspot_owner_id", "setter", "id_trattativa", "id_campagna_track", "tipo_di_vendita", "prodotto", "id_contatto_associato"],
      limit: 100,
      ...(after ? { after } : {})
    };

    const data = await searchWithRetry(token, `${HUBSPOT_API}/crm/v3/objects/${BOOM_OBJECT_ID}/search`, body);

    for (const r of data.results ?? []) {
      const p = r.properties;
      const operatore = ownerMap[(p.hubspot_owner_id ?? "").trim()] ?? "";
      if (!operatore) continue;
      records.push({
        operatore,
        // Il setter dell'incasso quando c'e'. Per il 13% che non lo ha ci
        // pensa setterDaTrattativa() qui sotto, che risale dalla trattativa.
        setter: ownerMap[(p.setter ?? "").trim()] ?? "",
        id_trattativa: (p.id_trattativa ?? "").trim(),
        tipologia_di_incasso: p.tipologia_di_incasso ?? "",
        importo: parseFloat(p.importo ?? "0") || 0,
        tipo_di_vendita: (p.tipo_di_vendita ?? "").trim(),
        prodotto: (p.prodotto ?? "").trim(),
        id_campagna_track: p.id_campagna_track ?? "",
        contact_id: Number(p.id_contatto_associato) || null,
        instant: false,
        data_di_pagamento_ms: (() => {
          const val = (p.data_di_pagamento ?? "").trim();
          if (!val || val === "0") return 0;
          if (/^\d+$/.test(val)) return parseInt(val);
          return new Date(val).getTime();
        })()
      });
    }
    after = data.paging?.next?.after;
    if (after) await new Promise((r) => setTimeout(r, 200));
  } while (after);

  return records;
}


/**
 * Segna quali incassi appartengono al gruppo dei contatti assegnati subito.
 *
 * Il marcatore "_test_instant" vive sulla cronologia del CONTATTO, mentre
 * l'incasso porta il nome campagna com'era alla sua nascita: un workflow scrive
 * id_campagna_track prima che la riscrittura aggiunga il marcatore, quindi
 * quel nome quasi sempre non ce l'ha. Misurato sul trimestre: per nome gli
 * incassi instant erano 14 su 289, per contatto sono 21, e le chiusure passano
 * da 10 a 16 (23.800 EUR recuperati).
 *
 * Non costa chiamate: "id_contatto_associato" e' una proprieta' dell'oggetto,
 * valorizzata su 288 record su 289, e la si chiede nella stessa ricerca. Resta
 * una sola query a Postgres per tutto l'insieme.
 *
 * Se il database non risponde si lascia la classificazione al nome, che e'
 * incompleta ma non sbagliata: meglio di una pagina che non carica.
 */
async function calcolaInstant(records: RawBoomRecord[]): Promise<void> {
  const perNome = (r: RawBoomRecord) =>
    r.id_campagna_track.trim().toLowerCase().endsWith("_test_instant");
  for (const r of records) r.instant = perNome(r);

  const ids = [...new Set(records.map((r) => r.contact_id).filter((x): x is number => Boolean(x)))];
  if (!ids.length) return;

  try {
    const db = getDb();
    const { rows } = await db.query<{ persona: string; campagna: string }>(
      `SELECT DISTINCT COALESCE(a.nuovo_id, e.contact_id) AS persona,
              ${sqlNomeBase("c")} AS campagna
         FROM eventi_conversione e
         LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
         JOIN campagna c ON c.id = e.campagna_id
        WHERE ${sqlEMarcatoreInstant("c")}
          AND COALESCE(a.nuovo_id, e.contact_id) = ANY($1::bigint[])`,
      [ids]
    );
    const marcati = new Set(rows.map((r) => `${r.persona}|${r.campagna}`));
    for (const r of records) {
      if (!r.contact_id) continue;
      const base = r.id_campagna_track.trim().toLowerCase().replace(RE_SUFFISSO_VARIANTE, "");
      if (base && marcati.has(`${r.contact_id}|${base}`)) r.instant = true;
    }
  } catch (err) {
    console.error("[hubspot-data] marcatori non disponibili:", err instanceof Error ? err.message : err);
  }
}

/**
 * Completa il setter degli incassi che non lo portano scritto, risalendo alla
 * trattativa da cui nascono.
 *
 * La proprieta' "setter" sull'incasso e' compilata sull'87% dei record; il
 * restante 13% pesava 45.072 EUR su un solo trimestre, che senza questo
 * ripiego resterebbero fuori da ogni riga della pagina Setter. "id trattativa"
 * c'e' invece sul 98%, e la trattativa il suo setter ce l'ha - congelato alla
 * data in cui l'appuntamento e' stato fissato, vedi setterAllaData() in
 * src/lib/trattative/sync.ts.
 *
 * Una sola query per tutto l'insieme, sul database nostro. Se non risponde si
 * lascia il setter vuoto: chi aggrega salta quei record, e il totale della
 * pagina Setter non torna con quello della pagina Advisor - preferibile a un
 * incasso attribuito a chi non lo ha procurato.
 */
async function completaSetter(
  records: RawBoomRecord[],
  ownerMap: Record<string, string>
): Promise<void> {
  const daRisolvere = records.filter((r) => !r.setter && r.id_trattativa);
  if (!daRisolvere.length) return;

  const ids = [...new Set(daRisolvere.map((r) => Number(r.id_trattativa)).filter(Number.isFinite))];
  if (!ids.length) return;

  try {
    const { rows } = await getDb().query<{ deal_id: string; setter_id: string | null }>(
      `SELECT deal_id::text AS deal_id, setter_id::text AS setter_id
         FROM trattativa
        WHERE deal_id = ANY($1::bigint[]) AND setter_id IS NOT NULL`,
      [ids]
    );
    const perDeal = new Map(rows.map((r) => [r.deal_id, r.setter_id ?? ""]));
    let risolti = 0;
    for (const r of daRisolvere) {
      const nome = ownerMap[perDeal.get(r.id_trattativa) ?? ""] ?? "";
      if (nome) {
        r.setter = nome;
        risolti++;
      }
    }
    console.log(`[hubspot-data] setter dedotto dalla trattativa: ${risolti}/${daRisolvere.length}`);
  } catch (err) {
    console.error("[hubspot-data] setter non deducibile:", err instanceof Error ? err.message : err);
  }
}

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN not set" }, { status: 500 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to + "T23:59:59.999Z").getTime();

  try {
    const ownerMap = await nomiPerRotta(token);
    const boomRecords = await fetchBoomRecords(token, fromMs, toMs, ownerMap);
    await calcolaInstant(boomRecords);
    await completaSetter(boomRecords, ownerMap);
    const uniqueOperatori = [...new Set(boomRecords.map((r) => r.operatore || "(empty)"))].slice(0, 8);
    const uniqueTipologie = [...new Set(boomRecords.map((r) => r.tipologia_di_incasso || "(empty)"))];
    console.log(`[hubspot-data] boom:${boomRecords.length} | operatori:${uniqueOperatori.join(" / ")} | tipologie:${uniqueTipologie.join(" / ")}`);

    return NextResponse.json(
      { boomRecords },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[hubspot-data]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
