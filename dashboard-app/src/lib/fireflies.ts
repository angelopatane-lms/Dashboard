// Lettura delle registrazioni da Fireflies.
//
// COME NASCONO QUESTE REGISTRAZIONI, perche' spiega la forma dei dati:
// l'estensione Chrome di Fireflies gira nel browser dell'advisor, autenticata
// con l'account condiviso advisorleonegroup@gmail.com, e cattura la stanza Meet
// non appena viene aperta. Non c'e' nessun evento di calendario dietro - i campi
// calendar_id e calendar_type sono nulli su tutte le registrazioni - quindi il
// titolo non e' il nome dell'appuntamento ma il codice della stanza, e
// l'organizzatore e' sempre l'account condiviso. Il codice della stanza e'
// percio' l'unico aggancio disponibile verso HubSpot.

const ENDPOINT = "https://api.fireflies.ai/graphql";

export type TrascrizioneFireflies = {
  id: string;
  /** Di norma il codice della stanza Meet, es. "jth-hhtk-jmn". */
  titolo: string;
  /** Millisecondi epoch. */
  inizio: number;
  durataMin: number;
  /** Il codice della stanza, quando il collegamento e' un Google Meet. */
  stanza: string | null;
  /** Il file audio. Come il collegamento alla trascrizione, e' firmato e scade. */
  audio: string | null;
};

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Una interrogazione GraphQL, con attesa e ritentativo quando Fireflies
 * risponde che stiamo chiedendo troppo in fretta.
 */
async function interroga<T>(chiave: string, query: string, tentativi = 5): Promise<T | null> {
  for (let i = 0; i < tentativi; i++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${chiave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const testo = await res.text();
    let corpo: { data?: T; errors?: unknown };
    try {
      corpo = JSON.parse(testo);
    } catch {
      await attesa(2000 * (i + 1));
      continue;
    }
    if (corpo.errors) {
      const messaggio = JSON.stringify(corpo.errors);
      if (/rate|limit|too many/i.test(messaggio)) {
        await attesa(3000 * (i + 1));
        continue;
      }
      throw new Error(`Fireflies: ${messaggio.slice(0, 300)}`);
    }
    return corpo.data ?? null;
  }
  throw new Error("Fireflies non risponde dopo piu' tentativi");
}

const stanzaDa = (collegamento: string | null | undefined): string | null =>
  (collegamento ?? "").match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)?.[1] ?? null;

/** Le registrazioni fra due istanti, sfogliando fino in fondo. */
export async function leggiTrascrizioni(
  chiave: string,
  da: Date,
  a: Date
): Promise<TrascrizioneFireflies[]> {
  const out: TrascrizioneFireflies[] = [];
  const PAGINA = 50;
  for (let salta = 0; salta < 10_000; salta += PAGINA) {
    const dati = await interroga<{
      transcripts: Array<{ id: string; title: string; date: string | number; duration: number; meeting_link: string | null; audio_url: string | null }>;
    }>(
      chiave,
      `{ transcripts(limit: ${PAGINA}, skip: ${salta}, fromDate: "${da.toISOString()}", toDate: "${a.toISOString()}") {
          id title date duration meeting_link audio_url
      } }`
    );
    const blocco = dati?.transcripts ?? [];
    for (const t of blocco) {
      const inizio = Number(t.date) || Date.parse(String(t.date));
      if (!Number.isFinite(inizio)) continue;
      out.push({
        id: t.id,
        titolo: t.title ?? "",
        inizio,
        durataMin: Number(t.duration) || 0,
        stanza: stanzaDa(t.meeting_link),
        audio: t.audio_url ?? null
      });
    }
    if (blocco.length < PAGINA) break;
    await attesa(350);
  }
  return out;
}

/**
 * I nomi delle persone citate negli action items di una registrazione.
 *
 * A COSA SERVONO: sono l'unico posto in cui Fireflies scrive il nome del
 * cliente in chiaro. La trascrizione riporta i nomi visualizzati in Meet, che
 * per il team sono sempre "Advisor Leone Group" e per il cliente sono quello
 * che ha scritto lui, quindi non aiutano. Negli action items invece il nome
 * compare fra doppi asterischi perche' Fireflies li usa come intestazione di
 * chi deve fare la cosa. Misurato su 40 registrazioni: gli action items ci sono
 * sempre, e nel 95% dei casi contengono anche il nome del cliente e non solo
 * quello dell'advisor.
 *
 * ATTENZIONE: sono generati dall'AI e i nomi escono spesso storpiati o
 * incompleti - "marvin alessandri", "domenico prima", solo "giuseppe". Per
 * questo il confronto a valle e' per somiglianza e non per uguaglianza.
 */
export async function leggiNomiCitati(chiave: string, id: string): Promise<string[]> {
  const dati = await interroga<{ transcript: { summary: { action_items: string | null } | null } | null }>(
    chiave,
    `{ transcript(id: "${id}") { summary { action_items } } }`
  );
  const testo = dati?.transcript?.summary?.action_items ?? "";
  return [...String(testo).matchAll(/\*\*(.*?)\*\*/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
}

/**
 * Le frasi di una registrazione con il loro istante, in secondi dall'inizio.
 *
 * Servono quando una sola registrazione contiene due consulenze: dai tempi si
 * ricava dove finisce l'una e comincia l'altra, e dal testo si capisce se il
 * secondo cliente e' davvero entrato. Si chiedono solo per le registrazioni che
 * ne hanno bisogno, perche' costano una chiamata ciascuna e su una call da
 * un'ora sono centinaia di frasi.
 */
export async function leggiFrasi(
  chiave: string,
  id: string
): Promise<Array<{ inizioSec: number; fineSec: number; testo: string; voce: string }>> {
  // speaker_name serve a stabilire chi c'era in call: e' il nome che Fireflies
  // attribuisce a chi parla, e sulle consulenze coincide col nome del contatto
  // ("Enrico Toniazzo"), mentre le battute dell'advisor risultano di "Advisor
  // Leone Group". Vedi chiEraInCall().
  const dati = await interroga<{
    transcript: {
      sentences: Array<{ start_time: number; end_time: number; text: string; speaker_name: string | null }> | null;
    } | null;
  }>(chiave, `{ transcript(id: "${id}") { sentences { start_time end_time text speaker_name } } }`);
  return (dati?.transcript?.sentences ?? []).map((f) => ({
    inizioSec: Number(f.start_time) || 0,
    fineSec: Number(f.end_time) || 0,
    testo: f.text ?? "",
    voce: f.speaker_name ?? ""
  }));
}

/**
 * L'indirizzo stabile della trascrizione dentro Fireflies.
 *
 * NON si usa il collegamento che l'integrazione salva su HubSpot: quello punta
 * al file su S3 ed e' firmato con `X-Amz-Expires=21600`, cioe' sei ore.
 * Verificato su tre call di epoche diverse, compresa una del giorno prima:
 * rispondono tutte "403 Request has expired". L'indirizzo dell'applicazione
 * invece non scade, e si ricava dall'identificativo della trascrizione.
 */
export const linkTrascrizione = (id: string): string => `https://app.fireflies.ai/view/${id}`;
