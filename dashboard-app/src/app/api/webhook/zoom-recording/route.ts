import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { getDb } from "@/lib/db";

/**
 * Il ponte fra le registrazioni cloud di Zoom e Fireflies.
 *
 * PERCHE' SERVE. Fireflies sa prendere una riunione in due modi soltanto: o
 * entra in call come partecipante, o si carica il file a mano. Il primo qui non
 * regge, perche' gli advisor rimuovono il Notetaker dalla stanza; il secondo
 * dipende da un gesto che qualcuno deve ricordarsi ogni volta, e sappiamo
 * com'e' andata - un setter con 226 appuntamenti al mese ha otto registrazioni
 * in cartella. Chi passa a Zoom resterebbe fuori da ogni analisi.
 *
 * IL FILE NON PASSA DA QUI. Zoom avvisa quando la registrazione e' pronta e
 * consegna un indirizzo di scaricamento con un gettone valido 24 ore;
 * `uploadAudio` di Fireflies accetta un indirizzo piu' le credenziali per
 * leggerlo, e scarica da solo. Noi passiamo le coordinate, non i byte: la
 * funzione resta leggera e non incontra ne' i limiti di memoria ne' quelli di
 * durata di Vercel, che su registrazioni da cinquanta minuti sarebbero un
 * problema.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Il corpo ammesso. L'indirizzo e' pubblico, e un tetto evita che un estraneo
 *  riempia il registro con quello che gli pare. */
const TETTO_CORPO = 256 * 1024;

/** Quanto puo' essere vecchia una consegna prima di sembrare un replay.
 *  Zoom ritenta per alcune ore, quindi la finestra e' larga. */
const MINUTI_TOLLERANZA = 60 * 6;

const FIREFLIES_API = "https://api.fireflies.ai/graphql";

type FileRegistrazione = {
  id?: string;
  file_type?: string;
  recording_type?: string;
  download_url?: string;
  file_size?: number;
};

type Payload = {
  event?: string;
  event_ts?: number;
  download_token?: string;
  payload?: {
    plainToken?: string;
    object?: {
      uuid?: string;
      topic?: string;
      start_time?: string;
      host_email?: string;
      duration?: number;
      recording_files?: FileRegistrazione[];
    };
  };
};

async function annota(esito: string, messaggio: string): Promise<void> {
  try {
    const ora = new Date().toISOString();
    await getDb().query(
      `INSERT INTO sync_log (tipo, iniziato_at, finito_at, esito, messaggio)
       VALUES ('webhook-zoom', $1::timestamptz, $1::timestamptz, $2, $3)`,
      [ora, esito, messaggio.slice(0, 4000)]
    );
  } catch (e) {
    console.error("[webhook/zoom] non sono riuscito ad annotare", e);
  }
}

/**
 * La firma di Zoom: "v0=" seguito dall'HMAC-SHA256 esadecimale del messaggio
 * `v0:<timestamp>:<corpo grezzo>`, con il Secret Token dell'app.
 *
 * Il timestamp entra nel messaggio e viene anche controllato a parte: senza
 * quel controllo una consegna valida intercettata resterebbe riproducibile per
 * sempre.
 */
function firmaValida(corpo: string, firma: string | null, timestamp: string | null, segreto: string): boolean {
  if (!firma || !timestamp) return false;
  const eta = Math.abs(Date.now() / 1000 - Number(timestamp)) / 60;
  if (!Number.isFinite(eta) || eta > MINUTI_TOLLERANZA) return false;
  const atteso = `v0=${createHmac("sha256", segreto).update(`v0:${timestamp}:${corpo}`, "utf8").digest("hex")}`;
  const a = Buffer.from(atteso);
  const b = Buffer.from(firma);
  // Confronto a tempo costante: su una firma la differenza fra "sbagliata
  // subito" e "sbagliata alla fine" e' un'informazione che non regaliamo.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * QUALE DEI FILE DELLA RIUNIONE.
 *
 * Zoom consegna piu' file per la stessa registrazione: il video con lo schermo
 * condiviso, la traccia audio da sola, la chat, i sottotitoli. A Fireflies
 * serve l'audio, e prenderlo puro invece che dentro al video significa
 * scaricare una decina di megabyte invece di trecento.
 *
 * Il ripiego sul video c'e' perche' la traccia separata esiste solo se
 * nell'account e' attiva la voce "Record an audio only file": se manca, senza
 * ripiego perderemmo la riunione invece di lavorarla piu' lentamente.
 */
function audioDa(files: FileRegistrazione[]): FileRegistrazione | null {
  const conIndirizzo = files.filter((f) => f.download_url);
  return (
    conIndirizzo.find((f) => (f.file_type ?? "").toUpperCase() === "M4A") ??
    conIndirizzo.find((f) => (f.recording_type ?? "") === "audio_only") ??
    conIndirizzo.find((f) => (f.file_type ?? "").toUpperCase() === "MP4") ??
    null
  );
}

/** Gli host le cui registrazioni ci interessano, se l'elenco e' stato scritto.
 *
 *  Serve quando l'app Zoom e' installata sull'intero account: senza filtro
 *  arriverebbero anche le riunioni interne, le formazioni e i colloqui, e
 *  finirebbero in Fireflies mescolate alle consulenze. Vuoto vuol dire "tutte",
 *  che e' il comportamento giusto quando l'app e' installata su una persona
 *  sola. */
function ammesso(email: string | undefined): boolean {
  const elenco = (process.env.ZOOM_EMAIL_AMMESSI ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!elenco.length) return true;
  return elenco.includes((email ?? "").toLowerCase());
}

/**
 * Consegna a Fireflies l'indirizzo e il gettone, e lascia che scarichi lui.
 *
 * IL GETTONE VALE 24 ORE. Se Fireflies non ce la fa entro quel termine la
 * riunione e' persa e non c'e' modo di ripescarla in automatico, per questo
 * l'esito finisce nel registro: un fallimento va visto lo stesso giorno, non
 * scoperto un mese dopo da un buco nei conteggi.
 */
async function mandaAFireflies(
  chiave: string,
  file: FileRegistrazione,
  gettone: string,
  oggetto: NonNullable<NonNullable<Payload["payload"]>["object"]>
): Promise<{ ok: boolean; messaggio: string }> {
  const mutazione = `
    mutation ($input: AudioUploadInput!) {
      uploadAudio(input: $input) { success title message }
    }`;
  const variabili = {
    input: {
      url: file.download_url,
      title: oggetto.topic || "Riunione Zoom",
      // La lingua dichiarata invece che indovinata: sulle call in italiano con
      // audio telefonico il riconoscimento automatico sbaglia, e una
      // trascrizione in un'altra lingua non si accorge nessuno finche' non la
      // si apre.
      custom_language: "it",
      meeting_date: oggetto.start_time,
      // L'identificativo della riunione Zoom viaggia con la trascrizione: e'
      // l'unico appiglio stabile per ricollegarla in seguito, visto che una
      // call Zoom non ha il codice della stanza Meet su cui si regge oggi
      // l'abbinamento.
      client_reference_id: oggetto.uuid,
      attendees: oggetto.host_email ? [{ email: oggetto.host_email }] : undefined,
      download_auth: { type: "bearer_token", bearer: { token: gettone } }
    }
  };
  const res = await fetch(FIREFLIES_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${chiave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: mutazione, variables: variabili })
  });
  const corpo = await res.text();
  if (!res.ok) return { ok: false, messaggio: `HTTP ${res.status}: ${corpo.slice(0, 300)}` };
  let dati: { data?: { uploadAudio?: { success?: boolean; message?: string } }; errors?: unknown };
  try {
    dati = JSON.parse(corpo);
  } catch {
    return { ok: false, messaggio: `risposta illeggibile: ${corpo.slice(0, 300)}` };
  }
  if (dati.errors) return { ok: false, messaggio: JSON.stringify(dati.errors).slice(0, 300) };
  const esito = dati.data?.uploadAudio;
  return { ok: !!esito?.success, messaggio: esito?.message ?? "nessun messaggio" };
}

export async function POST(req: NextRequest) {
  const segreto = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!segreto) {
    console.error("[webhook/zoom] ZOOM_WEBHOOK_SECRET_TOKEN non impostato");
    return NextResponse.json({ error: "Non configurato" }, { status: 500 });
  }

  const corpo = await req.text();
  if (corpo.length > TETTO_CORPO) return NextResponse.json({ error: "Corpo troppo grande" }, { status: 413 });

  let payload: Payload;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ error: "Corpo non leggibile" }, { status: 400 });
  }

  // LA PROVA DI PROPRIETA' DELL'INDIRIZZO.
  //
  // Zoom la chiede quando si preme Validate e poi da sola ogni 72 ore, e vuole
  // la risposta entro tre secondi: va servita prima di qualsiasi altra cosa e
  // senza toccare la banca dati. Non porta firma, perche' e' proprio il
  // meccanismo con cui si dimostra di conoscere il segreto.
  if (payload.event === "endpoint.url_validation") {
    const plainToken = payload.payload?.plainToken ?? "";
    return NextResponse.json({
      plainToken,
      encryptedToken: createHmac("sha256", segreto).update(plainToken, "utf8").digest("hex")
    });
  }

  if (!firmaValida(corpo, req.headers.get("x-zm-signature"), req.headers.get("x-zm-request-timestamp"), segreto)) {
    return NextResponse.json({ error: "Firma non valida" }, { status: 401 });
  }

  if (payload.event !== "recording.completed") {
    return NextResponse.json({ ignorato: payload.event ?? "senza evento" });
  }

  const oggetto = payload.payload?.object;
  const gettone = payload.download_token;
  if (!oggetto || !gettone) {
    waitUntil(annota("errore", `recording.completed senza oggetto o senza gettone di scaricamento`));
    return NextResponse.json({ error: "Payload incompleto" }, { status: 400 });
  }

  if (!ammesso(oggetto.host_email)) {
    return NextResponse.json({ ignorato: "host fuori dall'elenco ammessi" });
  }

  const file = audioDa(oggetto.recording_files ?? []);
  if (!file) {
    waitUntil(annota("errore", `${oggetto.topic ?? "?"}: nessun file scaricabile nella registrazione`));
    return NextResponse.json({ error: "Nessun file utilizzabile" }, { status: 422 });
  }

  const chiave = process.env.FIREFLIES_API_KEY;
  if (!chiave) {
    waitUntil(annota("errore", "FIREFLIES_API_KEY non impostata"));
    return NextResponse.json({ error: "Non configurato" }, { status: 500 });
  }

  // SI RISPONDE SUBITO E SI LAVORA DOPO. Zoom considera fallita una consegna
  // che tarda e la ritenta, e un ritentativo qui vorrebbe dire la stessa
  // riunione caricata due volte su Fireflies.
  waitUntil(
    mandaAFireflies(chiave, file, gettone, oggetto)
      .then((r) =>
        annota(
          r.ok ? "ok" : "errore",
          `${oggetto.topic ?? "?"} (${oggetto.host_email ?? "?"}, ${file.file_type ?? "?"}): ${r.messaggio}`
        )
      )
      .catch((e) => annota("errore", `${oggetto.topic ?? "?"}: ${e instanceof Error ? e.message : String(e)}`))
  );

  return NextResponse.json({ preso: true, riunione: oggetto.topic ?? null });
}
