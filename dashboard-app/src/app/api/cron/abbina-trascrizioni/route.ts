import { NextRequest, NextResponse } from "next/server";
import { sincronizzaTrascrizioni } from "@/lib/trascrizioni/sync";

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
export const maxDuration = 300;

/** Quanti giorni all'indietro rileggere a ogni giro.
 *
 *  NON basta ieri: il caricamento della registrazione parte dal browser
 *  dell'advisor e puo' restare in coda per ore - osservati caricamenti riusciti
 *  solo la mattina dopo. Cinque giorni recuperano i ritardatari, e rileggere
 *  non fa danno perche' la scrittura confronta le consulenze e non le stringhe:
 *  quello che e' gia' a posto non viene toccato. */
const GIORNI = 5;

/** Quanti giorni guarda il giro di mezzogiorno.
 *
 *  Serve a un'altra cosa rispetto a quello notturno: non recuperare i
 *  ritardatari, ma far comparire in agenda le call della mattina prima della
 *  fine della giornata, quando all'advisor servono ancora. Oggi e ieri
 *  bastano; le cinque giornate restano al giro notturno, che ha tempo. */
const GIORNI_MEZZOGIORNO = 2;

/** L'orario del giro di mezzogiorno. I cron di Vercel sono sempre in UTC:
 *  12:00 UTC sono le 14:00 italiane con l'ora legale, le 13:00 in inverno.
 *  Deve restare identico a quello scritto in vercel.json. */
const ORARIO_MEZZOGIORNO = "0 12 * * *";

/**
 * Il giro notturno che collega le registrazioni di Fireflies ai contatti.
 *
 * Sostituisce il flusso Zapier "Flusso Importa Link Fireflies su Hubspot".
 * Finche' i due convivono non si pestano i piedi: se il Zap ha gia' scritto
 * quella consulenza, qui si riconosce dalla data fra parentesi quadre e si
 * lascia stare.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const chiaveFireflies = process.env.FIREFLIES_API_KEY;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });
  if (!chiaveFireflies) return NextResponse.json({ error: "FIREFLIES_API_KEY non impostata" }, { status: 500 });

  // Una prova senza scrivere si chiede con ?prova=1: utile dopo una modifica,
  // per vedere cosa farebbe prima di lasciarglielo fare.
  const scrivi = req.nextUrl.searchParams.get("prova") !== "1";

  // I DUE GIRI CONDIVIDONO QUESTO ENDPOINT e si distinguono dall'header che
  // Vercel aggiunge a ogni chiamata programmata, che contiene l'espressione
  // cron che l'ha fatta partire. E' il modo previsto dalla documentazione
  // quando piu' cron puntano allo stesso path, e non dipende dalla query
  // string, che nei cron non e' documentata. A mano si passa ?giorni=N e
  // comanda quello.
  const diMezzogiorno = req.headers.get("x-vercel-cron-schedule") === ORARIO_MEZZOGIORNO;
  const giorni =
    Number(req.nextUrl.searchParams.get("giorni") ?? "") ||
    (diMezzogiorno ? GIORNI_MEZZOGIORNO : GIORNI);

  const a = new Date();
  const da = new Date(a.getTime() - giorni * 24 * 60 * 60 * 1000);

  try {
    const { esito } = await sincronizzaTrascrizioni({ token, chiaveFireflies, da, a, scrivi });
    console.log(
      `[cron/trascrizioni] giro ${diMezzogiorno ? "di mezzogiorno" : "notturno"} ` +
        `su ${giorni} giorni: ${esito.registrazioni} registrazioni, ${esito.riunioni} riunioni, ` +
        `${esito.abbinate} abbinate (${JSON.stringify(esito.perCriterio)}), ` +
        `${esito.scritti} scritti, ${esito.invariati} gia' a posto, ${esito.falliti} falliti, ` +
        `${esito.orfane} registrazioni lunghe senza appuntamento`
    );
    return NextResponse.json({ ...esito, scrittura: scrivi });
  } catch (e) {
    console.error("[cron/trascrizioni]", e);
    return NextResponse.json(
      { errore: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
