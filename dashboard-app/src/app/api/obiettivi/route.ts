import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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

/**
 * Gli obiettivi di Boom del mese, per persona.
 *
 * E' L'UNICO NUMERO DELLA DASHBOARD CHE NESSUN SISTEMA PRODUCE. Non sta su
 * HubSpot, non lo calcola nessuno, non arriva dal foglio Operatori: lo decide
 * una persona il primo del mese. Finora la colonna Obiettivo esisteva nella
 * tabella ma la sua fonte no, quindi mostrava un trattino a tutti. Si digita
 * nella cella e passa da qui.
 *
 * UN MESE ALLA VOLTA. Su un periodo che copre piu' mesi la lettura restituisce
 * la somma e `mese` vale null: la pagina lo usa per non lasciare scrivere,
 * perche' un numero digitato su "luglio piu' agosto" non si sa a quale dei due
 * appartenga.
 *
 * SULLA SCRITTURA. La dashboard non ha un accesso, quindi questa rotta e'
 * raggiungibile da chiunque raggiunga la pagina. La validazione e' percio'
 * stretta: il nome deve corrispondere a una persona che compare davvero fra gli
 * operatori, il mese deve essere un mese, e la cifra deve stare in un intervallo
 * plausibile. Limita il danno possibile a "qualcuno cambia un obiettivo", che e'
 * correggibile riscrivendolo, invece di lasciare una porta aperta su una tabella
 * qualunque.
 */

const RE_MESE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Un obiettivo di Boom mensile realistico. Il massimo non e' un limite di
 *  business: e' il confine oltre il quale un numero e' un errore di battitura
 *  o un dispetto. */
const VALORE_MASSIMO = 10_000_000;

function chiave(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, " ");
}

/** I mesi toccati da un intervallo, come "AAAA-MM". */
function mesiFra(from: string, to: string): string[] {
  const out: string[] = [];
  const [ay, am] = from.split("-").map(Number);
  const [by, bm] = to.split("-").map(Number);
  let y = ay;
  let m = am;
  // Un intervallo di anni non ne produce mai piu' di qualche decina, ma il
  // limite evita che una data assurda faccia girare a vuoto il server.
  for (let giri = 0; giri < 600; giri++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === by && m === bm) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from e to devono essere date AAAA-MM-GG" }, { status: 400 });
  }

  const mesi = mesiFra(from.slice(0, 7), to.slice(0, 7));

  try {
    const { rows } = await getDb().query<{ persona: string; valore: string }>(
      `SELECT persona, SUM(valore)::text AS valore
         FROM obiettivo
        WHERE mese = ANY($1::char(7)[])
        GROUP BY 1`,
      [mesi]
    );

    const perPersona: Record<string, number> = {};
    for (const r of rows) perPersona[r.persona] = Number(r.valore);

    return NextResponse.json(
      // Un solo mese: la pagina puo' lasciare scrivere, e sa su quale mese.
      { perPersona, mese: mesi.length === 1 ? mesi[0] : null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[obiettivi]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "obiettivi non leggibili" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let corpo: { persona?: unknown; mese?: unknown; valore?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ error: "corpo non leggibile" }, { status: 400 });
  }

  const persona = chiave(String(corpo.persona ?? ""));
  const mese = String(corpo.mese ?? "").trim();

  if (!persona || persona.length > 120) {
    return NextResponse.json({ error: "persona non valida" }, { status: 400 });
  }
  if (!RE_MESE.test(mese)) {
    return NextResponse.json({ error: "mese non valido" }, { status: 400 });
  }

  // Vuoto, null o zero cancellano: e' come si toglie un obiettivo sbagliato
  // senza dover inventare un pulsante.
  const grezzo = corpo.valore;
  const cancella = grezzo === null || grezzo === "" || grezzo === undefined;
  const valore = cancella ? 0 : Number(grezzo);
  if (!cancella && (!Number.isFinite(valore) || valore < 0 || valore > VALORE_MASSIMO)) {
    return NextResponse.json({ error: "valore non valido" }, { status: 400 });
  }

  try {
    const db = getDb();

    // IL NOME DEVE ESISTERE. Senza questo controllo la tabella accetterebbe
    // qualunque stringa, e diventerebbe un posto dove scrivere testo
    // arbitrario. Si accetta chi risulta fra i proprietari HubSpot: e' la
    // stessa anagrafica da cui la pagina ricava i nomi, e comprende anche gli
    // utenti disattivati.
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM proprietario
        WHERE lower(regexp_replace(trim(nome), '\\s+', ' ', 'g')) = $1`,
      [persona]
    );
    if (Number(rows[0]?.n ?? 0) === 0) {
      return NextResponse.json({ error: "persona non riconosciuta" }, { status: 400 });
    }

    if (cancella || valore === 0) {
      await db.query(`DELETE FROM obiettivo WHERE persona = $1 AND mese = $2`, [persona, mese]);
      return NextResponse.json({ persona, mese, valore: null });
    }

    await db.query(
      `INSERT INTO obiettivo (persona, mese, valore) VALUES ($1, $2, $3)
       ON CONFLICT (persona, mese) DO UPDATE SET valore = EXCLUDED.valore`,
      [persona, mese, valore]
    );
    return NextResponse.json({ persona, mese, valore });
  } catch (err) {
    console.error("[obiettivi] scrittura", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "obiettivo non salvato" }, { status: 500 });
  }
}
