import { NextRequest, NextResponse } from "next/server";

// Appuntamenti, chiusure e incassi di ogni persona, mese per mese.
//
// PERCHE' UN ENDPOINT E NON I NUMERI DELLA TABELLA: la tabella ha un numero per
// persona sul periodo scelto, non uno per mese. Per farne una serie storica
// bisogna rifare le stesse letture su una finestra lunga e raggrupparle per
// mese, ed e' esattamente quello che fa questo file - con le stesse identiche
// regole di attribuzione, se no i due numeri non tornerebbero.
//
// Le altre metriche del grafico - assegnati, chiamate, connessioni, no show -
// arrivano dal foglio Operatori, che il client ha gia' in pagina.
//
// RESTANO FUORI CONSULENZE E % CHIUSURA. Non e' una scelta: la tabella le
// prende dal foglio, non da HubSpot, e nel foglio sono a zero prima di agosto
// 2026. Prenderle "dalla tabella" non aiuterebbe, perche' e' li' che manca il
// dato.

export const dynamic = "force-dynamic";

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
};

async function fetchOwners(token: string): Promise<Record<string, string>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/owners?limit=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return {};
  const data = await res.json();
  const map: Record<string, string> = {};
  for (const o of data.results ?? []) {
    map[String(o.id)] = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
  }
  return map;
}

/**
 * Sfoglia una ricerca HubSpot fino in fondo.
 *
 * La pausa fra una pagina e l'altra tiene a bada il limite di chiamate: su una
 * finestra di mesi le pagine sono decine, non le poche di un periodo singolo, e
 * senza pausa la ricerca si prende un 429 a meta' strada. Al 429 si aspetta e
 * si riprova, invece di perdere tutto quello che si e' gia' letto.
 */
async function sfoglia(
  token: string,
  url: string,
  corpo: Record<string, unknown>
): Promise<Array<{ properties: Record<string, string | null> }>> {
  const out: Array<{ properties: Record<string, string | null> }> = [];
  let after: string | undefined;

  do {
    let tentativi = 0;
    let data: { results?: Array<{ properties: Record<string, string | null> }>; paging?: { next?: { after?: string } } } | null = null;

    while (tentativi < 4) {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...corpo, limit: 100, ...(after ? { after } : {}) })
      });
      if (res.ok) {
        data = await res.json();
        break;
      }
      if (res.status === 429) {
        tentativi += 1;
        await new Promise((r) => setTimeout(r, 500 * tentativi));
        continue;
      }
      throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
    }
    if (!data) throw new Error("HubSpot: troppi tentativi");

    out.push(...(data.results ?? []));
    after = data.paging?.next?.after;
    if (after) await new Promise((r) => setTimeout(r, 60));
  } while (after);

  return out;
}

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

  const chiave = `${from}|${to}`;
  if (memoria && memoria.chiave === chiave && memoria.scade > Date.now()) {
    return NextResponse.json(memoria.corpo, { headers: { "Cache-Control": "no-store" } });
  }

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T23:59:59.999Z`);

  try {
    const owners = await fetchOwners(token);

    const finestre = mesiDellaFinestra(from, to).map((m) => ({
      inizio: Math.max(m.inizio, fromMs),
      fine: Math.min(m.fine, toMs)
    }));

    const [perMeseDeal, perMeseIncassi] = await Promise.all([
      // Appuntamenti: le trattative NATE nel mese, attribuite al setter se c'e'
      // e altrimenti al proprietario. E' la regola di /api/hubspot-trattative,
      // copiata perche' i due numeri devono coincidere.
      Promise.all(
        finestre.map((f) =>
          sfoglia(token, `${HUBSPOT_API}/crm/v3/objects/deals/search`, {
            filterGroups: [
              {
                filters: [
                  { propertyName: "createdate", operator: "GTE", value: String(f.inizio) },
                  { propertyName: "createdate", operator: "LTE", value: String(f.fine) },
                  { propertyName: "pipeline", operator: "EQ", value: PIPELINE_ID }
                ]
              }
            ],
            // "createdate" serve anche fra le proprieta' e non solo nel filtro:
            // senza, si sa che il deal e' nella finestra ma non in quale mese.
            properties: ["setter", "hubspot_owner_id", "createdate"]
          })
        )
      ),
      // Chiusure e incassi: per DATA DI PAGAMENTO, come nel grafico delle
      // campagne. Il mese e' quello in cui i soldi sono arrivati.
      Promise.all(
        finestre.map((f) =>
          sfoglia(token, `${HUBSPOT_API}/crm/v3/objects/${BOOM_OBJECT_ID}/search`, {
            filterGroups: [
              {
                filters: [
                  { propertyName: "data_di_pagamento", operator: "GTE", value: String(f.inizio) },
                  { propertyName: "data_di_pagamento", operator: "LTE", value: String(f.fine) }
                ]
              }
            ],
            properties: ["data_di_pagamento", "importo", "hubspot_owner_id"]
          })
        )
      )
    ]);

    const deal = perMeseDeal.flat();
    const incassi = perMeseIncassi.flat();

    const per = new Map<string, AdvisorAndamentoRow>();
    const tocca = (m: string, operatore: string): AdvisorAndamentoRow => {
      const k = `${m}|${chiaveNome(operatore)}`;
      const esistente = per.get(k);
      if (esistente) return esistente;
      const nuova: AdvisorAndamentoRow = { mese: m, operatore, appuntamenti: 0, chiusure: 0, boom: 0 };
      per.set(k, nuova);
      return nuova;
    };

    let dealSenzaPersona = 0;
    for (const d of deal) {
      const p = d.properties;
      const id = (p.setter ?? "").trim() || (p.hubspot_owner_id ?? "").trim();
      const operatore = id ? owners[id] ?? id : "";
      const ms = quandoMs(p.createdate);
      if (!operatore || !ms) {
        dealSenzaPersona += 1;
        continue;
      }
      tocca(mese(ms), operatore).appuntamenti += 1;
    }

    let incassiSenzaPersona = 0;
    for (const b of incassi) {
      const p = b.properties;
      const id = (p.hubspot_owner_id ?? "").trim();
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

    console.log(
      `[advisor-andamento] ${from} -> ${to} | deal:${deal.length} (senza persona ${dealSenzaPersona}) ` +
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
