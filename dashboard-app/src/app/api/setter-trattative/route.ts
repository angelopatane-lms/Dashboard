import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Quello che il database sa dire su un setter: appuntamenti disertati e
 * consulenze svolte.
 *
 * Le due cose stanno insieme perche' vengono dalle stesse due tabelle, con lo
 * stesso filtro di date e di campagna, e servono alla stessa riga di tabella:
 * farne due rotte vorrebbe dire due viaggi per un dato che si legge in una
 * query sola.
 *
 * PERCHE' NON DAL FOGLIO OPERATORI, che e' la sorgente di tutte le altre
 * colonne della pagina Setter. La colonna "No Show" di quel foglio la scriveva
 * uno script di Apps Script che cercava l'evento `Consulenza / No Show`: su
 * HubSpot quel valore e' stato rinominato in `Mancata presentazione` e spostato
 * sotto `Stato lead`, e da allora lo script scrive zero. Ultimo giorno con un
 * numero: 19 agosto 2026. Il foglio inoltre perde giorni interi quando il
 * trigger giornaliero non parte - otto giorni fra marzo e settembre, 181
 * diserzioni - e non li recupera mai, perche' elabora solo "ieri".
 *
 * La tabella `no_show` non ha nessuno di questi problemi: nasce dalla
 * cronologia delle FASI della trattativa, quindi non dipende da come si chiama
 * un'etichetta, ed e' ricostruibile dall'inizio in qualunque momento. 22.079
 * eventi dal 2024, 99,98% con il setter.
 *
 * IL SETTER E' QUELLO DI ALLORA, non quello di oggi: `no_show.setter_id` viene
 * congelato alla data dell'evento leggendo la cronologia della proprieta'. Vedi
 * setterAllaData() in src/lib/trattative/sync.ts per il perche'.
 *
 * I due conteggi non coincideranno mai al centesimo con i vecchi numeri del
 * foglio, e non perche' uno sia sbagliato: il foglio contava le consulenze
 * segnate a vuoto, questo conta gli ingressi in fase No Show. Misurato su
 * luglio, 716 contro 639.
 *
 * LE CONSULENZE SVOLTE servono al denominatore di "% Chiusura". Nel foglio
 * Operatori la colonna Consulenze e' ZERO per chi fa solo il setter - le
 * consulenze le attribuisce all'Advisor che le tiene - quindi la percentuale
 * sulla pagina Setter divideva per zero e mostrava un trattino a tutti.
 * Contate qui per setter, con `trattativa.svolta_ts` nel periodo, la domanda
 * torna sensata: degli appuntamenti che ho procurato e che si sono tenuti,
 * quanti hanno chiuso.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Missing from or to" }, { status: 400 });

  // La campagna arriva come etichetta leggibile ("MEP", "Div Coach") e i nomi
  // in banca dati sono tecnici ("lms_mep_ew_mental_power"): si confronta per
  // sottostringa, come fanno gia' le altre aggregazioni della pagina.
  const campagna = (searchParams.get("campagna") ?? "").trim();
  const frammento = campagna
    ? campagna.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    : "";

  // La chiave e' il nome normalizzato come lo normalizza la tabella, cosi'
  // "ANDREA VILARDO" del CRM e "Andrea Vilardo" del foglio finiscono sulla
  // stessa riga.
  const chiave = (nome: string) => nome.trim().toLowerCase().replace(/\s+/g, " ");

  try {
    const db = getDb();
    const [disertati, svolte] = await Promise.all([
      db.query<{ setter: string; n: string }>(
        `SELECT p.nome AS setter, COUNT(*)::text AS n
           FROM no_show n
           JOIN proprietario p ON p.id = n.setter_id
           LEFT JOIN campagna c ON c.id = n.campagna_id
          WHERE n.ts >= $1::date
            AND n.ts < ($2::date + INTERVAL '1 day')
            AND ($3 = '' OR lower(c.nome) LIKE '%' || $3 || '%')
          GROUP BY 1`,
        [from, to, frammento]
      ),
      // Le consulenze si contano sulla data in cui si sono SVOLTE, non su
      // quella in cui l'appuntamento era stato fissato: e' il lavoro del
      // periodo che si sta guardando.
      db.query<{ setter: string; n: string }>(
        `SELECT p.nome AS setter, COUNT(*)::text AS n
           FROM trattativa t
           JOIN proprietario p ON p.id = t.setter_id
           LEFT JOIN campagna c ON c.id = t.campagna_id
          WHERE t.svolta_ts >= $1::date
            AND t.svolta_ts < ($2::date + INTERVAL '1 day')
            AND ($3 = '' OR lower(c.nome) LIKE '%' || $3 || '%')
          GROUP BY 1`,
        [from, to, frammento]
      )
    ]);

    const perSetter: Record<string, number> = {};
    for (const r of disertati.rows) perSetter[chiave(r.setter)] = Number(r.n);

    const svoltePerSetter: Record<string, number> = {};
    for (const r of svolte.rows) svoltePerSetter[chiave(r.setter)] = Number(r.n);

    return NextResponse.json(
      { perSetter, svoltePerSetter },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[setter-trattative]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "dati per setter non leggibili" }, { status: 500 });
  }
}
