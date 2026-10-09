import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { baseAccettabile, RE_SUFFISSO_VARIANTE, sqlNomeBase, type MappaVarianti } from "@/lib/campagne";
import { leggiSpesaAds } from "@/lib/spesaAds";

// Il tipo resta esportato da qui perche' il client lo importa da questo
// indirizzo; la lettura del foglio sta in @/lib/spesaAds, che la condivide con
// il grafico dell'andamento.
export type { CampaignAdsSpendRow } from "@/lib/spesaAds";

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
 * Per ogni nome che finisce con un suffisso di variante ("_test_instant", "_2",
 * "_new", "_lal", "_interessi"...), il nome della campagna base - ma solo se quella base
 * esiste davvero fra le campagne HubSpot.
 *
 * La costruisce il server perche' solo lui ha l'elenco delle campagne; il client
 * la usa per raggruppare la spesa esattamente come fanno le query sui lead.
 * Senza, la riga "..._spirituale_test" resterebbe separata dalla sua base e
 * continuerebbe a mostrare spesa senza un solo lead.
 *
 * I candidati arrivano da due parti: i nomi visti nel foglio della spesa (che
 * spesso non esistono come campagne HubSpot) e le campagne HubSpot stesse.
 */
async function mappaVarianti(nomiFoglio: Iterable<string>): Promise<MappaVarianti> {
  const candidati = new Map<string, string>();
  for (const nome of nomiFoglio) {
    const k = nome.trim().toLowerCase();
    const base = k.replace(RE_SUFFISSO_VARIANTE, "");
    if (base !== k && baseAccettabile(base)) candidati.set(k, base);
  }

  try {
    const db = getDb();
    // Le varianti gia' presenti fra le campagne HubSpot.
    //
    // NESSUN FILTRO SUL MINUSCOLO, ed e' voluto. Fino al 6 ottobre 2026 qui
    // c'era "v.nome = lower(v.nome)", rimasto indietro quando l'avevamo tolto
    // da sqlFiltroCampagna: le due meta' della stessa unificazione finivano per
    // non essere piu' d'accordo. Lead, telefonate e consulenze passano dal SQL,
    // che il nome lo mette in minuscolo prima di confrontarlo, e si univano;
    // chiusure e incassi passano di qui e restavano indietro, su una riga con
    // tutti zero tranne i soldi. Misurato: le dodici varianti di
    // "lms_imprenditoria_workshop_dipendenti_artificiali", che HubSpot scrive
    // col cognome in maiuscolo, trattenevano 7.200 EUR.
    const { rows } = await db.query<{ variante: string; base: string }>(
      `SELECT lower(trim(v.nome)) AS variante, b.nome AS base
         FROM campagna v
         JOIN campagna b ON b.nome = ${sqlNomeBase("v")}
        WHERE b.nome <> lower(trim(v.nome))
          AND position('_' in b.nome) > 0`
    );
    const mappa: MappaVarianti = {};
    for (const r of rows) mappa[r.variante] = r.base;

    // ...e quelle che compaiono solo nel foglio della spesa, tenute solo se la
    // base corrisponde a una campagna vera.
    const daVerificare = [...candidati.keys()].filter((k) => !(k in mappa));
    if (daVerificare.length) {
      const basi = daVerificare.map((k) => candidati.get(k) as string);
      const { rows: esistenti } = await db.query<{ nome: string }>(
        `SELECT nome FROM campagna WHERE nome = ANY($1::text[])`,
        [basi]
      );
      const set = new Set(esistenti.map((r) => r.nome));
      for (const k of daVerificare) {
        const base = candidati.get(k) as string;
        if (set.has(base)) mappa[k] = base;
      }
    }

    /**
     * LA SPESA DI UN NOME CHE CAMPAGNA NON E'.
     *
     * Marketing nomina le inserzioni aggiungendo una coda alla campagna:
     * "_broad", "_caldi", "_scaling", "_lookalike", "_test2", "_database",
     * "_leadads", "_copertura"... L'elenco dei suffissi non le prende tutte -
     * ha "lal" ma non "lookalike", "warm" ma non "caldi", "scale" ma non
     * "scaling", e "test(_.+)?" prende "test_2" ma non "test2" - e ogni coda
     * nuova e' un buco che si apre in silenzio. Misurato il 9 ottobre 2026:
     * ventidue nomi, 29.000 EUR di spesa su righe senza un solo lead, mentre i
     * lead stavano sulla riga base. Il CPL della base usciva gonfiato e quello
     * della variante non esisteva.
     *
     * NON SERVE UN ELENCO PIU' LUNGO, serve una condizione: si fa solo quando
     * quel nome NON E' una campagna. Se non e' una campagna non ha lead, e
     * spostarlo muove soltanto il denaro - non puo' sommare le persone di due
     * campagne diverse, che e' l'unico errore grave possibile qui. Le 9
     * varianti che invece SONO campagne restano dove sono: misurata la
     * sovrapposizione con la base, sta fra 0% e 20%, mentre quelle in elenco
     * stanno al 90-100%. "lms_mep_ew_ikigai_vivere_felici" porta 48.597
     * persone che con "ikigai" non c'entrano: e' una campagna, non un
     * pubblico.
     *
     * SI PRENDE IL PREFISSO PIU' LUNGO che sia una campagna vera, perche' e'
     * il piu' specifico: fra "lms_rem_workshop" e
     * "lms_rem_workshop_liberi_col_mattone_aste" vince il secondo.
     */
    const { rows: tutte } = await db.query<{ nome: string }>(
      `SELECT lower(trim(nome)) AS nome FROM campagna`
    );
    const campagne = new Set(tutte.map((r) => r.nome));
    for (const nome of nomiFoglio) {
      const k = nome.trim().toLowerCase();
      if (!k || k in mappa || campagne.has(k)) continue;
      const pezzi = k.split("_");
      for (let i = pezzi.length - 1; i >= 2; i--) {
        const base = pezzi.slice(0, i).join("_");
        if (campagne.has(base) && baseAccettabile(base)) {
          mappa[k] = base;
          break;
        }
      }
    }

    return mappa;
  } catch (err) {
    // Senza database la tabella deve continuare a funzionare: si rinuncia
    // all'unificazione, non ai dati.
    console.error("[campaign-ads] mappa varianti non disponibile:", err instanceof Error ? err.message : err);
    return {};
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const rows = await leggiSpesaAds(from, to);

  const varianti = await mappaVarianti(rows.map((r) => r.campagna));

  return NextResponse.json(
    { rows, varianti },
    { headers: { "Cache-Control": "no-store" } }
  );
}
