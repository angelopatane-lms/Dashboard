import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { getDb } from "@/lib/db";
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

/**
 * Il webhook di Fireflies: collega la registrazione al contatto appena la
 * trascrizione e' pronta, invece di aspettare il giro notturno.
 *
 * QUANTO GUADAGNAMO, misurato sulla prova del 14 settembre: call chiusa verso
 * le 15:46, consegna alle 15:47:59, riassunto alle 15:48:32. Meno di due
 * minuti, contro le ore del cron.
 *
 * IL CRON RESTA, con un altro mestiere. Non e' ridondanza: il webhook e' una
 * sola consegna HTTP e Fireflies non documenta nessun ritentativo, quindi una
 * consegna persa e' persa per sempre e non esiste modo di chiedere quali
 * mancano. Inoltre le cose cambiano dopo - riunioni spostate su HubSpot,
 * proprietari di trattativa cambiati, contatti uniti - e il giro notturno sui
 * cinque giorni rilegge e corregge. Il webhook da' la velocita', il cron la
 * correttezza.
 */

/** Gli eventi che ci riguardano.
 *
 *  I NOMI VENGONO DALLA MISURA, non dalla documentazione: la pagina vecchia
 *  dell'API annuncia un campo "eventType" con valore "Transcription completed",
 *  mentre le consegne vere - Fireflies-Webhook/2.0 - portano "event" con valori
 *  puntati e minuscoli. Un gestore scritto sulla pagina vecchia avrebbe
 *  sbagliato due volte, sul nome del campo e sul confronto del valore, e in
 *  silenzio. La pagina Webhooks V2 lo conferma.
 *
 *  PERCHE' TUTTI E DUE. "summarized" arriva 33 secondi dopo "transcribed" e ha
 *  in piu' il riassunto, da cui ricaviamo i nomi citati. Prendere solo il
 *  secondo sarebbe piu' pulito, ma se un giorno la generazione del riassunto
 *  fallisse non agiremmo mai; prendendoli entrambi il caso peggiore e' lavorare
 *  senza i nomi, che e' quello che fa oggi lo Zap. */
const EVENTI = new Set(["meeting.transcribed", "meeting.summarized"]);

/** Quanto indietro guardare intorno alla registrazione appena arrivata.
 *
 *  Non abbiniamo la singola registrazione isolata: rilanciamo lo STESSO
 *  abbinamento del cron su una finestra stretta. Costa qualche chiamata in piu'
 *  ma evita di avere due implementazioni dell'abbinamento che col tempo
 *  divergono, ed e' li' che si annidano gli errori che nessuno nota. La
 *  finestra deve restare larga abbastanza da contenere gli appuntamenti vicini,
 *  che servono a separare le registrazioni a cavallo di due slot. */
const ORE_FINESTRA = 12;

/** Il corpo ammesso: il payload vero sono quattro campi. Il tetto serve solo a
 *  non farsi riempire il log da un estraneo, visto che l'indirizzo e' pubblico. */
const TETTO_CORPO = 16 * 1024;

type Payload = { event?: string; meeting_id?: string; timestamp?: number };

/**
 * La firma, secondo lo schema misurato e confermato dalla documentazione V2:
 * "sha256=" seguito dall'HMAC-SHA256 esadecimale del corpo grezzo.
 */
function firmaValida(corpo: string, header: string | null, segreto: string): boolean {
  if (!header) return false;
  const atteso = `sha256=${createHmac("sha256", segreto).update(corpo, "utf8").digest("hex")}`;
  const a = Buffer.from(atteso);
  const b = Buffer.from(header);
  // Confronto a tempo costante: su una firma la differenza fra "sbagliata
  // subito" e "sbagliata alla fine" e' un'informazione che non regaliamo.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function annota(esito: string, messaggio: string): Promise<void> {
  try {
    const ora = new Date().toISOString();
    await getDb().query(
      `INSERT INTO sync_log (tipo, iniziato_at, finito_at, esito, messaggio)
       VALUES ('webhook-fireflies', $1::timestamptz, $1::timestamptz, $2, $3)`,
      [ora, esito, messaggio.slice(0, 4000)]
    );
  } catch (e) {
    console.error("[webhook/fireflies] non sono riuscito ad annotare", e);
  }
}

/** Un numero stabile a partire dall'identificativo, per il lucchetto. */
function numeroDi(testo: string): number {
  let h = 0;
  for (let i = 0; i < testo.length; i++) h = (Math.imul(31, h) + testo.charCodeAt(i)) | 0;
  return h;
}

/**
 * Il lavoro vero, fuori dalla risposta.
 *
 * IL LUCCHETTO NON E' PRUDENZA ECCESSIVA. I due eventi della stessa riunione
 * distano 33 secondi e un giro ne impiega una quindicina: normalmente non si
 * sovrappongono, ma quando capita entrambi troverebbero il contatto ancora
 * senza link e scriverebbero la stessa cosa due volte. Due PATCH identici su
 * HubSpot fanno scattare due volte l'app che crea un record in Appuntamenti, ed
 * e' esattamente il doppione che vogliamo evitare. Serializzando, il secondo
 * giro rilegge, trova gia' a posto e non tocca niente.
 */
async function lavora(meetingId: string, evento: string): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const chiaveFireflies = process.env.FIREFLIES_API_KEY;
  if (!token || !chiaveFireflies) {
    await annota("errore", `${evento} ${meetingId}: credenziali mancanti`);
    return;
  }

  const cliente = await getDb().connect();
  const t0 = Date.now();
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [numeroDi(meetingId)]);

    const a = new Date();
    const da = new Date(a.getTime() - ORE_FINESTRA * 60 * 60 * 1000);
    const { esito } = await sincronizzaTrascrizioni({ token, chiaveFireflies, da, a, scrivi: true });

    const riga =
      `${evento} ${meetingId}: ${esito.abbinate} abbinate su ${esito.registrazioni} registrazioni ` +
      `e ${esito.riunioni} riunioni, ${esito.scritti} scritti, ${esito.invariati} gia' a posto, ` +
      `${esito.falliti} falliti, ${Date.now() - t0} ms`;
    console.log(`[webhook/fireflies] ${riga}`);
    await annota(esito.falliti > 0 ? "parziale" : "ok", riga);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[webhook/fireflies]", e);
    await annota("errore", `${evento} ${meetingId}: ${m}`);
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [numeroDi(meetingId)]).catch(() => {});
    cliente.release();
  }
}

export async function POST(req: NextRequest) {
  const corpo = await req.text();
  const segreto = process.env.FIREFLIES_WEBHOOK_SECRET;

  if (!segreto) {
    await annota("errore", "FIREFLIES_WEBHOOK_SECRET non impostato");
    return NextResponse.json({ error: "non configurato" }, { status: 500 });
  }
  if (corpo.length > TETTO_CORPO) {
    return NextResponse.json({ error: "corpo troppo lungo" }, { status: 413 });
  }
  if (!firmaValida(corpo, req.headers.get("x-hub-signature"), segreto)) {
    // Ora la firma e' obbligatoria: da qui in poi una consegna fa scrivere su
    // HubSpot, e l'indirizzo e' pubblico.
    await annota("respinto", `firma non valida, corpo: ${corpo.slice(0, 200)}`);
    return NextResponse.json({ error: "firma non valida" }, { status: 401 });
  }

  let p: Payload = {};
  try {
    p = JSON.parse(corpo) as Payload;
  } catch {
    return NextResponse.json({ error: "corpo non leggibile" }, { status: 400 });
  }

  const evento = p.event ?? "";
  const meetingId = p.meeting_id ?? "";
  if (!EVENTI.has(evento) || !meetingId) {
    // Gli altri eventi - la prova dal pannello, l'ingresso del bot - non ci
    // riguardano. Si annotano per avere traccia e si risponde bene.
    await annota("ignorato", `evento ${evento || "(assente)"}, meeting ${meetingId || "(assente)"}`);
    return NextResponse.json({ ok: true, ignorato: true });
  }

  // RISPOSTA SUBITO, LAVORO DOPO. Fireflies pretende un 2xx entro dieci
  // secondi, e un giro di abbinamento ne impiega fra i quindici e i venti -
  // misurati, non stimati. Facendo il lavoro dentro la risposta ogni consegna
  // risulterebbe fallita pur avendo funzionato, e non sapremmo nemmeno se
  // viene riprovata, perche' il ritentativo non e' documentato nemmeno in V2.
  waitUntil(lavora(meetingId, evento));

  return NextResponse.json({ ok: true, preso: meetingId });
}

/** Per controllare dal browser che l'indirizzo risponda. Non dice niente di
 *  riservato: solo se la configurazione e' completa. */
export async function GET() {
  return NextResponse.json({
    webhook: "fireflies",
    segreto: Boolean(process.env.FIREFLIES_WEBHOOK_SECRET),
    eventi: [...EVENTI],
    finestraOre: ORE_FINESTRA
  });
}
