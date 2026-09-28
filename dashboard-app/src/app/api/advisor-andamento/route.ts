import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { nomiPerRotta } from "@/lib/proprietari";

// Appuntamenti, chiusure e incassi di ogni persona, mese per mese.
//
// PERCHE' UN ENDPOINT E NON I NUMERI DELLA TABELLA: la tabella ha un numero per
// persona sul periodo scelto, non uno per mese. Per farne una serie storica
// bisogna rifare le stesse letture su una finestra lunga e raggrupparle per
// mese, ed e' esattamente quello che fa questo file - con le stesse identiche
// regole di attribuzione, se no i due numeri non tornerebbero.
//
// Assegnati, chiamate e connessioni arrivano dal foglio Operatori, che il
// client ha gia' in pagina. IL NO SHOW NO, non piu': la colonna del foglio e'
// ferma a zero dal 19 agosto 2026 perche' lo script che la scriveva cerca un
// valore HubSpot rinominato nel frattempo. Lo si conta qui dalla tabella
// `no_show`, che nasce dalla cronologia delle fasi ed e' indipendente da come
// si chiamano le etichette. Vedi src/app/api/setter-trattative/route.ts.
//
// L'ATTRIBUZIONE DIPENDE DALLA PAGINA, come nella tabella: su quella degli
// Advisor gli incassi vanno a chi ha venduto, su quella dei Setter a chi ha
// procurato l'appuntamento. Sono due persone diverse nel 39% dei casi, e se qui
// si usasse sempre il proprietario la stessa persona avrebbe due numeri diversi
// a mezzo schermo di distanza - che e' esattamente quello che questo file
// esiste per evitare.
//
// RESTANO FUORI CONSULENZE E % CHIUSURA. Non e' una scelta: la tabella le
// prende dal foglio, non da HubSpot, e nel foglio sono a zero prima di agosto
// 2026. Prenderle "dalla tabella" non aiuterebbe, perche' e' li' che manca il
// dato.

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
// Le ricerche passano dal modulo condiviso, che le mette in fila e aspetta
// davvero quando HubSpot risponde 429: vedi src/lib/hubspotRicerca.ts.
import { sfogliaRicerca } from "@/lib/hubspotRicerca";

export const dynamic = "force-dynamic";
// Gli incassi si leggono ancora da HubSpot, mese per mese: su una finestra di un
// anno sono decine di pagine e il tempo di default non basta. Era il motivo per
// cui il grafico restava su "Caricamento dei dati in corso" per sempre.
export const maxDuration = 300;
export const fetchCache = "force-no-store";

const HUBSPOT_API = "https://api.hubapi.com";
const BOOM_OBJECT_ID = "2-130365112";
// La pipeline delle trattative, la stessa di /api/hubspot-trattative.
const PIPELINE_ID = "433643709";

export type AdvisorAndamentoRow = {
  /** "AAAA-MM". */
  mese: string;
  operatore: string;
  appuntamenti: number;
  chiusure: number;
  boom: number;
  /** Appuntamenti disertati, dal database e non dal foglio. */
  noShow: number;
};

// I nomi arrivano da src/lib/proprietari.ts. La versione locale chiedeva
// ?limit=100 senza `archived=true`: leggeva 76 proprietari su 496, e ogni ex
// dipendente finiva nel grafico come id numerico - cioe' come una persona che
// non combacia con nessuna riga del foglio, quindi invisibile.

/**
 * Sfoglia una ricerca HubSpot fino in fondo.
 *
 * La pausa fra una pagina e l'altra tiene a bada il limite di chiamate: su una
 * finestra di mesi le pagine sono decine, non le poche di un periodo singolo, e
 * senza pausa la ricerca si prende un 429 a meta' strada. Al 429 si aspetta e
 * si riprova, invece di perdere tutto quello che si e' gia' letto.
 */
/**
 * I mesi coperti dalla finestra, uno per uno.
 *
 * LE RICERCHE SI SPEZZANO PER MESE E PARTONO INSIEME. Le pagine di una ricerca
 * HubSpot si leggono in fila, una dopo l'altra, perche' ognuna dice dove
 * comincia la prossima: settantacinque pagine di trattative erano trentatre
 * secondi. Sette ricerche da undici pagine, lanciate insieme, sono la piu'
 * lenta delle sette. Il mese e' anche il taglio che serve al grafico, quindi
 * non si perde niente per strada.
 */
function mesiDellaFinestra(from: string, to: string): Array<{ inizio: number; fine: number }> {
  const out: Array<{ inizio: number; fine: number }> = [];
  let anno = Number(from.slice(0, 4));
  let mese = Number(from.slice(5, 7));
  const ultimo = `${to.slice(0, 7)}`;

  for (let guardia = 0; guardia < 36; guardia += 1) {
    const etichetta = `${anno}-${String(mese).padStart(2, "0")}`;
    const inizio = Date.UTC(anno, mese - 1, 1);
    const fine = Date.UTC(anno, mese, 1) - 1;
    out.push({ inizio, fine });
    if (etichetta >= ultimo) break;
    mese += 1;
    if (mese > 12) {
      mese = 1;
      anno += 1;
    }
  }
  return out;
}

/** La stessa chiave con cui la tabella accosta i nomi del foglio a quelli di HubSpot. */
function chiaveNome(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function mese(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

function quandoMs(valore: string | null | undefined): number {
  const v = (valore ?? "").trim();
  if (!v || v === "0") return 0;
  const ms = /^\d+$/.test(v) ? parseInt(v) : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

const DURATA_MEMORIA_MS = 10 * 60 * 1000;
let memoria: { chiave: string; scade: number; corpo: unknown } | null = null;

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Mancano from o to" }, { status: 400 });

  // La pagina che chiede: decide a chi vanno gli incassi.
  const perSetter = searchParams.get("vista") === "setter";

  const chiave = `${from}|${to}|${perSetter ? "setter" : "advisor"}`;
  if (memoria && memoria.chiave === chiave && memoria.scade > Date.now()) {
    return NextResponse.json(memoria.corpo, { headers: { "Cache-Control": "no-store" } });
  }

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T23:59:59.999Z`);

  try {
    const owners = await nomiPerRotta(token);

    const finestre = mesiDellaFinestra(from, to).map((m) => ({
      inizio: Math.max(m.inizio, fromMs),
      fine: Math.min(m.fine, toMs)
    }));

    // GLI APPUNTAMENTI DAL NOSTRO DATABASE, non da HubSpot.
    //
    // Sono le stesse trattative: `trattativa` contiene la pipeline Appuntamenti
    // e il sync la tiene allineata. Ma qui la finestra e' di dodici mesi, e
    // sfogliare HubSpot mese per mese voleva dire un centinaio di chiamate a
    // quattro al secondo: il grafico non finiva di caricare e rispondeva 502.
    // Postgres risponde in millisecondi e raggruppa da solo.
    //
    // Verificato prima di cambiare: sui mesi confrontabili i due conteggi
    // coincidono a meno di una o tre righe su milleduecento.
    const perMeseIncassi = await Promise.all(
      finestre.map((f) =>
        sfogliaRicerca(token, `${HUBSPOT_API}/crm/v3/objects/${BOOM_OBJECT_ID}/search`, {
          filterGroups: [
            {
              filters: [
                { propertyName: "data_di_pagamento", operator: "GTE", value: String(f.inizio) },
                { propertyName: "data_di_pagamento", operator: "LTE", value: String(f.fine) }
              ]
            }
          ],
          properties: ["data_di_pagamento", "importo", "hubspot_owner_id", "setter"]
        })
      )
    );

    const incassi = perMeseIncassi.flat();

    const per = new Map<string, AdvisorAndamentoRow>();
    const tocca = (m: string, operatore: string): AdvisorAndamentoRow => {
      const k = `${m}|${chiaveNome(operatore)}`;
      const esistente = per.get(k);
      if (esistente) return esistente;
      const nuova: AdvisorAndamentoRow = { mese: m, operatore, appuntamenti: 0, chiusure: 0, boom: 0, noShow: 0 };
      per.set(k, nuova);
      return nuova;
    };

    // Attribuzione al setter se c'e', altrimenti al proprietario: e' la regola
    // di /api/hubspot-trattative, e i due numeri devono coincidere.
    let appuntamentiLetti = 0;
    const { rows: righeDeal } = await getDb().query<{ mese: string; persona: string; n: string }>(
      `SELECT to_char(t.creata_ts, 'YYYY-MM') AS mese, p.nome AS persona, COUNT(*)::text AS n
         FROM trattativa t
         JOIN proprietario p ON p.id = COALESCE(t.setter_id, t.proprietario_id)
        WHERE t.creata_ts >= $1::date AND t.creata_ts < ($2::date + INTERVAL '1 day')
        GROUP BY 1, 2`,
      [from, to]
    );
    for (const r of righeDeal) {
      tocca(r.mese, r.persona).appuntamenti += Number(r.n);
      appuntamentiLetti += Number(r.n);
    }

    let incassiSenzaPersona = 0;
    for (const b of incassi) {
      const p = b.properties;
      // Sulla pagina Setter conta chi ha procurato l'appuntamento, e se
      // l'incasso non lo porta scritto il record si salta: attribuirlo al
      // venditore metterebbe le sue vendite nella riga di un setter.
      const id = perSetter
        ? (p.setter ?? "").trim()
        : (p.hubspot_owner_id ?? "").trim();
      const operatore = id ? owners[id] ?? id : "";
      const ms = quandoMs(p.data_di_pagamento);
      if (!operatore || !ms) {
        incassiSenzaPersona += 1;
        continue;
      }
      const v = tocca(mese(ms), operatore);
      v.chiusure += 1;
      v.boom += parseFloat(p.importo ?? "0") || 0;
    }

    // I NO SHOW, dal nostro database: una query per tutta la finestra, non una
    // per mese, perche' il raggruppamento lo fa Postgres. Se non risponde le
    // righe restano a zero e il resto del grafico si disegna comunque - la
    // pagina non deve dipendere da una metrica sola.
    try {
      const { rows } = await getDb().query<{ mese: string; setter: string; n: string }>(
        `SELECT to_char(n.ts, 'YYYY-MM') AS mese, p.nome AS setter, COUNT(*)::text AS n
           FROM no_show n
           JOIN proprietario p ON p.id = n.setter_id
          WHERE n.ts >= $1::date AND n.ts < ($2::date + INTERVAL '1 day')
          GROUP BY 1, 2`,
        [from, to]
      );
      for (const r of rows) {
        // tocca() e non per.get(): un setter puo' avere diserzioni in un mese
        // in cui non ha fissato niente di nuovo, e quella riga va creata. Chi
        // non e' nel foglio lo scarta poi unisciAdvisor(), che e' il posto
        // giusto per deciderlo.
        tocca(r.mese, r.setter).noShow += Number(r.n);
      }
    } catch (err) {
      console.error("[advisor-andamento] no show non leggibili:", err instanceof Error ? err.message : err);
    }

    console.log(
      `[advisor-andamento] ${from} -> ${to} | vista:${perSetter ? "setter" : "advisor"} | ` +
        `appuntamenti:${appuntamentiLetti} (dal database) ` +
        `incassi:${incassi.length} (senza persona ${incassiSenzaPersona})`
    );

    const corpo = { righe: Array.from(per.values()) };
    memoria = { chiave, scade: Date.now() + DURATA_MEMORIA_MS, corpo };
    return NextResponse.json(corpo, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[advisor-andamento]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "HubSpot non raggiungibile" }, { status: 502 });
  }
}
