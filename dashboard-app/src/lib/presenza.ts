import { somiglianza, IMPOSTAZIONI } from "@/lib/abbinamento";

// Se il cliente si e' presentato alla consulenza, letto da chi parla nella
// registrazione.
//
// PERCHE' NON BASTA L'ESITO SU HUBSPOT. Il campo c'e' - vale NO_SHOW o CANCELED
// - ma non lo compila nessuno: su 396 riunioni di settembre un solo NO_SHOW. Il
// dato vero sta nelle trattative, dove pero' arriva quando l'advisor sposta la
// fase, e misurato sui no show di settembre questo succede fra le 18:00 e le
// 19:46, cioe' a fine giornata e a volte il giorno dopo. Per tutto il
// pomeriggio l'agenda non sa cosa sia successo la mattina.
//
// PERCHE' NON BASTA "ESISTE UNA REGISTRAZIONE". Misurato sulle consulenze
// risultate svolte negli ultimi sette giorni, solo il 31% ha una registrazione:
// l'estensione Chrome si configura per computer e su sette postazioni su undici
// non cattura. Dedurre il no show dall'assenza di registrazione marcherebbe
// come disertate sette consulenze vere su dieci.
//
// PERCHE' NON BASTA LA DURATA. Nel campione c'e' una registrazione di dodici
// minuti in cui parla solo l'advisor: e' un no show in cui e' rimasto in stanza
// ad aspettare. Sulla durata l'avremmo contata come svolta.
//
// QUELLO CHE FUNZIONA e' guardare CHI parla. Il segnale e' netto e senza zona
// grigia: misurato su diciotto registrazioni, il secondo interlocutore o parla
// per il 26-49% del tempo o per lo 0%, mai in mezzo. E Fireflies attribuisce
// alle frasi il nome di chi le dice, quindi spesso si puo' verificare che sia
// proprio il contatto atteso e non qualcun altro.
//
// L'AFFERMAZIONE E' SOLO DOVE C'E' IL DATO. Senza registrazione, o con una
// registrazione priva di frasi, non si conclude niente: si dice "non si sa" e
// decide il giro notturno sulle trattative. E' la differenza fra osservare
// un'assenza e dedurla da un buco, ed e' il motivo per cui gli advisor le cui
// postazioni non catturano non producono nessun falso no show.

/** Una frase della trascrizione, con chi l'ha detta. */
export type Frase = {
  /** Secondi dall'inizio della registrazione. */
  inizioSec: number;
  fineSec: number;
  /** Il nome che Fireflies attribuisce a chi parla. Puo mancare. */
  voce?: string;
  testo: string;
};

export type EsitoPresenza = "presentato" | "solo-advisor" | "non-si-sa";

export type Presenza = {
  esito: EsitoPresenza;
  /** Come ci siamo arrivati, per poterlo spiegare a chi guarda. */
  motivo: "nome" | "voci" | "una-voce" | "senza-frasi";
  /** Quante voci distinte parlano nella fetta. */
  voci: number;
  /** Quota di parlato della seconda voce, da 0 a 1. */
  quotaSecondo: number;
};

/**
 * Quanto deve parlare il secondo interlocutore perche' conti come presente.
 *
 * Serve a non farsi ingannare da un "pronto?" o da un rumore attribuito a una
 * seconda voce. Misurato: le conversazioni vere stanno fra il 26% e il 49%,
 * quindi una soglia al 10% e' lontana da entrambi gli estremi e non taglia
 * niente di reale.
 */
const QUOTA_MINIMA = 0.1;

/** Il proprietario dell'account condiviso: e' l'advisor, non il cliente.
 *  Verificato sulle trascrizioni: le sue battute sono attribuite proprio cosi'. */
const VOCE_ADVISOR = "advisor leone group";

/**
 * Il nome del contatto compare fra chi parla?
 *
 * Si usa `somiglianza()`, la stessa funzione con cui l'abbinamento riconosce i
 * nomi citati, e la stessa soglia: un solo criterio in tutto il sistema, invece
 * di due che col tempo si allontanano. Normalizza gia' da sola e confronta gia'
 * anche con i singoli pezzi del nome - serve perche' Fireflies a volte scrive
 * solo il nome di battesimo, e perche' storpia: "Ciao Enrico" contro "Enrico
 * Toniazzo".
 */
function nomeFraLeVoci(voci: string[], contatto: string): boolean {
  if (!contatto.trim()) return false;
  return voci.some(
    (v) =>
      v.trim() &&
      v.trim().toLowerCase() !== VOCE_ADVISOR &&
      somiglianza(v, contatto) >= IMPOSTAZIONI.somiglianzaMinima
  );
}

/**
 * Chi c'era, guardando solo la porzione di registrazione che appartiene a
 * questo appuntamento.
 *
 * LA FETTA NON E' UN DETTAGLIO: quando una registrazione copre due
 * appuntamenti - l'advisor non chiude e riapre la stanza fra un cliente e
 * l'altro - contare le voci su tutta la call direbbe "presentato" anche per il
 * secondo, che invece potrebbe non essersi mai collegato. I confini `daSec` e
 * `aSec` li calcola gia' l'abbinamento, qui si usano e basta.
 */
export function chiEraInCall(
  frasi: Frase[],
  daSec: number,
  aSec: number,
  contattoNome?: string
): Presenza {
  const dentro = frasi.filter((f) => f.fineSec >= daSec && f.inizioSec <= aSec);

  // Nessuna frase non vuol dire nessun cliente: vuol dire che non sappiamo.
  // Misurato: due registrazioni su cinquantuno arrivano senza frasi.
  if (!dentro.length) {
    return { esito: "non-si-sa", motivo: "senza-frasi", voci: 0, quotaSecondo: 0 };
  }

  const per = new Map<string, number>();
  for (const f of dentro) {
    const chi = (f.voce ?? "").trim() || "?";
    per.set(chi, (per.get(chi) ?? 0) + Math.max(0, f.fineSec - f.inizioSec));
  }
  const ordinate = [...per.entries()].sort((a, b) => b[1] - a[1]);
  const totale = ordinate.reduce((s, x) => s + x[1], 0);
  const quotaSecondo = totale > 0 ? (ordinate[1]?.[1] ?? 0) / totale : 0;
  const voci = ordinate.length;

  // Il nome vale piu' del conteggio: dice non solo che c'era qualcuno, ma che
  // c'era la persona giusta.
  if (contattoNome && nomeFraLeVoci(ordinate.map(([v]) => v), contattoNome)) {
    return { esito: "presentato", motivo: "nome", voci, quotaSecondo };
  }

  if (voci >= 2 && quotaSecondo >= QUOTA_MINIMA) {
    return { esito: "presentato", motivo: "voci", voci, quotaSecondo };
  }

  return { esito: "solo-advisor", motivo: "una-voce", voci, quotaSecondo };
}
