// Regole di identita' delle campagne: quali nomi sono validi, qual e' il nome
// vero di una campagna e come si isolano i contatti assegnati subito.
//
// Stanno qui e non nelle singole query perche' database e interfaccia devono
// applicarle nello stesso modo: la spesa arriva dal foglio Ads (lato client) e
// i lead da Postgres (lato server), e se le due parti dividessero le righe in
// modo diverso la tabella mostrerebbe spesa senza lead e lead senza spesa.

/**
 * Regola del dipartimento marketing: id_campagna_refresh deve essere tutto
 * minuscolo. Un nome con una maiuscola non e' un id di campagna valido.
 *
 * COSA COMPORTA, misurato il 5 settembre 2026:
 * - Foglio Ads: 19 nomi su 73 hanno maiuscole (7.514 EUR sul trimestre) e
 *   TUTTI hanno zero lead. Sono nomi scritti a mano che non corrispondono a
 *   nessuna campagna HubSpot: righe di sola spesa, che falsavano CPL e ROAS.
 * - HubSpot: 3.299 campagne su 5.169 hanno maiuscole, ma sono quasi tutte
 *   vecchie (native advertising 2023-24, import da typeform). Sul trimestre
 *   valgono 117 lead su 31.293 (0,37%); su tutto il 2026, 3.505 su 80.571
 *   (4,35%).
 */
export function nomeConforme(nome: string): boolean {
  return nome === nome.toLowerCase();
}

/**
 * MARCATORE DI ASSEGNAZIONE IMMEDIATA, non una campagna.
 *
 * Un workflow HubSpot riscrive id_campagna_refresh aggiungendo "_test_instant"
 * al nome della campagna quando il contatto viene assegnato subito, invece che
 * dopo alcune ore. La riscrittura lascia una voce nella cronologia della
 * proprieta', ed e' quella che il bootstrap aveva letto come una conversione.
 *
 * NON LO E': e' lo stesso contatto, sulla stessa campagna, che cambia stato di
 * assegnazione. Misurato sul trimestre: delle 7.762 persone con un marcatore,
 * 7.760 sono gia' presenti sulla campagna base (il 100%).
 *
 * Ne discende come va trattato:
 * - il nome vero della campagna e' sempre quello senza suffisso;
 * - un marcatore non e' mai un lead ne' una prima conversione;
 * - ma resta l'unico modo per sapere chi e' stato assegnato subito, quindi si
 *   conserva nel database e si usa come filtro (vedi Variante).
 */
export const SUFFISSO_INSTANT = "_test_instant";

/**
 * Quali contatti includere. Il marcatore esiste per confrontare chi viene
 * assegnato subito con chi viene assegnato dopo: il filtro serve a quello.
 *
 * Non e' piu' una scelta su come raggruppare le righe - le varianti confluiscono
 * SEMPRE nella campagna base, perche' sono la stessa campagna.
 */
export type Variante = "tutte" | "instant" | "non_instant";

export const VARIANTE_DEFAULT: Variante = "tutte";

export const VARIANTI: Array<{ label: string; value: Variante }> = [
  { label: "Tutte", value: "tutte" },
  { label: "Instant", value: "instant" },
  { label: "Non instant", value: "non_instant" }
];

export function leggiVariante(valore: string | null | undefined): Variante {
  return valore === "instant" || valore === "non_instant" ? valore : VARIANTE_DEFAULT;
}

/** Il nome vero della campagna: senza marcatore, minuscolo, spazi normalizzati. */
export function nomeBase(nome: string): string {
  const k = nome.trim().toLowerCase().replace(/\s+/g, " ");
  return k.endsWith(SUFFISSO_INSTANT) && k.length > SUFFISSO_INSTANT.length
    ? k.slice(0, -SUFFISSO_INSTANT.length)
    : k;
}

export function haMarcatoreInstant(nome: string): boolean {
  const k = nome.trim().toLowerCase();
  return k.endsWith(SUFFISSO_INSTANT) && k.length > SUFFISSO_INSTANT.length;
}

/**
 * Chiave di raggruppamento di un nome campagna, o null se la riga non va
 * mostrata. Per i dati che arrivano al client gia' pronti: foglio Ads e
 * id_campagna_track di trattative e incassi.
 *
 * Il gemello lato SQL e' SQL_NOME_CAMPAGNA: le due devono restare d'accordo.
 */
export function chiaveCampagna(nome: string): string | null {
  const pulito = nome.trim();
  if (!pulito || !nomeConforme(pulito)) return null;
  return nomeBase(pulito) || null;
}

/** Se una riga con questo nome memorizzato appartiene al segmento scelto. */
export function nelSegmento(nome: string, variante: Variante): boolean {
  if (variante === "tutte") return true;
  const instant = haMarcatoreInstant(nome);
  return variante === "instant" ? instant : !instant;
}

// --- Lato SQL. L'alias della tabella campagna e' sempre "c". ---

/** Il nome vero della campagna, marcatore rimosso. La forma '(.+)' evita di
 *  ridurre a stringa vuota la campagna che si chiama solo "_test_instant". */
export const SQL_NOME_CAMPAGNA = `regexp_replace(lower(trim(c.nome)), '(.+)${SUFFISSO_INSTANT}$', '\\1')`;

/** Solo campagne con un id valido (vedi nomeConforme). */
export const SQL_CAMPAGNA_CONFORME = "c.nome = lower(c.nome)";

// In LIKE l'underscore e' un carattere jolly: va protetto, altrimenti
// "_test_instant" accetterebbe anche "xtestyinstant".
export const SQL_E_MARCATORE = `lower(trim(c.nome)) LIKE '%\\_test\\_instant'`;

/**
 * Filtro di segmento per le tabelle che memorizzano il nome della campagna
 * cosi' com'era al momento del fatto (chiamate, trattative, no-show): il
 * suffisso dice gia' se quel contatto era stato assegnato subito.
 */
export function sqlSegmentoDaNome(variante: Variante): string {
  if (variante === "tutte") return "TRUE";
  return variante === "instant" ? SQL_E_MARCATORE : `NOT (${SQL_E_MARCATORE})`;
}
