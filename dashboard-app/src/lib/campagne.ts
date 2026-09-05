// Regole di identita' delle campagne: quali nomi sono validi, come si
// raggruppano le varianti dello stesso nome e come si isolano i contatti
// assegnati subito.
//
// Stanno qui e non nelle singole query perche' database e interfaccia devono
// applicarle nello stesso modo: la spesa arriva dal foglio Ads e i lead da
// Postgres, e se le due parti dividessero le righe in modo diverso la tabella
// mostrerebbe spesa senza lead e lead senza spesa.

/**
 * Regola del dipartimento marketing: id_campagna_refresh deve essere tutto
 * minuscolo. Un nome con una maiuscola non e' un id di campagna valido.
 *
 * COSA COMPORTA, misurato il 5 settembre 2026:
 * - Foglio Ads: 19 nomi su 73 hanno maiuscole (7.514 EUR sul trimestre) e
 *   TUTTI hanno zero lead. Sono nomi scritti a mano che non corrispondono a
 *   nessuna campagna HubSpot.
 * - HubSpot: 3.299 campagne su 5.169 hanno maiuscole, ma sono quasi tutte
 *   vecchie (native advertising 2023-24, import da typeform). Sul trimestre
 *   valgono 117 lead su 31.293 (0,37%).
 *
 * La vista "tutte" NON applica questa regola: serve proprio a vedere tutto
 * quello che c'e', ogni voce del foglio della spesa compresa.
 */
export function nomeConforme(nome: string): boolean {
  return nome === nome.toLowerCase();
}

/**
 * SUFFISSI DI VARIANTE. Una campagna puo' comparire con un suffisso che parte
 * da "_test": "_test_instant", "_test_creative", o "_test" secco. Sono la
 * stessa campagna in una versione diversa, e nella vista unificata confluiscono
 * nella base.
 *
 * IL TAGLIO VALE SOLO SE LA BASE ESISTE DAVVERO. Senza quella condizione si
 * romperebbero le campagne in cui "test" fa parte del nome del prodotto:
 * "ll_ew_test_del_denaro" diventerebbe "ll_ew", "lms_coworking_smoke_test"
 * diventerebbe "lms_coworking_smoke". Misurato: dei 77 nomi che contengono
 * "test", 52 hanno una base esistente e vanno uniti, 25 no e vanno lasciati
 * stare, e la condizione li separa esattamente.
 */
export const RE_SUFFISSO_TEST = /_test(_.+)?$/;

/**
 * MARCATORE DI ASSEGNAZIONE IMMEDIATA, non una campagna a se'.
 *
 * Un workflow HubSpot riscrive id_campagna_refresh aggiungendo "_test_instant"
 * al nome della campagna quando il contatto viene assegnato subito, invece che
 * dopo alcune ore. La riscrittura lascia una voce nella cronologia della
 * proprieta', ed e' quella che il bootstrap aveva letto come una conversione.
 *
 * NON LO E': e' lo stesso contatto, sulla stessa campagna, che cambia stato di
 * assegnazione. Misurato: degli 8.382 marcatori del trimestre nessuno e' privo
 * di una conversione vera che lo precede, e la distanza fra i due ha mediana 12
 * secondi.
 *
 * E' un caso particolare di RE_SUFFISSO_TEST, ma va tenuto distinto: solo
 * questo suffisso identifica un gruppo di contatti, gli altri sono solo nomi.
 */
export const SUFFISSO_INSTANT = "_test_instant";

/**
 * Come trattare le varianti nella tabella.
 *
 * - "unificate" (preimpostata): ogni variante confluisce nella campagna base e
 *   i marcatori non contano come conversioni, quindi ogni persona vale uno. E'
 *   la vista giusta per leggere le prestazioni di una campagna.
 * - "tutte": tutto quello che c'e', senza alcun filtro. Nomi non conformi
 *   compresi e ogni voce del foglio della spesa. Vista diagnostica, dove la
 *   somma dei Lead Generati e' per costruzione piu' alta, perche' la stessa
 *   persona compare sulla campagna e sulle sue varianti.
 * - "instant": i contatti assegnati subito.
 * - "non_instant": gli altri, cioe' "unificate" meno "instant".
 */
export type Variante = "tutte" | "unificate" | "instant" | "non_instant";

export const VARIANTE_DEFAULT: Variante = "unificate";

export const VARIANTI: Array<{ label: string; value: Variante }> = [
  { label: "Tutte", value: "tutte" },
  { label: "Unificate", value: "unificate" },
  { label: "Instant", value: "instant" },
  { label: "Non Instant", value: "non_instant" }
];

export function leggiVariante(valore: string | null | undefined): Variante {
  return valore === "tutte" || valore === "instant" || valore === "non_instant" || valore === "unificate"
    ? valore
    : VARIANTE_DEFAULT;
}

/** Le viste che guardano un sottoinsieme dei contatti di una campagna. */
export function varianteEsegmento(variante: Variante): boolean {
  return variante === "instant" || variante === "non_instant";
}

export function haMarcatoreInstant(nome: string): boolean {
  const k = nome.trim().toLowerCase();
  return k.endsWith(SUFFISSO_INSTANT) && k.length > SUFFISSO_INSTANT.length;
}

function normalizza(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Mappa "nome con suffisso" -> "nome base", per i soli nomi la cui base esiste
 * davvero. La costruisce il server, che ha l'elenco delle campagne, e la
 * consuma il client: vedi /api/campaign-ads.
 */
export type MappaVarianti = Record<string, string>;

/**
 * Chiave di raggruppamento di un nome campagna, o null se la riga non va
 * mostrata in questa vista. Serve ai dati che arrivano al client gia' pronti:
 * foglio Ads e id_campagna_track di trattative e incassi.
 *
 * Il gemello lato SQL e' sqlNomeCampagna(): le due devono restare d'accordo.
 */
export function chiaveCampagna(nome: string, variante: Variante, basi: MappaVarianti = {}): string | null {
  const pulito = nome.trim();
  if (!pulito) return null;

  // "tutte" non tocca niente, nemmeno le maiuscole: due grafie diverse restano
  // due righe diverse, che e' il senso di una vista grezza.
  if (variante === "tutte") return pulito;

  if (!nomeConforme(pulito)) return null;
  const chiave = normalizza(pulito);
  const instant = haMarcatoreInstant(chiave);

  if (variante === "instant") return instant ? chiave : null;
  if (variante === "non_instant" && instant) return null;
  return basi[chiave] ?? chiave;
}

// --- Lato SQL. L'alias della tabella campagna e' sempre "c", quello della sua
// --- copia usata per risolvere la base e' "b" (vedi SQL_JOIN_BASE).

// In LIKE l'underscore e' un carattere jolly: va protetto, altrimenti
// "_test_instant" accetterebbe anche "xtestyinstant".
export function sqlEMarcatore(alias = "c"): string {
  return `lower(trim(${alias}.nome)) LIKE '%\\_test\\_instant'`;
}

export const SQL_E_MARCATORE = sqlEMarcatore();

/** Il nome base di una campagna, suffisso di variante rimosso. */
export function sqlNomeBase(alias = "c"): string {
  return `regexp_replace(lower(trim(${alias}.nome)), '_test(_.+)?$', '')`;
}

/**
 * Aggancia la campagna base, quando esiste. E' una LEFT JOIN sulla tabella vera
 * e non una CTE: la chiave unica su "nome" la rende una ricerca per indice,
 * mentre una CTE - di cui il pianificatore non sa stimare le righe - lo portava
 * a rileggerla per intero a ogni riga.
 */
export const SQL_JOIN_BASE = `LEFT JOIN campagna b
    ON b.nome = ${sqlNomeBase()} AND b.nome <> lower(trim(c.nome))`;

/** Se la vista ha bisogno di SQL_JOIN_BASE. */
export function varianteUnificaNomi(variante: Variante): boolean {
  return variante === "unificate" || variante === "non_instant";
}

/** Il nome della riga. */
export function sqlNomeCampagna(variante: Variante): string {
  if (variante === "tutte") return "trim(c.nome)";
  if (varianteUnificaNomi(variante)) return "COALESCE(b.nome, lower(trim(c.nome)))";
  return "lower(trim(c.nome))";
}

/** Quali campagne tenere. Da concatenare con AND al resto del filtro. */
export function sqlFiltroCampagna(variante: Variante): string {
  if (variante === "tutte") return "TRUE";
  const conforme = "c.nome = lower(c.nome)";
  if (variante === "instant") return `${conforme} AND ${SQL_E_MARCATORE}`;
  if (variante === "non_instant") return `${conforme} AND NOT (${SQL_E_MARCATORE})`;
  return conforme;
}
