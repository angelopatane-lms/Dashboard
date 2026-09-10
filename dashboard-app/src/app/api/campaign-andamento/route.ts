import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { guessCategoria } from "@/lib/campaignCategory";
import { leggiSpesaAds } from "@/lib/spesaAds";
import { SQL_E_VARIANTE_TECNICA, SQL_JOIN_BASE } from "@/lib/campagne";

export const dynamic = "force-dynamic";

const HUBSPOT_API = "https://api.hubapi.com";
const BOOM_OBJECT_ID = "2-130365112";

/** Un mese di una categoria: tutto quello che serve alle metriche del grafico. */
export type AndamentoRow = {
  /** "AAAA-MM". */
  mese: string;
  categoria: string;
  spesa: number;
  lead: number;
  appuntamenti: number;
  consulenze: number;
  /** Numero di incassi registrati, cioe' le vendite chiuse. */
  chiusure: number;
  incasso: number;
};

/**
 * PRIMA DI QUESTO MESE LA STORIA NON E' CONFRONTABILE, e la finestra non ci va
 * mai oltre.
 *
 * Misurato sul database il 9 settembre 2026, le trattative per mese sono:
 * 2025-10: 103, 2025-11: 127, 2025-12: 99, poi 2026-01: 1.096 e da li' sempre
 * oltre mille. Non e' un decuplicarsi dell'attivita' a Capodanno: e' il
 * riempimento iniziale della tabella, che si e' fermato li'. La spesa ha lo
 * stesso confine per un'altra ragione - il foglio "Report Storico" non ha tab
 * prima di gennaio 2026 - e gli incassi, per una terza: novembre 2025 risulta
 * a zero e dicembre a 1.531 EUR contro i 203.770 di ottobre.
 *
 * Un grafico che partisse da ottobre mostrerebbe una crescita spettacolare a
 * gennaio, che non e' successa. Meglio nove mesi veri che dodici di cui tre
 * inventati.
 *
 * Quando la storia verra' riempita all'indietro, qui si cambia una riga.
 */
const PRIMO_MESE_COMPLETO = "2026-01";

/**
 * I MESI SI CONTANO SEMPRE PER INTERO, dal primo giorno del piu' lontano a
 * oggi.
 *
 * Il grafico serve a capire cos'e' normale per una categoria, e per farlo i
 * mesi devono essere confrontabili fra loro: mezzo mese di spesa contro un mese
 * intero non e' un calo, e' un mese piu' corto. L'unico incompleto e' quello in
 * corso, ed e' il client a marcarlo come tale.
 */
function finestra(mesi: number): { from: string; to: string } {
  const oggi = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const anno = Number(oggi.slice(0, 4));
  const mese = Number(oggi.slice(5, 7));
  // Il conto in mesi assoluti evita di trattare a parte il passaggio d'anno.
  const assoluti = anno * 12 + (mese - 1) - (mesi - 1);
  const primoAnno = Math.floor(assoluti / 12);
  const primoMese = (assoluti % 12) + 1;

  const chiesto = `${primoAnno}-${String(primoMese).padStart(2, "0")}`;
  return {
    from: `${chiesto < PRIMO_MESE_COMPLETO ? PRIMO_MESE_COMPLETO : chiesto}-01`,
    to: oggi
  };
}

// Lead Generati mese per mese: persone distinte per campagna, con i marcatori
// "_test_instant" tolti prima di contare.
//
// Il grafico e' per categoria, e i marcatori la categoria non la cambiano - il
// suffisso sta in fondo, il prefisso che decide la categoria sta all'inizio -
// ma la stessa persona comparirebbe due volte, sulla base e sul marcatore. Sul
// trimestre erano il 17% dei lead. Qui si usa sempre la regola delle campagne
// unificate: il filtro Campagna della tabella non arriva fin qui, perche' una
// serie storica di dodici mesi risponde a una domanda sola.
function queryLead(): string {
  return `
    SELECT to_char(date_trunc('month', e.ts), 'YYYY-MM') AS mese,
           COALESCE(b.nome, lower(trim(c.nome))) AS nome,
           COUNT(DISTINCT COALESCE(a.nuovo_id, e.contact_id))::int AS lead
    FROM eventi_conversione e
    JOIN campagna c ON c.id = e.campagna_id
    ${SQL_JOIN_BASE}
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    WHERE e.ts >= $1::date AND e.ts < ($2::date + INTERVAL '1 day')
      AND c.nome = lower(c.nome)
      AND NOT (${SQL_E_VARIANTE_TECNICA})
    GROUP BY 1, 2
  `;
}

// Appuntamenti e consulenze escono dalla stessa tabella letta con due date
// diverse - quando la trattativa e' nata, quando si e' svolta - e quindi
// possono cadere in mesi diversi: vanno raggruppate separatamente e riunite
// alla fine.
function queryTrattative(): string {
  const nome = "COALESCE(b.nome, lower(trim(c.nome)))";
  return `
    WITH nate AS (
      SELECT to_char(date_trunc('month', t.creata_ts), 'YYYY-MM') AS mese,
             ${nome} AS nome, COUNT(*)::int AS n
      FROM trattativa t
      JOIN campagna c ON c.id = t.campagna_id
      ${SQL_JOIN_BASE}
      WHERE t.creata_ts >= $1::date AND t.creata_ts < ($2::date + INTERVAL '1 day')
        AND c.nome = lower(c.nome)
      GROUP BY 1, 2
    ),
    svolte AS (
      SELECT to_char(date_trunc('month', t.svolta_ts), 'YYYY-MM') AS mese,
             ${nome} AS nome, COUNT(*)::int AS n
      FROM trattativa t
      JOIN campagna c ON c.id = t.campagna_id
      ${SQL_JOIN_BASE}
      WHERE t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day')
        AND c.nome = lower(c.nome)
      GROUP BY 1, 2
    )
    SELECT COALESCE(n.mese, s.mese) AS mese,
           COALESCE(n.nome, s.nome) AS nome,
           COALESCE(n.n, 0) AS appuntamenti,
           COALESCE(s.n, 0) AS consulenze
    FROM nate n
    FULL OUTER JOIN svolte s ON s.mese = n.mese AND s.nome = n.nome
  `;
}

/**
 * Gli incassi, presi da HubSpot per DATA DI PAGAMENTO.
 *
 * Non per data di creazione del record: un incasso creato a settembre e pagato
 * a luglio appartiene a luglio, che e' il mese in cui i soldi sono arrivati e
 * quello contro cui va confrontata la spesa di luglio.
 *
 * A differenza della tabella qui non si scartano i record senza proprietario:
 * quella e' una vista per operatore, e un incasso senza operatore non ha una
 * riga a cui appartenere; un grafico dei ricavi che li perdesse mostrerebbe
 * meno soldi di quanti ne sono entrati. Il numero degli scartati finisce nel
 * log, cosi' si vede se le due sezioni possono discostarsi.
 */
async function leggiIncassi(
  token: string,
  fromMs: number,
  toMs: number
): Promise<Array<{ mese: string; campagna: string; importo: number }>> {
  const out: Array<{ mese: string; campagna: string; importo: number }> = [];
  let after: string | undefined;
  let senzaProprietario = 0;
  let senzaCampagna = 0;
  let importoSenzaCampagna = 0;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            { propertyName: "data_di_pagamento", operator: "GTE", value: String(fromMs) },
            { propertyName: "data_di_pagamento", operator: "LTE", value: String(toMs) }
          ]
        }
      ],
      properties: ["data_di_pagamento", "importo", "id_campagna_track", "hubspot_owner_id"],
      limit: 100,
      ...(after ? { after } : {})
    };

    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/${BOOM_OBJECT_ID}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HubSpot search ${res.status}: ${await res.text()}`);
    const data = await res.json();

    for (const r of data.results ?? []) {
      const p = r.properties ?? {};
      if (!(p.hubspot_owner_id ?? "").trim()) senzaProprietario += 1;

      const campagna = (p.id_campagna_track ?? "").trim();
      if (!campagna) {
        // Un incasso senza campagna non ha una categoria a cui appartenere:
        // resta fuori dal grafico, e il log dice quanto pesa.
        senzaCampagna += 1;
        importoSenzaCampagna += parseFloat(p.importo ?? "0") || 0;
        continue;
      }

      const val = (p.data_di_pagamento ?? "").trim();
      if (!val || val === "0") continue;
      const ms = /^\d+$/.test(val) ? parseInt(val) : new Date(val).getTime();
      if (!Number.isFinite(ms) || ms === 0) continue;

      out.push({
        mese: new Date(ms).toISOString().slice(0, 7),
        campagna,
        importo: parseFloat(p.importo ?? "0") || 0
      });
    }

    after = data.paging?.next?.after;
    // La pausa fra una pagina e l'altra tiene a bada il limite di HubSpot. A
    // 200 ms, su diciassette pagine, erano tre secondi e mezzo di sola attesa
    // su otto: 60 bastano, e sotto c'e' comunque la ripetizione in caso di 429.
    if (after) await new Promise((r) => setTimeout(r, 60));
  } while (after);

  console.log(
    `[campaign-andamento] incassi:${out.length} senza proprietario:${senzaProprietario} ` +
      `senza campagna:${senzaCampagna} (${Math.round(importoSenzaCampagna)} EUR non attribuibili)`
  );
  return out;
}

/**
 * L'ultima risposta, tenuta da parte per qualche minuto.
 *
 * Sono totali mensili: fra una visita e l'altra non cambiano, e ricalcolarli
 * costa otto secondi, di cui gran parte a sfogliare gli incassi su HubSpot
 * pagina per pagina. Chi apre la pagina Campagne due volte di fila non deve
 * pagarli due volte.
 *
 * La memoria vive dentro il processo, quindi su Vercel serve finche' quella
 * istanza resta calda: non e' una garanzia, e' un risparmio quando capita.
 */
const DURATA_MEMORIA_MS = 10 * 60 * 1000;
let memoria: { chiave: string; scade: number; corpo: unknown } | null = null;

export async function GET(req: NextRequest) {
  const mesi = Math.min(Math.max(Number(req.nextUrl.searchParams.get("mesi")) || 12, 2), 24);
  const { from, to } = finestra(mesi);

  const chiave = `${from}|${to}`;
  if (memoria && memoria.chiave === chiave && memoria.scade > Date.now()) {
    return NextResponse.json(memoria.corpo, { headers: { "Cache-Control": "no-store" } });
  }

  const vuota = (): Omit<AndamentoRow, "mese" | "categoria"> => ({
    spesa: 0,
    lead: 0,
    appuntamenti: 0,
    consulenze: 0,
    chiusure: 0,
    incasso: 0
  });

  // La chiave e' "mese|categoria": e' la coppia che identifica un punto del
  // grafico, e le quattro fonti ci arrivano per strade diverse.
  const per = new Map<string, AndamentoRow>();
  const tocca = (mese: string, campagna: string): AndamentoRow => {
    const categoria = guessCategoria(campagna);
    const k = `${mese}|${categoria}`;
    const esistente = per.get(k);
    if (esistente) return esistente;
    const nuova: AndamentoRow = { mese, categoria, ...vuota() };
    per.set(k, nuova);
    return nuova;
  };

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

  // Le quattro fonti si chiedono insieme: sono indipendenti, e in fila
  // l'attesa sarebbe la somma invece della piu' lenta. Ognuna risponde per se':
  // se HubSpot non risponde restano spesa, lead e appuntamenti, e a mancare e'
  // il solo ROAS.
  const [lead, trattative, spesa, incassi] = await Promise.all([
    getDb()
      .query(queryLead(), [from, to])
      .then((r) => r.rows as Array<{ mese: string; nome: string; lead: number }>)
      .catch((err) => {
        console.error("[campaign-andamento] lead", err);
        return [];
      }),
    getDb()
      .query(queryTrattative(), [from, to])
      .then(
        (r) =>
          r.rows as Array<{ mese: string; nome: string; appuntamenti: number; consulenze: number }>
      )
      .catch((err) => {
        console.error("[campaign-andamento] trattative", err);
        return [];
      }),
    leggiSpesaAds(from, to).catch((err) => {
      console.error("[campaign-andamento] spesa", err);
      return [];
    }),
    token
      ? leggiIncassi(token, Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T23:59:59Z`)).catch(
          (err) => {
            console.error("[campaign-andamento] incassi", err);
            return [];
          }
        )
      : Promise.resolve([])
  ]);

  for (const r of lead) tocca(r.mese, r.nome).lead += r.lead;
  for (const r of trattative) {
    const v = tocca(r.mese, r.nome);
    v.appuntamenti += Number(r.appuntamenti) || 0;
    v.consulenze += Number(r.consulenze) || 0;
  }
  for (const r of spesa) tocca(r.data.slice(0, 7), r.campagna).spesa += r.spesa;
  for (const r of incassi) {
    const v = tocca(r.mese, r.campagna);
    v.incasso += r.importo;
    v.chiusure += 1;
  }

  const corpo = { righe: Array.from(per.values()), from, to };
  memoria = { chiave, scade: Date.now() + DURATA_MEMORIA_MS, corpo };
  return NextResponse.json(corpo, { headers: { "Cache-Control": "no-store" } });
}
