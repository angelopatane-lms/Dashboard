/**
 * La riga del foglio "KPI SETTIMANALI", pronta da incollare.
 *
 * COME SI LANCIA
 *   npx tsx scripts/kpi-settimanale.ts                 la settimana scorsa (lun-dom)
 *   npx tsx scripts/kpi-settimanale.ts 2026-10-12      la settimana che comincia quel lunedi'
 *
 * PERCHE' NON UN CRON SU VERCEL, come il report giornaliero: il piano Hobby fa
 * partire i cron con un margine fino a un'ora e ci ha gia' fatto perdere tre
 * mattine. Questo gira come task programmata, il martedi': non deve arrivare
 * puntuale, deve arrivare giusto e pronto da copiare.
 *
 * LE DEFINIZIONI NON SI DEDUCONO DAI NOMI DELLE COLONNE. Sono state ricavate il
 * 20 ottobre 2026 rifacendo quattro settimane gia' compilate a mano e tenendo
 * solo le regole che le riproducevano. Accanto a ognuna, qui sotto, c'e' quanto
 * ci andava vicino: e' il modo di sapere, fra sei mesi, di quali numeri ci si
 * puo' fidare.
 *
 *   MKTG Totale          spesa Ads senza ICMD          esatto (17.957,15 vs 17.957)
 *   RISPOSTE             connessioni senza ICMD        entro l'1% su 4 settimane
 *   Appuntamenti         nate, con spesa, senza Eventi entro il 13%
 *   VENDITE / INCASSATO  chiusure Boom senza ICMD      esatto (10 e 40.100)
 *   FATTURATO            fatturato_atteso              esatto (54.500)
 *   CARICATO             tutto l'incassato, rate incl. entro lo 0,3%
 *   INCASSATO SOLO RATE  rate senza ICMD               indicativo (-5%)
 *   Leads / LEAD UNICI   logica Dashboard              NON replica lo storico
 *   Svolti / VENDITE 1a  Advisor Programmi             NON replica lo storico
 *
 * IL PERIMETRO E' SEMPRE "SENZA ICMD". Il foglio misura il funnel High Ticket e
 * ha colonne ICMD separate (Spesa ICMD, Lead ICMD, CPL ICMD): e' la struttura
 * stessa del foglio a dirlo, non una nostra ipotesi.
 *
 * DAL 10/11/2026 ANCHE "SENZA DIPENDENTI ARTIFICIALI", su richiesta del CEO:
 * vedi RE_DA_PRODOTTO e RE_DA_CAMPAGNA.
 */
import "./env";
import { getDb } from "../src/lib/db";
import { leggiSpesaAds } from "../src/lib/spesaAds";
import {
  RE_SUFFISSO_VARIANTE,
  baseAccettabile,
  leggiVariante,
  sqlNomeCampagna,
  sqlFiltroCampagna,
  varianteUnificaNomi,
  SQL_JOIN_BASE
} from "../src/lib/campagne";
import { costruisciQuery } from "../src/lib/queryConversioni";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";
const CHIUSURE = new Set(["Quota unica", "Acconto"]);
const GOAL = 175000;

/** Mezzanotte di Roma: lo scarto si chiede, non si scrive. Vedi report/giornaliero.ts. */
function mezzanotteRoma(data: string): number {
  const utc = new Date(`${data}T00:00:00Z`).getTime();
  const letto = new Date(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .format(utc)
      .replace(" ", "T") + "Z"
  ).getTime();
  return utc - (letto - utc);
}

const piuGiorni = (d: string, n: number) =>
  new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** Il lunedi' della settimana scorsa, in ora di Roma. */
function lunediScorso(): string {
  const oggi = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  const g = new Date(`${oggi}T12:00:00Z`).getUTCDay(); // 0 = domenica
  const daLunedi = (g + 6) % 7;
  return piuGiorni(oggi, -daLunedi - 7);
}

/** Le campagne che in quella settimana hanno avuto spesa, ICMD escluso. */
async function campagneConSpesa(db: ReturnType<typeof getDb>, da: string, a: string) {
  const spesa = (await leggiSpesaAds(da, a)).filter((r) => r.data >= da && r.data <= a);
  const nomi = await db.query<{ id: number; nome: string }>(`SELECT id, nome FROM campagna`);
  const perNome = new Map(nomi.rows.map((r) => [r.nome.trim().toLowerCase(), r.id]));
  const ids = new Set<number>();
  let euro = 0;
  for (const r of spesa) {
    const n = r.campagna.trim().toLowerCase();
    if (n.includes("icmd") || RE_DA_CAMPAGNA.test(n)) continue;
    euro += r.spesa;
    if (r.spesa <= 0) continue;
    let id = perNome.get(n);
    if (id === undefined) {
      // LE VARIANTI TORNANO ALLA BASE: "..._test_creative" non e' una campagna
      // a se', e' la stessa campagna con un'altra creativita'.
      const base = n.replace(RE_SUFFISSO_VARIANTE, "");
      if (base !== n && baseAccettabile(base)) id = perNome.get(base);
    }
    if (id !== undefined) ids.add(id);
  }
  return { ids: [...ids], euro };
}

async function boom(token: string, da: string, a: string) {
  // A PAGINE: una settimana sta sotto i 100 Boom, un mese no (ottobre 2026: 220).
  const righe: Array<{ properties: Record<string, string> }> = [];
  let after: string | undefined;
  do {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/${BOOM}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "data_di_pagamento", operator: "GTE", value: String(mezzanotteRoma(da)) },
              {
                propertyName: "data_di_pagamento",
                operator: "LT",
                value: String(mezzanotteRoma(piuGiorni(a, 1)))
              }
            ]
          }
        ],
        properties: [
          "prodotto", "tipologia_di_incasso", "tipo_di_vendita", "importo", "fatturato_atteso",
          "data_di_pagamento", "hubspot_owner_id", "id_trattativa", "id_contatto_associato"
        ],
        limit: 100,
        ...(after ? { after } : {})
      })
    });
    if (!r.ok) throw new Error(`HubSpot ${r.status} sui Boom`);
    const d = (await r.json()) as {
      results?: Array<{ properties: Record<string, string> }>;
      paging?: { next?: { after?: string } };
    };
    righe.push(...(d.results ?? []));
    after = d.paging?.next?.after;
  } while (after);
  return righe;
}

/**
 * QUANDO OGNI TRATTATIVA E' ENTRATA IN RIPIANIFICATA, dalla cronologia delle
 * fasi su HubSpot: deal_id -> istanti (ms) di ingresso. Chi non c'e' mai
 * passata non compare.
 *
 * NON SI PUO' USARE `trattativa.ripianificata_al`: e' pieno solo finche' la
 * trattativa E' in Ripianificata, e si svuota appena la consulenza nuova si
 * tiene. Sulle vendite, tutte gia' vinte, non scartava mai niente. Misurato
 * sulla settimana 45 (2-8/11/2026): dei 68 primi appuntamenti ne escludeva 6,
 * la cronologia dice 17. Ci si e' accorti il 10/11/2026 perche' CR 1 APP
 * era uscito al 21%.
 *
 * Tutte le pipeline: "Ripianificata" esiste in piu' d'una, con id diversi.
 */
async function ingressiRipianificata(token: string, dealIds: string[]) {
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const p = await fetch(`${HUBSPOT}/crm/v3/pipelines/deals`, { headers: H });
  if (!p.ok) throw new Error(`HubSpot ${p.status} sulle pipeline`);
  const pipeline = (await p.json()) as { results: Array<{ stages: Array<{ id: string; label: string }> }> };
  const fasi = new Set(
    pipeline.results.flatMap((x) => x.stages).filter((s) => /ripianific/i.test(s.label)).map((s) => s.id)
  );
  if (!fasi.size) throw new Error("Nessuna fase Ripianificata nelle pipeline HubSpot");

  const out = new Map<string, number[]>();
  const ids = [...new Set(dealIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/deals/batch/read`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        inputs: ids.slice(i, i + 50).map((id) => ({ id })),
        propertiesWithHistory: ["dealstage"]
      })
    });
    // 207 = alcune trattative cancellate su HubSpot: le altre arrivano lo stesso.
    if (!r.ok && r.status !== 207) throw new Error(`HubSpot ${r.status} sulla cronologia delle fasi`);
    const d = (await r.json()) as {
      results?: Array<{ id: string; propertiesWithHistory?: { dealstage?: Array<{ value: string; timestamp: string }> } }>;
    };
    for (const x of d.results ?? []) {
      const quando = (x.propertiesWithHistory?.dealstage ?? [])
        .filter((h) => fasi.has(h.value))
        .map((h) => new Date(h.timestamp).getTime());
      if (quando.length) out.set(x.id, quando);
    }
  }
  return out;
}

/**
 * DIPENDENTI ARTIFICIALI FUORI DA TUTTO IL CONTO, come ICMD: lo ha chiesto il
 * CEO (riferito da Angelo il 10/11/2026). Fuori la spesa, i lead, le risposte
 * e gli appuntamenti delle sue campagne, e i Boom del prodotto.
 *
 * Il prodotto sui Boom e' una lista chiusa: "D.A.", "D.A. Singolo",
 * "D.A. Microimprese", "D.A. PMI", "D.A. Enterprise". "Vendite Artificiali"
 * e' un altro prodotto e resta dentro.
 *
 * Le campagne non hanno un prefisso unico: oggi sono lms_dipart_* (2.140 euro
 * nella settimana 45), prima lms_imprenditoria_*_dipendenti_artificiali e
 * lms_imprenditoria_{quiz,video,guida}_dipendenti. Restano dentro
 * "da_dipendente_a_imprenditore" (MBE Management) e "marketing_artificiale"
 * (MBE Marketing).
 */
const RE_DA_PRODOTTO = /^\s*d\.?\s*a\.?(\s|$)/i;
const RE_DA_CAMPAGNA = /dipart|dipendenti_artificiali|imprenditoria_.*dipendenti/i;
const SQL_DA_PRODOTTO = `'^\\s*[dD]\\.?\\s*[aA]\\.?(\\s|$)'`;
const SQL_DA_CAMPAGNA = `'dipart|dipendenti_artificiali|imprenditoria_.*dipendenti'`;

const EVENTI = `(SELECT lower(nome) FROM utente_team_adesso WHERE team_nome = 'Eventi')`;
const PROGRAMMI = `(SELECT lower(nome) FROM utente_team_adesso WHERE team_nome = 'Programmi')`;

(async () => {
  const da = process.argv[2] ?? lunediScorso();
  const a = piuGiorni(da, 6);
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.error("HUBSPOT_PRIVATE_APP_TOKEN non impostata");
    process.exit(1);
  }
  const db = getDb();
  const { ids, euro: mktg } = await campagneConSpesa(db, da, a);

  // LEAD: le due misure della tabella Campagne, ICMD escluso.
  const lead = await db.query<{ campagna: string; lead_generati: number; lead_unici: number }>(
    costruisciQuery(leggiVariante(null)),
    [da, a]
  );
  const senzaIcmd = lead.rows.filter((r) => !/icmd/i.test(r.campagna) && !RE_DA_CAMPAGNA.test(r.campagna));
  const leadTotali = senzaIcmd.reduce((s, r) => s + Number(r.lead_generati), 0);
  const leadUnici = senzaIcmd.reduce((s, r) => s + Number(r.lead_unici), 0);

  // RISPOSTE: le chiamate connesse per campagna, ICMD escluso.
  const v = leggiVariante(null);
  const ch = await db.query<{ campagna: string; connessioni: number }>(
    `SELECT ${sqlNomeCampagna(v)} AS campagna, COUNT(*) FILTER (WHERE ch.connessa)::int AS connessioni
     FROM chiamata ch JOIN campagna c ON c.id = ch.campagna_id
     ${varianteUnificaNomi(v) ? SQL_JOIN_BASE : ""}
     WHERE ch.ts >= $1::date AND ch.ts < ($2::date + INTERVAL '1 day') AND ${sqlFiltroCampagna(v)}
     GROUP BY 1`,
    [da, a]
  );
  const risposte = ch.rows
    .filter((r) => !/icmd/i.test(r.campagna) && !RE_DA_CAMPAGNA.test(r.campagna))
    .reduce((s, r) => s + Number(r.connessioni), 0);

  // APPUNTAMENTI, SVOLTI E VENDITE DA PRIMO APPUNTAMENTO.
  //
  // I TEAM SI AGGANCIANO PER NOME, non per id: gli id di utente_team_adesso non
  // coincidono con proprietario_id (e' l'identita' spaccata di alcune schede).
  // Il prezzo e' che una persona rinominata su HubSpot esce dal conto finche'
  // la fotografia dei team non si aggiorna.
  const t = (
    await db.query<Record<string, string>>(
      `SELECT
        (SELECT COUNT(*) FROM trattativa t
          LEFT JOIN proprietario p ON p.id::text = t.proprietario_id::text
          WHERE t.creata_ts >= $1::date AND t.creata_ts < ($2::date + INTERVAL '1 day')
            AND t.campagna_id = ANY($3::int[])
            AND (p.nome IS NULL OR lower(p.nome) NOT IN ${EVENTI}))::text AS appuntamenti`,
      [da, a, ids]
    )
  ).rows[0];
  const appuntamenti = Number(t.appuntamenti);

  // SVOLTI DA 1° APP: i contatti la cui prima consulenza in assoluto cade in
  // settimana, con un advisor Programmi, su una trattativa MAI passata da
  // Ripianificata (cronologia HubSpot, vedi ingressiRipianificata).
  const prime = await db.query<{ deal_id: string }>(
    `SELECT prima.deal_id::text AS deal_id FROM (
        SELECT DISTINCT ON (contact_id) contact_id, deal_id, svolta_ts, proprietario_id, campagna_id, prodotto
        FROM trattativa
        WHERE svolta_ts IS NOT NULL
        ORDER BY contact_id, svolta_ts
      ) prima
      JOIN proprietario p ON p.id::text = prima.proprietario_id::text
      LEFT JOIN campagna c ON c.id = prima.campagna_id
      WHERE prima.svolta_ts >= $1::date AND prima.svolta_ts < ($2::date + INTERVAL '1 day')
        AND lower(p.nome) IN ${PROGRAMMI}
        AND COALESCE(c.nome, '') !~* ${SQL_DA_CAMPAGNA}
        AND COALESCE(prima.prodotto, '') !~ ${SQL_DA_PRODOTTO}`,
    [da, a]
  );

  // SOLDI.
  const righe = (await boom(token, da, a)).filter((b) => !RE_DA_PRODOTTO.test(b.properties.prodotto ?? ""));
  const noIcmd = righe.filter((b) => !/icmd/i.test(b.properties.prodotto ?? ""));
  const chiusure = noIcmd.filter((b) => CHIUSURE.has((b.properties.tipologia_di_incasso ?? "").trim()));
  const rate = noIcmd.filter((b) => (b.properties.tipologia_di_incasso ?? "").trim() === "Rata");
  const somma = (L: typeof righe, campo = "importo") =>
    L.reduce((s, b) => s + (Number(b.properties[campo]) || 0), 0);
  const vendite = chiusure.length;
  const incassato = somma(chiusure);
  const caricato = somma(noIcmd);
  const caricatoTot = somma(righe);
  const fatturato = somma(chiusure, "fatturato_atteso");
  const soloRate = somma(rate);

  // VENDITE DA PRIMO APPUNTAMENTO: le chiusure qui sopra (quindi mai piu' di
  // VENDITE TOTALI) di un advisor Programmi, il cui contatto fino al giorno del
  // pagamento ha avuto UNA sola consulenza svolta e nessuna trattativa
  // ripianificata. Il contatto si prende dalla trattativa del Boom, e solo se
  // manca da id_contatto_associato: chi chiude spesso apre una trattativa nuova
  // gia' vinta, e la consulenza sta su quella vecchia.
  //
  // LA SOLA REGOLA DEL REPORT GIORNALIERO (mai ripianificata) NON BASTA: a
  // ottobre 2026 solo 20 consulenze svolte su 473 erano ripianificate, perche'
  // la seconda consulenza di solito nasce su una trattativa nuova. Nella
  // settimana 44 faceva passare per primo appuntamento un cliente con 15
  // consulenze alle spalle. Le vendite senza nessuna consulenza sul CRM
  // (trattativa creata gia' vinta) restano fuori: non si puo' dire da dove
  // vengono.
  //
  // FINO AL 3 NOVEMBRE 2026 contava le trattative segnate vinte: nella
  // settimana 44 davano 19 contro 15 vendite, perche' dentro c'erano rate di
  // vendite vecchie, trattative vinte senza nessun pagamento e lo stesso
  // contatto due volte.
  //
  // DAL 10 NOVEMBRE 2026 "nessuna ripianificata" si legge dalla cronologia
  // delle fasi su HubSpot: nessuna trattativa del contatto deve essere entrata
  // in Ripianificata prima della fine del giorno del pagamento. Prima si usava
  // ripianificata_al, che sulle trattative vinte e' sempre vuoto.
  const v1 = await db.query<{ contatto: string; fine: string; deals: string[] }>(
    `SELECT DISTINCT ON (c.contatto) c.contatto,
            ((b.pagato::timestamptz AT TIME ZONE 'Europe/Rome')::date + INTERVAL '1 day')
              AT TIME ZONE 'Europe/Rome' AS fine,
            (SELECT array_agg(t.deal_id::text) FROM trattativa t WHERE t.contact_id::text = c.contatto) AS deals
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS b(deal, contatto, owner, pagato)
     LEFT JOIN trattativa td ON td.deal_id::text = b.deal
     CROSS JOIN LATERAL (SELECT COALESCE(td.contact_id::text, b.contatto) AS contatto) c
     JOIN proprietario p ON p.id::text = b.owner
     WHERE lower(p.nome) IN ${PROGRAMMI}
       AND (SELECT COUNT(*) FROM trattativa t
            WHERE t.contact_id::text = c.contatto
              AND t.svolta_ts IS NOT NULL
              AND t.svolta_ts < (b.pagato::timestamptz AT TIME ZONE 'Europe/Rome')::date + INTERVAL '1 day') = 1
       -- LA CONSULENZA DEV'ESSERE DELLA STESSA SETTIMANA (deciso da Angelo il
       -- 10/11/2026): AS = AR / AQ, e AQ conta le prime consulenze della
       -- settimana. Senza questo filtro nella 45 entravano 2 vendite su 12 nate
       -- da consulenze di ottobre, che stanno sopra la frazione ma non sotto.
       AND EXISTS (SELECT 1 FROM trattativa t
            WHERE t.contact_id::text = c.contatto
              AND t.svolta_ts >= $5::date AND t.svolta_ts < ($6::date + INTERVAL '1 day'))
     ORDER BY c.contatto, b.pagato`,
    [
      chiusure.map((b) => (b.properties.id_trattativa ?? "").trim()),
      chiusure.map((b) => (b.properties.id_contatto_associato ?? "").trim()),
      chiusure.map((b) => b.properties.hubspot_owner_id ?? ""),
      chiusure.map((b) => b.properties.data_di_pagamento),
      da,
      a
    ]
  );

  const ripianificate = await ingressiRipianificata(token, [
    ...prime.rows.map((r) => r.deal_id),
    ...v1.rows.flatMap((r) => r.deals ?? [])
  ]);
  const svolti1 = prime.rows.filter((r) => !ripianificate.has(r.deal_id)).length;
  const vendite1 = v1.rows.filter((r) => {
    const fine = new Date(r.fine).getTime();
    return !(r.deals ?? []).some((d) => (ripianificate.get(d) ?? []).some((ts) => ts < fine));
  }).length;

  // I NUMERI COME LI VUOLE IL FOGLIO: virgola decimale e NESSUN separatore di
  // migliaia, che in un incollaggio trasformerebbe il numero in testo.
  const n = (x: number, dec = 2) => x.toFixed(dec).replace(".", ",");
  const pct = (parte: number, su: number) => (su > 0 ? n((parte / su) * 100) + "%" : "");

  const celle: Array<[string, string, string]> = [
    ["AA", "MKTG Totale", n(mktg)],
    ["AB", "Leads Totali", String(leadTotali)],
    ["AC", "cpl leads tot", leadTotali ? n(mktg / leadTotali) : ""],
    ["AE", "LEAD UNICI (NUOVI) TOTALI", String(leadUnici)],
    ["AF", "cpl lead unici TOT", leadUnici ? n(mktg / leadUnici) : ""],
    ["AG", "Lead unici per Vendite CR", pct(vendite, leadUnici)],
    ["AL", "RISPOSTE", String(risposte)],
    ["AM", "CR", pct(appuntamenti, risposte)],
    ["AO", "Appuntamenti processati", String(appuntamenti)],
    ["AP", "CR", pct(vendite, appuntamenti)],
    ["AQ", "Svolti da 1 APP", String(svolti1)],
    ["AR", "VENDITE DA APP 1", String(vendite1)],
    ["AS", "CR 1 APP", pct(vendite1, svolti1)],
    ["AT", "VENDITE TOTALI", String(vendite)],
    ["AU", "INCASSATO SOLO NUOVE VENDITE TELEFONICHE", n(incassato)],
    ["AV", "CARICATO VENDITE TELEFONICHE", n(caricato)],
    ["AW", "GOAL 175k", pct(caricato, GOAL)],
    ["AX", "FATTURATO VENDITE TELEFONICHE", n(fatturato)],
    ["BD", "CARICATO TOTALE", n(caricatoTot)],
    ["BE", "FATTURATO", n(fatturato)],
    ["BH", "INCASSATO SOLO RATE", n(soloRate)],
    ["BJ", "vendita media sul FATTURATO totale", vendite ? n(fatturato / vendite) : ""],
    ["BL", "% MARKETING SU INCASSO", pct(mktg, caricato)]
  ];

  /** Il numero ISO della settimana, come nella colonna D del foglio. */
  const settimana = (() => {
    const d = new Date(`${da}T12:00:00Z`);
    const g = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    g.setUTCDate(g.getUTCDate() + 4 - (g.getUTCDay() || 7));
    return Math.ceil(((g.getTime() - Date.UTC(g.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  })();
  const ita = (d: string) => d.split("-").reverse().join("/");

  // IL MESE E' QUELLO DEL GIOVEDI', cioe' dove cade la maggior parte della
  // settimana: nel foglio 31/08-06/09 e' "Settembre", 27/07-02/08 e' "Luglio".
  const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio",
    "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
  const mese = MESI[Number(piuGiorni(da, 3).slice(5, 7)) - 1];

  // A, C E D VANNO A PARTE: fra D e AA ci sono colonne nascoste che la riga
  // intera, incollata da A, cancellerebbe. B e' nascosta e non sappiamo cosa sia.
  const intestazione: Array<[string, string, string]> = [
    ["A", "Mese", mese],
    ["C", "Periodo di Riferimento", `${ita(da)} - ${ita(a)}`],
    ["D", "settimana", String(settimana)]
  ];

  console.log(`\n=== KPI SETTIMANALI - settimana ${settimana}: ${ita(da)} - ${ita(a)} ===\n`);
  for (const [col, nome, valore] of [...intestazione, ...celle]) {
    console.log(`  ${col.padEnd(3)} ${nome.padEnd(42)} ${valore}`);
  }

  // DA AA A BL IN UNA RIGA SOLA, con le colonne che non conosciamo lasciate
  // vuote: si clicca la cella AA della riga nuova e si incolla una volta sola.
  const ordine = [
    "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM",
    "AN", "AO", "AP", "AQ", "AR", "AS", "AT", "AU", "AV", "AW", "AX", "AY", "AZ",
    "BA", "BB", "BC", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BK", "BL"
  ];
  const perCol = new Map(celle.map(([c, , val]) => [c, val]));
  console.log("\n--- INIZIO RIGA ---");
  console.log(`  A: ${mese}`);
  console.log(`  C: ${ita(da)} - ${ita(a)}\t${settimana}`);

  console.log("\n--- RIGA INTERA, da incollare in AA (colonne separate da tabulazione) ---");
  console.log(ordine.map((c) => perCol.get(c) ?? "").join("\t"));

  console.log("\n--- A BLOCCHI, se preferisci non toccare le colonne che non conosco ---");
  let blocco: string[] = [];
  let primo = "";
  for (const c of ordine) {
    if (perCol.has(c)) {
      if (!blocco.length) primo = c;
      blocco.push(perCol.get(c) as string);
    } else if (blocco.length) {
      console.log(`  ${primo}: ${blocco.join("\t")}`);
      blocco = [];
    }
  }
  if (blocco.length) console.log(`  ${primo}: ${blocco.join("\t")}`);
  console.log("");
  process.exit(0);
})().catch((e) => {
  console.error("ERRORE:", e instanceof Error ? e.message : e);
  process.exit(1);
});
