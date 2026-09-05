// Regole di identita' delle campagne: quali nomi sono validi e come si
// raggruppano le varianti dello stesso nome.
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
 * MARCATORE DI ASSEGNAZIONE IMMEDIATA, non una campagna a se'.
 *
 * Un workflow HubSpot riscrive id_campagna_refresh aggiungendo "_test_instant"
 * al nome della campagna quando il contatto viene assegnato subito, invece che
 * dopo alcune ore. La riscrittura lascia una voce nella cronologia della
 * proprieta', ed e' quella che il bootstrap aveva letto come una conversione.
 *
 * NON LO E': e' lo stesso contatto, sulla stessa campagna, che cambia stato di
 * assegnazione. Misurato sul trimestre: delle 7.762 persone con un marcatore,
 * 7.760 sono gia' presenti sulla campagna base (il 100%).
 */
export const SUFFISSO_INSTANT = "_test_instant";

/**
 * Come trattare le varianti nella tabella.
 *
 * - "unificate" (preimpostata): le varianti confluiscono nella campagna base e
 *   i marcatori NON contano come conversioni, quindi ogni persona vale uno.
 *   E' la vista giusta per leggere le prestazioni di una campagna.
 * - "tutte": le righe come stanno scritte in HubSpot, marcatori compresi. Vista
 *   diagnostica: serve a vedere cosa c'e' davvero nel dato grezzo, e li' la
 *   somma dei Lead Generati e' per costruzione piu' alta, perche' la stessa
 *   persona compare sulla campagna e sulla sua variante.
 * - "instant": solo le righe col marcatore, cioe' i contatti assegnati subito.
 */
export type Variante = "tutte" | "unificate" | "instant";

export const VARIANTE_DEFAULT: Variante = "unificate";

export const VARIANTI: Array<{ label: string; value: Variante }> = [
  { label: "Tutte", value: "tutte" },
  { label: "Unificate", value: "unificate" },
  { label: "Instant", value: "instant" }
];

export function leggiVariante(valore: string | null | undefined): Variante {
  return valore === "tutte" || valore === "instant" || valore === "unificate" ? valore : VARIANTE_DEFAULT;
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
 * Il gemello lato SQL e' sqlNomeCampagna(): le due devono restare d'accordo.
 */
export function chiaveCampagna(nome: string, variante: Variante): string | null {
  const pulito = nome.trim();
  if (!pulito || !nomeConforme(pulito)) return null;

  const chiave = pulito.toLowerCase().replace(/\s+/g, " ");
  const instant = haMarcatoreInstant(chiave);

  if (variante === "instant") return instant ? chiave : null;
  if (variante === "unificate" && instant) return chiave.slice(0, -SUFFISSO_INSTANT.length);
  return chiave;
}

// --- Lato SQL. L'alias della tabella campagna e' sempre "c". ---

// In LIKE l'underscore e' un carattere jolly: va protetto, altrimenti
// "_test_instant" accetterebbe anche "xtestyinstant".
export function sqlEMarcatore(alias = "c"): string {
  return `lower(trim(${alias}.nome)) LIKE '%\\_test\\_instant'`;
}

export const SQL_E_MARCATORE = sqlEMarcatore();

/** Il nome base di una campagna, marcatore rimosso. La forma '(.+)' evita di
 *  ridurre a stringa vuota la campagna che si chiama solo "_test_instant". */
export function sqlNomeBase(alias = "c"): string {
  return `regexp_replace(lower(trim(${alias}.nome)), '(.+)${SUFFISSO_INSTANT}$', '\\1')`;
}

/** Il nome della riga. Solo con "unificate" il marcatore viene tolto. */
export function sqlNomeCampagna(variante: Variante): string {
  return variante === "unificate" ? sqlNomeBase() : "lower(trim(c.nome))";
}

/** Quali campagne tenere. Da concatenare con AND al resto del filtro. */
export function sqlFiltroCampagna(variante: Variante): string {
  const conforme = "c.nome = lower(c.nome)";
  return variante === "instant" ? `${conforme} AND ${SQL_E_MARCATORE}` : conforme;
}
