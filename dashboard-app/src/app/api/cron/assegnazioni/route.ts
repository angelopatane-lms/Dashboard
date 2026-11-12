import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { assegnazioniDalFoglio } from "@/lib/tempoRisposta/foglio";

/**
 * LA STORIA DELLE ASSEGNAZIONI, TRAVASATA DAL FOGLIO AL NOSTRO DATABASE.
 *
 * A COSA SERVE. Per sapere quanto tempo passa fra l'assegnazione di un lead e
 * la prima telefonata servono due cose: le chiamate, che abbiamo in casa dal
 * 2023 (356.471 righe nella tabella `chiamata`), e le assegnazioni, che non
 * abbiamo. HubSpot tiene solo l'ultima assegnazione per contatto, la colonna
 * "Latenza" del foglio e' un conto fatto una volta e non rifacibile, e la
 * scheda Tracking Eventi - che le ha tutte - parte dal 29 ottobre 2026 e non
 * promette di restare. Questo giro ne fa un dato nostro, che si accumula.
 *
 * SI RILEGGONO DUE GIORNI, non solo il giorno nuovo: il foglio lo scrive un
 * webhook, e un webhook puo' arrivare in ritardo o il giro di una notte puo'
 * saltare. Due giorni di sovrapposizione costano qualche decina di KB e
 * coprono il buco; i doppioni li ferma la chiave primaria.
 *
 * LA PRIMA VOLTA prende tutto quello che il foglio ha (dal 1 ottobre, cioe'
 * da prima della sua prima riga): sono circa 13.000 assegnazioni.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Prima dell'inizio del foglio: la prima volta prende tutto. */
const DALL_INIZIO = "2026-10-01";

async function tabella() {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS assegnazione_evento (
      contatto_id     bigint      NOT NULL,
      ts              timestamptz NOT NULL,
      proprietario_id bigint,
      nome            text,
      stato_lead      text,
      stato_prec      text,
      PRIMARY KEY (contatto_id, ts)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS assegnazione_evento_ts ON assegnazione_evento (ts)`);
  // Su una tabella gia' creata prima del 12 novembre 2026 le due colonne non
  // ci sono: si aggiungono qui invece che a mano, cosi' il giro si rimette in
  // pari da solo ovunque venga lanciato.
  await db.query(`ALTER TABLE assegnazione_evento ADD COLUMN IF NOT EXISTS stato_lead text`);
  await db.query(`ALTER TABLE assegnazione_evento ADD COLUMN IF NOT EXISTS stato_prec text`);
  await db.query(`ALTER TABLE assegnazione_evento ADD COLUMN IF NOT EXISTS da_app boolean`);
  // La misura cerca la prima chiamata A QUEL CONTATTO dopo l'assegnazione:
  // senza questo indice e' una scansione delle 356.471 chiamate per ogni lead.
  await db.query(`CREATE INDEX IF NOT EXISTS idx_chiamata_contatto ON chiamata (contact_id, ts)`);
}

export async function GET(req: NextRequest) {
  const atteso = `Bearer ${process.env.CRON_SECRET}`;
  if (req.headers.get("authorization") !== atteso) {
    return NextResponse.json({ errore: "non autorizzato" }, { status: 401 });
  }

  try {
    await tabella();
    const db = getDb();

    const tutto = req.nextUrl.searchParams.get("tutto") === "si";
    const { rows: ultimo } = await db.query<{ dal: string | null }>(
      `SELECT to_char((max(ts) AT TIME ZONE 'Europe/Rome') - interval '2 days', 'YYYY-MM-DD') AS dal
         FROM assegnazione_evento`
    );
    const dal = tutto ? DALL_INIZIO : ultimo[0]?.dal ?? DALL_INIZIO;

    const righe = await assegnazioniDalFoglio(dal);
    const prima = Number(
      (await db.query<{ n: string }>(`SELECT count(*) n FROM assegnazione_evento`)).rows[0].n
    );

    for (let i = 0; i < righe.length; i += 1000) {
      const blocco = righe.slice(i, i + 1000).map((r) => ({
        c: r.contattoId,
        t: r.ts,
        p: r.proprietarioId ?? "",
        n: r.nome,
        s: r.statoLead,
        v: r.statoPrecedente
      }));
      await db.query(
        // DO UPDATE e non DO NOTHING: le righe salvate prima che esistessero
        // le colonne di stato vanno completate, non saltate.
        `INSERT INTO assegnazione_evento (contatto_id, ts, proprietario_id, nome, stato_lead, stato_prec)
         SELECT x.c::bigint, (x.t::timestamp) AT TIME ZONE 'Europe/Rome',
                NULLIF(x.p, '')::bigint, NULLIF(x.n, ''), NULLIF(x.s, ''), NULLIF(x.v, '')
           FROM jsonb_to_recordset($1::jsonb) AS x(c text, t text, p text, n text, s text, v text)
         ON CONFLICT (contatto_id, ts) DO UPDATE
            SET stato_lead = COALESCE(EXCLUDED.stato_lead, assegnazione_evento.stato_lead),
                stato_prec = COALESCE(EXCLUDED.stato_prec, assegnazione_evento.stato_prec)`,
        [JSON.stringify(blocco)]
      );
    }

    /**
     * SI MARCANO LE ASSEGNAZIONI NATE DALL'APP DI ALESSIO.
     *
     * L'app tiene l'elenco esatto dei contatti di ogni richiesta, quindi la
     * firma e' certa: non si indovina, si confronta. Serve perche' quei lead
     * non arrivano a sorpresa - il setter li CHIEDE quando e' pronto a
     * telefonare, e infatti li chiama in 48 minuti di mediana contro le 2,1
     * ore degli altri. Misurarli insieme mescola due gesti diversi.
     *
     * SI RIGUARDANO SETTE GIORNI ogni notte, non solo le righe nuove: la
     * richiesta all'app e l'evento del foglio arrivano per due strade
     * diverse, e possono entrare in archivio a distanza di ore.
     */
    await db.query(`
      WITH app AS (
        SELECT unnest(contatti) AS contatto_id,
               COALESCE(ricevuto_at, chiesto_at) AS quando
          FROM assegnazione_richiesta
         WHERE esito = 'assegnato' AND contatti IS NOT NULL
      )
      UPDATE assegnazione_evento a
         SET da_app = EXISTS (
               SELECT 1 FROM app
                WHERE app.contatto_id = a.contatto_id
                  AND a.ts BETWEEN app.quando - interval '30 minutes'
                               AND app.quando + interval '30 minutes')
       WHERE a.ts >= now() - interval '7 days' OR a.da_app IS NULL
    `);

    const { rows: fine } = await db.query<{ n: string; a: string | null; b: string | null }>(
      `SELECT count(*) n,
              to_char(min(ts) AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') a,
              to_char(max(ts) AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD HH24:MI') b
         FROM assegnazione_evento`
    );

    return NextResponse.json({
      lettoDalFoglio: righe.length,
      dal,
      nuove: Number(fine[0].n) - prima,
      inArchivio: Number(fine[0].n),
      storiaDa: fine[0].a,
      finoA: fine[0].b
    });
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[cron/assegnazioni]", perche);
    return NextResponse.json({ errore: perche }, { status: 500 });
  }
}
