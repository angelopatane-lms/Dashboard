import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";
import { agganciaRecessi, marcaRecessed, righeRecessi, RECESSED } from "@/lib/recessi/aggancia";

/**
 * I RECESSI DEL FOGLIO DI MARY, PORTATI SU HUBSPOT OGNI NOTTE.
 *
 * PERCHE' ESISTE. La colonna Storni delle pagine squadre conta i Boom con
 * `boom_stage = recessed`, e quella casella la deve mettere una persona a
 * mano: fino all'11 novembre 2026 risultava messa su tre casi in tutta la
 * storia, mentre nel foglio di Mary i recessi erano 192 per 767.193 euro. La
 * colonna diceva zero e nessuno sapeva che fosse una bugia.
 *
 * QUELLA VOLTA LI HO SCRITTI A MANO - 110 Boom, 482.250 euro - ma una
 * passata sola non e' un flusso: il mese dopo il foglio ha righe nuove e la
 * colonna ricomincia a mentire. Questo giro li prende tutte le notti.
 *
 * SI FA MEMORIA DI QUELLO CHE SI E' GIA' GUARDATO, in `recessi_marcati`. Non
 * e' un vezzo: agganciare una riga costa una ricerca contatto piu' una
 * lettura per ogni sua trattativa, e rifare tutte e 192 le righe ogni notte
 * vorrebbe dire un migliaio di chiamate a HubSpot per scoprire che non e'
 * cambiato niente. Con la memoria, un giro normale guarda le poche righe
 * nuove e finisce in pochi secondi.
 *
 * LA CHIAVE E' NOME + IMPORTO, perche' il foglio non ha un numero di riga
 * stabile: si possono inserire righe in mezzo, e l'indice slitterebbe. Nome e
 * importo insieme identificano il recesso meglio della sua posizione.
 *
 * SI SEGNANO ANCHE LE RIGHE CHE NON SI AGGANCIANO, con `boom_id` vuoto: sono
 * 82 su 192, e senza memoria verrebbero ritentate ogni notte per sempre. Chi
 * vuole riprovarle - dopo aver corretto un nome nel foglio - lancia la rotta
 * con `?tutto=si`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function tabella() {
  await getDb().query(`
    CREATE TABLE IF NOT EXISTS recessi_marcati (
      chiave   text PRIMARY KEY,
      boom_id  text,
      importo  numeric,
      quando   timestamptz NOT NULL DEFAULT now()
    )
  `);
}

const chiaveRiga = (nome: string, importo: number) => `${chiaveNome(nome)}|${Math.round(importo)}`;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ errore: "non autorizzato" }, { status: 401 });
  }
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ errore: "HUBSPOT_PRIVATE_APP_TOKEN non impostata" }, { status: 500 });

  const tutto = req.nextUrl.searchParams.get("tutto") === "si";
  const prova = req.nextUrl.searchParams.get("prova") === "si";

  try {
    await tabella();
    const righe = await righeRecessi();

    const { rows } = await getDb().query<{ chiave: string }>(`SELECT chiave FROM recessi_marcati`);
    const viste = new Set(rows.map((r) => r.chiave));
    const nuove = tutto ? righe : righe.filter((r) => !viste.has(chiaveRiga(r.nome, r.importo)));

    if (!nuove.length) {
      return NextResponse.json({
        righeNelFoglio: righe.length,
        nuove: 0,
        messaggio: "niente di nuovo nel foglio"
      });
    }

    const esito = await agganciaRecessi(token, nuove);
    const daMarcare = esito.agganciati.filter((a) => a.faseAttuale !== RECESSED);

    if (prova) {
      return NextResponse.json({
        prova: true,
        righeNelFoglio: righe.length,
        guardate: nuove.length,
        agganciate: esito.agganciati.length,
        daMarcare: daMarcare.length,
        euro: Math.round(daMarcare.reduce((s, a) => s + a.importoBoom, 0)),
        senzaContatto: esito.senzaContatto,
        senzaBoom: esito.senzaBoom
      });
    }

    const scritti = daMarcare.length ? await marcaRecessed(token, daMarcare.map((a) => a.boomId)) : 0;

    // La memoria si scrive DOPO: se la scrittura su HubSpot fallisce, la
    // riga resta nuova e la notte dopo si riprova.
    const db = getDb();
    for (const a of esito.agganciati) {
      await db.query(
        `INSERT INTO recessi_marcati (chiave, boom_id, importo) VALUES ($1, $2, $3)
         ON CONFLICT (chiave) DO UPDATE SET boom_id = EXCLUDED.boom_id, quando = now()`,
        [chiaveRiga(a.riga.nome, a.riga.importo), a.boomId, a.importoBoom]
      );
    }
    // Anche quelle che non si agganciano: senza, si ritentano ogni notte.
    for (const r of nuove) {
      const k = chiaveRiga(r.nome, r.importo);
      if (esito.agganciati.some((a) => chiaveRiga(a.riga.nome, a.riga.importo) === k)) continue;
      await db.query(
        `INSERT INTO recessi_marcati (chiave, boom_id, importo) VALUES ($1, NULL, $2)
         ON CONFLICT (chiave) DO NOTHING`,
        [k, Math.round(r.importo)]
      );
    }

    return NextResponse.json({
      righeNelFoglio: righe.length,
      guardate: nuove.length,
      agganciate: esito.agganciati.length,
      marcate: scritti,
      euro: Math.round(daMarcare.reduce((s, a) => s + a.importoBoom, 0)),
      senzaContatto: esito.senzaContatto,
      senzaBoom: esito.senzaBoom
    });
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[cron/recessi]", perche);
    return NextResponse.json({ errore: perche }, { status: 500 });
  }
}
