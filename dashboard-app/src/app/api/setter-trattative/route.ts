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
    const [disertati, svolte, svolteProprietario, fuoriCrm] = await Promise.all([
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
      ),
      /**
       * LE CONSULENZE DI UN ADVISOR, dalla stessa fonte dei setter.
       *
       * E' la query qui sopra con `proprietario_id` al posto di `setter_id`:
       * chi ha TENUTO la consulenza invece di chi l'ha procurata. Lo stesso
       * `svolta_ts`, ricostruito dallo storico dei passaggi di fase.
       *
       * PERCHE' DAL 7 NOVEMBRE 2026 SOSTITUISCE IL FOGLIO. La colonna
       * Consulenze della tabella Advisor veniva dal foglio Operatori piu' le
       * call registrate senza appuntamento. Misurato su quattro mesi, il CRM
       * vede PIU' consulenze del foglio - agosto +15%, settembre +6%, ottobre
       * +11%, novembre +10% - e su diciassette advisor a ottobre nessuno ne
       * perdeva nemmeno una. Il timore del 9 ottobre, "passando al CRM si
       * cancellano consulenze vere" (Roberto Esposito 2 invece di 11), oggi
       * non si verifica piu' su nessuno: lo stesso Esposito fa 13 contro 14.
       *
       * Il foglio resta il ripiego quando questa lettura non risponde: vedi
       * effConsulenze() in OperatorStatsTable.
       */
      db.query<{ advisor: string; n: string }>(
        `SELECT p.nome AS advisor, COUNT(*)::text AS n
           FROM trattativa t
           JOIN proprietario p ON p.id = t.proprietario_id
           LEFT JOIN campagna c ON c.id = t.campagna_id
          WHERE t.svolta_ts >= $1::date
            AND t.svolta_ts < ($2::date + INTERVAL '1 day')
            AND ($3 = '' OR lower(c.nome) LIKE '%' || $3 || '%')
          GROUP BY 1`,
        [from, to, frammento]
      ),
      // LE CONSULENZE CHE SUL CRM NON ESISTONO, per advisor.
      //
      // Sono call registrate senza nessun appuntamento: non hanno una
      // trattativa, quindi non entrano nella query qui sopra, e la tabella
      // Advisor le perdeva mentre l'agenda le mostrava - due pagine con due
      // numeri diversi sullo stesso giorno.
      //
      // NON SI FILTRANO PER CAMPAGNA perche' non ne hanno una: senza
      // appuntamento non c'e' nessuna trattativa da cui leggerla. Quando si
      // guarda una campagna sola restano quindi fuori, altrimenti gonfierebbero
      // un totale che dovrebbe essere di quella campagna soltanto.
      frammento
        ? Promise.resolve({ rows: [] as Array<{ advisor: string; n: string }> })
        : db.query<{ advisor: string; n: string }>(
            `SELECT p.nome AS advisor, COUNT(*)::text AS n
               FROM consulenza_fuori_crm f
               JOIN proprietario p ON p.id = f.advisor_id
              WHERE f.inizio_ts >= $1::date
                AND f.inizio_ts < ($2::date + INTERVAL '1 day')
              GROUP BY 1`,
            [from, to]
          )
    ]);

    const perSetter: Record<string, number> = {};
    for (const r of disertati.rows) perSetter[chiave(r.setter)] = Number(r.n);

    const svoltePerSetter: Record<string, number> = {};
    for (const r of svolte.rows) svoltePerSetter[chiave(r.setter)] = Number(r.n);

    const svoltePerProprietario: Record<string, number> = {};
    for (const r of svolteProprietario.rows) svoltePerProprietario[chiave(r.advisor)] = Number(r.n);

    const fuoriCrmPerAdvisor: Record<string, number> = {};
    for (const r of fuoriCrm.rows) fuoriCrmPerAdvisor[chiave(r.advisor)] = Number(r.n);

    return NextResponse.json(
      // `fuoriCrmPerAdvisor` NON si somma piu' alle consulenze dal 7 novembre
      // 2026 - vedi effConsulenze() - ma continua a viaggiare perche' l'agenda
      // le mostra e l'esportazione le riporta: una call registrata senza
      // appuntamento resta una cosa che un team leader vuole vedere.
      { perSetter, svoltePerSetter, svoltePerProprietario, fuoriCrmPerAdvisor },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[setter-trattative]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "dati per setter non leggibili" }, { status: 500 });
  }
}
