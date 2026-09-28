// UN SOLO PASSAGGIO PER TUTTE LE RICERCHE SU HUBSPOT, con il freno e la
// ripetizione dentro.
//
// IL CASO. Il 28 settembre la colonna Appuntamenti della pagina Advisor era a
// zero per tutti, e in console c'era la ragione: "You have reached your secondly
// limit", politica SECONDLY. La rotta riprovava quattro volte a distanza di uno,
// due e tre secondi, trovava il muro tutte le volte e rispondeva 500. I dati
// c'erano - rifacendo la stessa ricerca a mano uscivano 24 appuntamenti per
// Asma, 21 per Manuel - ma non arrivavano mai alla pagina.
//
// PERCHE' SUCCEDE. La ricerca di HubSpot ha un tetto AL SECONDO, non al minuto,
// e vale per il token intero: non per rotta, non per utente. Aprendo la pagina
// Advisor partono insieme l'agenda, l'andamento, le trattative e gli incassi, e
// ognuna sfogliava le sue pagine con una pausa di 200 millisecondi - cinque
// chiamate al secondo da sola. Sommate, si passa il tetto in un istante, e il
// 429 lo prende chi arriva per ultimo, a caso.
//
// COSA FA QUESTO MODULO. Due cose che nessuna rotta puo' fare da sola:
//
// 1. METTE IN FILA le ricerche dello stesso processo, quattro al secondo. Non
//    e' un limite globale - su Vercel i processi sono piu' d'uno - ma toglie di
//    mezzo le raffiche che ci facevamo da soli.
//
// 2. ASPETTA COME DICE HUBSPOT. Al 429 la risposta porta spesso l'intestazione
//    Retry-After: prima si ignorava e si tirava a indovinare. Ora si legge, e
//    dove manca si raddoppia l'attesa a ogni giro - mezzo secondo, uno, due,
//    quattro, otto - con un pizzico di casualita' per non far ripartire insieme
//    due processi che hanno sbattuto nello stesso istante.
//
// La differenza pratica: prima si rinunciava dopo 6 secondi di tentativi, ora si
// insiste fino a una quindicina. Una pagina che si carica in dieci secondi e'
// noiosa; una colonna a zero e' un dato sbagliato, ed e' molto peggio.

// QUATTRO AL SECONDO, CON UN PICCOLO ANTICIPO CONCESSO.
//
// Non una pausa fissa fra le chiamate ma un secchiello di gettoni: se ne
// rigenera uno ogni 250 millisecondi e se ne possono tenere da parte quattro.
// Chi arriva dopo un momento di calma parte subito, chi insiste rallenta da
// solo. Una pausa fissa avrebbe reso lentissime le rotte che sfogliano decine
// di pagine - l'andamento su dodici mesi - senza essere piu' sicura.
const GETTONI_AL_SECONDO = 4;
const GETTONI_MAX = 4;
const TENTATIVI = 6;

let gettoni = GETTONI_MAX;
let ultimoRicarico = Date.now();
let coda: Promise<unknown> = Promise.resolve();

function dormi(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ricarica(): void {
  const ora = Date.now();
  gettoni = Math.min(GETTONI_MAX, gettoni + ((ora - ultimoRicarico) / 1000) * GETTONI_AL_SECONDO);
  ultimoRicarico = ora;
}

/** Aspetta il proprio gettone prima di partire. */
function inFila<T>(lavoro: () => Promise<T>): Promise<T> {
  const mio = coda.then(async () => {
    ricarica();
    while (gettoni < 1) {
      await dormi(Math.ceil((1 - gettoni) * (1000 / GETTONI_AL_SECONDO)));
      ricarica();
    }
    gettoni -= 1;
    return lavoro();
  });
  // La coda prosegue anche se questo lavoro fallisce: un errore non deve
  // bloccare le ricerche che vengono dopo.
  coda = mio.catch(() => undefined);
  return mio;
}

export type RisultatoRicerca<T = Record<string, string | null>> = {
  results?: Array<{ id: string; properties: T; propertiesWithHistory?: Record<string, Array<{ value: string; timestamp: string }>> }>;
  paging?: { next?: { after?: string } };
  total?: number;
};

/**
 * Una ricerca su HubSpot, in fila e con la ripetizione sul 429.
 *
 * Gli errori diversi dal 429 non si riprovano: un 400 e' una richiesta
 * sbagliata, e insistere non la raddrizza.
 */
export async function ricercaHubSpot<T = Record<string, string | null>>(
  token: string,
  url: string,
  corpo: Record<string, unknown>,
  etichetta = "hubspot"
): Promise<RisultatoRicerca<T>> {
  let attesa = 500;

  for (let tentativo = 0; tentativo < TENTATIVI; tentativo++) {
    const res = await inFila(() =>
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      })
    );

    if (res.ok) return res.json();

    if (res.status === 429 && tentativo < TENTATIVI - 1) {
      const dice = Number(res.headers.get("Retry-After"));
      const quanto = Number.isFinite(dice) && dice > 0 ? dice * 1000 : attesa + Math.random() * 250;
      console.warn(`[${etichetta}] 429 da HubSpot, riprovo fra ${Math.round(quanto)}ms (tentativo ${tentativo + 1})`);
      await dormi(quanto);
      attesa = Math.min(attesa * 2, 8000);
      continue;
    }

    throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  }

  throw new Error(`HubSpot: ${TENTATIVI} tentativi esauriti sul limite di chiamate`);
}

/**
 * Sfoglia una ricerca fino all'ultima pagina.
 *
 * Non c'e' nessuna pausa fra una pagina e l'altra: la mette gia' la fila, ed e'
 * l'unico posto dove deve stare - cosi' non si sommano due ritardi diversi
 * decisi in due file lontane.
 *
 * ATTENZIONE ALLE ROTTE CHE SFOGLIANO MOLTO. A quattro chiamate al secondo,
 * cento pagine sono venticinque secondi: l'andamento su dodici mesi ci va
 * vicino. Se un giorno quella rotta dovesse scadere, la strada non e' alzare il
 * ritmo - il tetto e' di HubSpot - ma tenersi in casa i mesi gia' chiusi, che
 * non cambiano piu'.
 */
export async function sfogliaRicerca<T = Record<string, string | null>>(
  token: string,
  url: string,
  corpo: Record<string, unknown>,
  etichetta = "hubspot"
): Promise<Array<{ id: string; properties: T; propertiesWithHistory?: Record<string, Array<{ value: string; timestamp: string }>> }>> {
  const out: Array<{ id: string; properties: T; propertiesWithHistory?: Record<string, Array<{ value: string; timestamp: string }>> }> = [];
  let after: string | undefined;

  do {
    const d = await ricercaHubSpot<T>(token, url, { ...corpo, ...(after ? { after } : {}) }, etichetta);
    out.push(...(d.results ?? []));
    after = d.paging?.next?.after;
  } while (after);

  return out;
}
