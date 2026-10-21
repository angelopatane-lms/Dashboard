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
    if (n.includes("icmd")) continue;
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
      properties: ["prodotto", "tipologia_di_incasso", "tipo_di_vendita", "importo", "fatturato_atteso"],
      limit: 100
    })
  });
  if (!r.ok) throw new Error(`HubSpot ${r.status} sui Boom`);
  return ((await r.json()) as { results?: Array<{ properties: Record<string, string> }> }).results ?? [];
}

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
  const senzaIcmd = lead.rows.filter((r) => !/icmd/i.test(r.campagna));
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
    .filter((r) => !/icmd/i.test(r.campagna))
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
            AND (p.nome IS NULL OR lower(p.nome) NOT IN ${EVENTI}))::text AS appuntamenti,
        (SELECT COUNT(DISTINCT t.contact_id) FROM trattativa t
          JOIN proprietario p ON p.id::text = t.proprietario_id::text
          WHERE t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day')
            AND t.ripianificata_al IS NULL AND lower(p.nome) IN ${PROGRAMMI})::text AS svolti,
        (SELECT COUNT(*) FROM trattativa t
          JOIN proprietario p ON p.id::text = t.proprietario_id::text
          WHERE t.vinta_ts >= $1::date AND t.vinta_ts < ($2::date + INTERVAL '1 day')
            AND t.ripianificata_al IS NULL AND lower(p.nome) IN ${PROGRAMMI})::text AS vendite1`,
      [da, a, ids]
    )
  ).rows[0];
  const appuntamenti = Number(t.appuntamenti);
  const svolti1 = Number(t.svolti);
  const vendite1 = Number(t.vendite1);

  // SOLDI.
  const righe = await boom(token, da, a);
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
