import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Gli obiettivi di Boom del mese, per le pagine delle squadre: si leggono e -
 * solo dalla direzione - si scrivono.
 *
 * PERCHE' UNA ROTTA A PARTE E NON `/api/obiettivi`. Quella rotta parla la
 * lingua della Dashboard: chiavi fatte col NOME della persona, perche' la sua
 * tabella e' indicizzata per nome. Le pagine delle squadre ragionano per ID
 * PROPRIETARIO - una persona puo' avere due account, e il nome scritto in
 * `squadre.json` non e' garantito identico a quello su HubSpot. Qui l'aggancio
 * nome-id si fa una volta, da questa parte, dove la tabella `proprietario`
 * c'e' gia': di la' passano solo id.
 *
 * E' LA STESSA CELLA, NON UNA COPIA. Un obiettivo scritto dalla pagina della
 * direzione finisce nella riga che la tabella Setter della Dashboard legge, e
 * viceversa. Due tabelle dello stesso obiettivo con due numeri diversi
 * sarebbero peggio che non averlo.
 *
 * SI CHIEDE LA CHIAVE, a differenza di `/api/obiettivi` che e' aperta perche'
 * la Dashboard non ha un accesso. Qui dietro c'e' una scrittura chiamata da un
 * altro sito: `SQUADRE_SECRET` e' la stessa chiave delle altre due rotte
 * `/api/squadre/*`, e chi non la ha non entra. Chi puo' scrivere DAVVERO lo
 * decide il progetto Squadre, che e' l'unico a sapere con quale pass si e'
 * entrati: questa rotta si fida di quel controllo come si fida del cron.
 *
 * NESSUNA RISPOSTA MEMORIZZATA: un numero che si digita si deve rileggere
 * uguale subito dopo.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const RE_MESE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Lo stesso tetto di `/api/obiettivi`: oltre, e' un errore di battitura. */
const VALORE_MASSIMO = 10_000_000;

/** La stessa normalizzazione con cui la tabella `obiettivo` e' indicizzata. */
const NOME_NORMALIZZATO = `lower(regexp_replace(trim(nome), '\\s+', ' ', 'g'))`;

function autorizzato(req: NextRequest): NextResponse | null {
  const atteso = process.env.SQUADRE_SECRET;
  if (!atteso) return NextResponse.json({ errore: "SQUADRE_SECRET non impostata" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${atteso}`) {
    return NextResponse.json({ errore: "chiave non valida" }, { status: 403 });
  }
  return null;
}

/**
 * TUTTI i mesi, non quelli di una finestra.
 *
 * Sono una riga per persona per mese: tredici in tutto a novembre 2026, e
 * anche fra un anno saranno poche centinaia di byte. Mandarli tutti costa
 * meno che mettersi d'accordo su quale finestra serve, e lascia alla pagina la
 * liberta' di cambiare periodo senza tornare a chiedere.
 */
export async function GET(req: NextRequest) {
  const no = autorizzato(req);
  if (no) return no;

  try {
    const { rows } = await getDb().query<{ mese: string; id: string; valore: string }>(
      `SELECT o.mese, p.id::text AS id, o.valore::text AS valore
         FROM obiettivo o
         JOIN proprietario p ON ${NOME_NORMALIZZATO} = o.persona`
    );

    // { "2026-10": { "<id proprietario>": 65000 } }
    const obiettivi: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      (obiettivi[r.mese] ??= {})[r.id] = Number(r.valore);
    }

    return NextResponse.json(
      { obiettivi, letto: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[squadre/obiettivi]", e instanceof Error ? e.message : e);
    return NextResponse.json({ errore: "obiettivi non leggibili" }, { status: 502 });
  }
}

/**
 * Scrive un obiettivo, arrivando da un id.
 *
 * VUOTO O ZERO CANCELLANO, come nella cella della Dashboard: e' il modo di
 * togliere un obiettivo sbagliato senza inventare un pulsante.
 *
 * L'ID DEVE ESISTERE fra i proprietari. Il nome lo si ricava da lui e non lo
 * si accetta da fuori: cosi' questa tabella non puo' diventare un posto dove
 * scrivere testo qualunque, che e' la stessa ragione per cui `/api/obiettivi`
 * controlla il nome.
 */
export async function POST(req: NextRequest) {
  const no = autorizzato(req);
  if (no) return no;

  let corpo: { id?: unknown; mese?: unknown; valore?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ errore: "corpo non leggibile" }, { status: 400 });
  }

  const id = String(corpo.id ?? "").trim();
  const mese = String(corpo.mese ?? "").trim();
  if (!/^\d{1,20}$/.test(id)) return NextResponse.json({ errore: "id non valido" }, { status: 400 });
  if (!RE_MESE.test(mese)) return NextResponse.json({ errore: "mese non valido" }, { status: 400 });

  const grezzo = corpo.valore;
  const cancella = grezzo === null || grezzo === "" || grezzo === undefined;
  const valore = cancella ? 0 : Number(grezzo);
  if (!cancella && (!Number.isFinite(valore) || valore < 0 || valore > VALORE_MASSIMO)) {
    return NextResponse.json({ errore: "valore non valido" }, { status: 400 });
  }

  try {
    const db = getDb();
    const { rows } = await db.query<{ persona: string; nome: string }>(
      `SELECT ${NOME_NORMALIZZATO} AS persona, nome FROM proprietario WHERE id = $1::bigint`,
      [id]
    );
    const persona = rows[0]?.persona;
    if (!persona) {
      return NextResponse.json({ errore: "proprietario non riconosciuto" }, { status: 400 });
    }

    if (cancella || valore === 0) {
      await db.query(`DELETE FROM obiettivo WHERE persona = $1 AND mese = $2`, [persona, mese]);
      return NextResponse.json({ id, nome: rows[0].nome, mese, valore: null });
    }

    await db.query(
      `INSERT INTO obiettivo (persona, mese, valore) VALUES ($1, $2, $3)
       ON CONFLICT (persona, mese) DO UPDATE SET valore = EXCLUDED.valore`,
      [persona, mese, valore]
    );
    return NextResponse.json({ id, nome: rows[0].nome, mese, valore });
  } catch (e) {
    console.error("[squadre/obiettivi] scrittura", e instanceof Error ? e.message : e);
    return NextResponse.json({ errore: "obiettivo non salvato" }, { status: 502 });
  }
}
