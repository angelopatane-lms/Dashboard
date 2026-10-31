/**
 * I numeri di ogni persona, giorno per giorno, per le pagine delle squadre.
 *
 * PERCHE' STA QUI E NON NELLO SCRIPT. Lo stesso calcolo serve in due posti: lo
 * script che si lancia a mano (`scripts/squadre-giorno.ts`) e la rotta che il
 * progetto Squadre chiama ogni mattina (`/api/squadre/giorni`). Ricopiarlo
 * vorrebbe dire due definizioni di "chiusura" che prima o poi divergono.
 *
 * LE DEFINIZIONI NON SONO NUOVE NEMMENO QUI. Vengono da
 * `src/lib/report/giornaliero.ts`, importate e non ricopiate: lo stesso codice
 * che fa il report delle 8. Se una regola cambia li', cambia qui lo stesso
 * giorno.
 *
 *   svolte e no show      DAL DATABASE, non dalle fasi delle trattative.
 *                         `trattativa.svolta_ts` dice il giorno in cui la
 *                         consulenza si e' svolta; la fase dice dove sta la
 *                         trattativa adesso, che e' un'altra domanda. Le due
 *                         strade, misurate il 16 ottobre 2026, davano 20
 *                         contro 31. Il proprietario di quelle trattative non
 *                         sta nel database, quindi si chiede a HubSpot in
 *                         blocchi da 100.
 *
 *   appuntamenti fissati  trattative NATE quel giorno nella pipeline, contate
 *                         al SETTER. Il campo `setter` e' un id di
 *                         proprietario, non un nome.
 *
 *   chiusure e venduto    Boom con `data_di_pagamento` quel giorno e tipologia
 *                         Quota unica o Acconto, contati al proprietario. Le
 *                         Rate stanno in una voce a parte: sono incasso, non
 *                         vendita nuova.
 *
 *   storni                Boom con `boom_stage` = `recessed` (l'etichetta che
 *                         si legge in HubSpot e' "Richiesta rimborso", ma la
 *                         proprieta' contiene il VALORE INTERNO: confrontare
 *                         con l'etichetta non e' mai vero, ed e' l'errore che
 *                         teneva la colonna a zero fino al 31 ottobre 2026).
 *                         Attribuiti al GIORNO DEL PAGAMENTO e non al giorno
 *                         della richiesta: cosi' il venduto netto di quel
 *                         giorno scende davvero, invece di lasciare un giorno
 *                         gonfio e uno negativo. E' il motivo per cui la
 *                         finestra di ricalcolo e' di 30 giorni.
 *
 *                         OGGI QUELLA PROPRIETA' NON LA RIEMPIE NESSUNO: su
 *                         6.412 Boom di sempre, tre soli hanno `recessed`,
 *                         tutti da 10 euro e di inizio 2025, con l'aria di
 *                         essere prove. Nessun Boom ha importo negativo. La
 *                         colonna quindi restera' a zero finche' i recessi
 *                         non si cominceranno a segnare li' - e allora
 *                         funzionera' da sola, senza toccare questo codice.
 *
 * IL DATABASE SI SVEGLIA UNA VOLTA SOLA per esecuzione, per le svolte e i no
 * show. Tutto il resto e' HubSpot. Neon si paga a ore di accensione, non a
 * query: un'esecuzione al giorno costa i suoi cinque minuti di minimo e basta.
 */
import { getDb } from "@/lib/db";
import { PIPELINE_HT, FASE, estremiRoma, sfoglia } from "@/lib/report/giornaliero";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";
const CHIUSURE = new Set(["Quota unica", "Acconto"]);
/** Il valore interno, non l'etichetta "Richiesta rimborso" che si vede a schermo. */
const RIMBORSO = "recessed";

/** Un giorno piu' o meno n, senza farsi ingannare dall'ora legale. */
export const piuGiorni = (d: string, n: number) =>
  new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** Il giorno di Roma di un istante, comunque sia scritto. */
function giornoRoma(grezzo: string | undefined): string {
  const v = (grezzo ?? "").trim();
  if (!v) return "";
  const ms = /^\d+$/.test(v) ? Number(v) : new Date(v).getTime();
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
}

export type Voci = {
  fissati: number;
  inProgramma: number;
  svolti: number;
  svoltiPrimi: number;
  noShow: number;
  nonRegistrati: number;
  chiusure: number;
  venduto: number;
  storni: number;
  vendutoStornato: number;
  rate: number;
  chiusureComeSetter: number;
  vendutoComeSetter: number;
};

export type Finestra = {
  generato: string;
  finestra: { da: string; a: string };
  nomi: Record<string, string>;
  giorni: Record<string, Record<string, Voci>>;
};

export type Storico = {
  generato: string;
  primoGiorno: string;
  ultimoGiorno: string;
  nomi: Record<string, string>;
  giorni: Record<string, Record<string, Voci>>;
};

const vuote = (): Voci => ({
  fissati: 0,
  inProgramma: 0,
  svolti: 0,
  svoltiPrimi: 0,
  noShow: 0,
  nonRegistrati: 0,
  chiusure: 0,
  venduto: 0,
  storni: 0,
  vendutoStornato: 0,
  rate: 0,
  chiusureComeSetter: 0,
  vendutoComeSetter: 0
});

/** Le trattative chieste per id, in blocchi da 100. */
async function trattativePerId(
  token: string,
  ids: string[],
  properties: string[]
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  for (let i = 0; i < ids.length; i += 100) {
    const blocco = ids.slice(i, i + 100);
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/deals/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties, inputs: blocco.map((id) => ({ id })) })
    });
    if (!r.ok) {
      // UNA TRATTATIVA CANCELLATA fa fallire tutto il blocco con 207/404: si
      // lascia perdere quel blocco invece di fermare tutto, che e' raro.
      if (r.status === 404 || r.status === 207) continue;
      throw new Error(`HubSpot ${r.status} sul blocco di trattative`);
    }
    const d = (await r.json()) as { results?: Array<{ id: string; properties: Record<string, string> }> };
    for (const t of d.results ?? []) out.set(t.id, t.properties);
  }
  return out;
}

/**
 * Il nome di ogni proprietario, per id.
 *
 * ANCHE QUELLI ARCHIVIATI, in una seconda chiamata: chi ha lasciato l'azienda
 * sparisce dall'elenco normale ma resta scritto sulle trattative di allora, e
 * senza questo nello storico comparirebbe un numero al posto di un nome.
 */
async function proprietari(token: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const archiviati of [false, true]) {
    let after: string | undefined;
    do {
      const u = `${HUBSPOT}/crm/v3/owners?limit=100&archived=${archiviati}${after ? `&after=${after}` : ""}`;
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) break;
      const d = (await r.json()) as {
        results?: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
        paging?: { next?: { after?: string } };
      };
      for (const o of d.results ?? []) {
        const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || (o.email ?? "");
        if (nome && !m.has(String(o.id))) m.set(String(o.id), nome + (archiviati ? " (archiviato)" : ""));
      }
      after = d.paging?.next?.after;
    } while (after);
  }
  return m;
}

/**
 * Svolte e no show di una finestra, con il proprietario di ogni trattativa.
 *
 * Una lettura sola del database per tutta la finestra, non una al giorno.
 */
async function consulenzeConProprietario(token: string, da: string, a: string) {
  const db = getDb();
  const [svolte, disertate] = await Promise.all([
    db.query<{ deal_id: string; giorno: string; prima: boolean }>(
      `SELECT deal_id::text AS deal_id,
              to_char((svolta_ts AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM-DD') AS giorno,
              (ripianificata_al IS NULL) AS prima
         FROM trattativa
        WHERE svolta_ts >= ($1::date::timestamp AT TIME ZONE 'Europe/Rome')
          AND svolta_ts <  (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Rome')`,
      [da, a]
    ),
    db.query<{ deal_id: string; giorno: string }>(
      `SELECT n.deal_id::text AS deal_id,
              to_char((n.ts AT TIME ZONE 'Europe/Rome')::date, 'YYYY-MM-DD') AS giorno
         FROM no_show n
        WHERE n.ts >= ($1::date::timestamp AT TIME ZONE 'Europe/Rome')
          AND n.ts <  (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Rome')`,
      [da, a]
    )
  ]);

  const ids = [
    ...new Set([...svolte.rows.map((r) => r.deal_id), ...disertate.rows.map((r) => r.deal_id)])
  ];
  const dett = await trattativePerId(token, ids, ["hubspot_owner_id", "setter"]);
  return { svolte: svolte.rows, disertate: disertate.rows, dett };
}

/**
 * Il calcolo vero e proprio, da un giorno all'altro, estremi compresi.
 *
 * Non scrive niente e non sa dove finira' il risultato: lo script lo mette su
 * file, la rotta lo manda per rete.
 */
export async function calcolaFinestra(
  token: string,
  da: string,
  a: string,
  racconta: (riga: string) => void = () => {}
): Promise<Finestra> {
  const giorni: string[] = [];
  for (let g = da; g <= a; g = piuGiorni(g, 1)) giorni.push(g);
  racconta(`finestra: ${da} -> ${a}  (${giorni.length} giorni)`);

  const nomi = await proprietari(token);

  // Una struttura sola: giorno -> persona -> voci.
  const per: Record<string, Record<string, Voci>> = {};
  const voce = (giorno: string, chi: string): Voci => {
    if (!chi) return vuote(); // senza persona il numero non ha dove andare
    per[giorno] ??= {};
    per[giorno][chi] ??= vuote();
    return per[giorno][chi];
  };
  for (const g of giorni) per[g] = {};

  const estremiDa = estremiRoma(da).da;
  const estremiA = estremiRoma(a).a;

  // 1. APPUNTAMENTI FISSATI, al setter.
  const fissate = await sfoglia(
    token,
    "deals",
    [
      { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT },
      { propertyName: "createdate", operator: "GTE", value: String(estremiDa) },
      { propertyName: "createdate", operator: "LT", value: String(estremiA) }
    ],
    ["setter", "hubspot_owner_id", "createdate"],
    400
  );
  for (const t of fissate) {
    const g = giornoRoma(t.properties.createdate);
    if (!per[g]) continue;
    voce(g, (t.properties.setter ?? "").trim()).fissati += 1;
  }
  racconta(`  trattative nate nella finestra: ${fissate.length}`);

  // 2. CONSULENZE IN PROGRAMMA, al proprietario. Due ricerche e poi il
  //    setaccio sul valore, come nel report: i due campi sono sfasati di due
  //    ore e nessuno dei due da solo copre tutte le trattative.
  const largoDa = estremiDa - 24 * 3600 * 1000;
  const largoA = estremiA + 24 * 3600 * 1000;
  const perId = new Map<string, Record<string, string>>();
  for (const campo of ["data_e_ora_appuntamento", "data_appuntamento"]) {
    const righe = await sfoglia(
      token,
      "deals",
      [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT },
        { propertyName: campo, operator: "GTE", value: String(largoDa) },
        { propertyName: campo, operator: "LT", value: String(largoA) }
      ],
      ["dealstage", "data_appuntamento", "data_e_ora_appuntamento", "hubspot_owner_id", "setter"],
      400
    );
    for (const t of righe) if (!perId.has(t.id)) perId.set(t.id, t.properties);
  }
  for (const [, p] of perId) {
    const g = giornoRoma(p.data_e_ora_appuntamento || p.data_appuntamento);
    if (!per[g]) continue;
    const chi = (p.hubspot_owner_id ?? "").trim();
    const v = voce(g, chi);
    v.inProgramma += 1;
    if ((p.dealstage ?? "").trim() === FASE.daSvolgere) v.nonRegistrati += 1;
  }
  racconta(`  consulenze in programma nella finestra: ${perId.size}`);

  // 3. SVOLTE E NO SHOW, dal database, con il proprietario da HubSpot.
  const c = await consulenzeConProprietario(token, da, a);
  for (const r of c.svolte) {
    const chi = (c.dett.get(r.deal_id)?.hubspot_owner_id ?? "").trim();
    if (!per[r.giorno]) continue;
    const v = voce(r.giorno, chi);
    v.svolti += 1;
    if (r.prima) v.svoltiPrimi += 1;
  }
  for (const r of c.disertate) {
    const chi = (c.dett.get(r.deal_id)?.hubspot_owner_id ?? "").trim();
    if (!per[r.giorno]) continue;
    voce(r.giorno, chi).noShow += 1;
  }
  racconta(`  svolte: ${c.svolte.length}   no show: ${c.disertate.length}`);

  // 4. BOOM: chiusure, venduto, storni, rate.
  const boom = await sfoglia(
    token,
    BOOM,
    [
      { propertyName: "data_di_pagamento", operator: "GTE", value: String(estremiDa) },
      { propertyName: "data_di_pagamento", operator: "LT", value: String(estremiA) }
    ],
    [
      "data_di_pagamento",
      "importo",
      "prodotto",
      "tipologia_di_incasso",
      "tipo_di_vendita",
      "boom_stage",
      "hubspot_owner_id",
      "setter"
    ],
    400
  );
  for (const b of boom) {
    const g = giornoRoma(b.properties.data_di_pagamento);
    if (!per[g]) continue;
    const importo = Number(b.properties.importo) || 0;
    const tipologia = (b.properties.tipologia_di_incasso ?? "").trim();
    const stornato = (b.properties.boom_stage ?? "").trim() === RIMBORSO;
    const chi = (b.properties.hubspot_owner_id ?? "").trim();
    const chiSetter = (b.properties.setter ?? "").trim();

    if (CHIUSURE.has(tipologia)) {
      const v = voce(g, chi);
      v.chiusure += 1;
      v.venduto += importo;
      if (stornato) {
        v.storni += 1;
        v.vendutoStornato += importo;
      }
      if (chiSetter) {
        const s = voce(g, chiSetter);
        s.chiusureComeSetter += 1;
        s.vendutoComeSetter += importo;
      }
    } else if (tipologia === "Rata") {
      voce(g, chi).rate += importo;
    }
  }
  racconta(`  boom nella finestra: ${boom.length}`);

  return {
    generato: new Date().toISOString(),
    finestra: { da, a },
    nomi: Object.fromEntries(
      [...new Set(giorni.flatMap((g) => Object.keys(per[g] ?? {})))].map((id) => [
        id,
        nomi.get(id) ?? `(proprietario ${id})`
      ])
    ),
    giorni: per
  };
}

/**
 * Lo storico nuovo, fuso con quello vecchio.
 *
 * SI FONDE, NON SI SOVRASCRIVE: i giorni fuori dalla finestra restano quelli
 * di prima. E' tutto il punto del ricalcolo a 30 giorni - e il motivo per cui
 * chiunque riscriva lo storico deve passare di qui, che sia lo script sul PC o
 * il cron su Vercel.
 */
export function fondi(vecchio: Partial<Storico>, nuovo: Finestra): Storico {
  const giorni = { ...(vecchio.giorni ?? {}), ...nuovo.giorni };
  return {
    generato: nuovo.generato,
    primoGiorno: Object.keys(giorni).sort()[0],
    ultimoGiorno: nuovo.finestra.a,
    nomi: { ...(vecchio.nomi ?? {}), ...nuovo.nomi },
    giorni
  };
}
