// Regole di identita' delle campagne: quali nomi sono validi e come si
// raggruppano le varianti dello stesso nome.
//
// Stanno qui e non nelle singole query perche' database e interfaccia devono
// applicarle nello stesso modo: la spesa arriva dal foglio Ads (lato client) e
// i lead da Postgres (lato server), e se le due parti dividessero le righe in
// modo diverso la tabella mostrerebbe spesa senza lead e lead senza spesa
// esattamente come prima.

/**
 * Regola del dipartimento marketing: id_campagna_refresh deve essere tutto
 * minuscolo. Un nome con una maiuscola non e' un id di campagna valido.
 *
 * COSA COMPORTA, misurato il 5 settembre 2026:
 * - Foglio Ads: 19 nomi su 73 hanno maiuscole (7.514 EUR sul trimestre) e
 *   TUTTI hanno zero lead. Sono nomi scritti a mano che non corrispondono a
 *   nessuna campagna HubSpot: righe di sola spesa, che falsavano i totali.
 * - HubSpot: 3.299 campagne su 5.169 hanno maiuscole, ma sono quasi tutte
 *   vecchie (native advertising 2023-24, import da typeform). Sul trimestre
 *   valgono 117 lead su 31.293 (0,37%); su tutto il 2026, 3.505 su 80.571
 *   (4,35%).
 *
 * Fra queste ce ne sono 44 che sono solo l'errore di battitura di una campagna
 * vera ("Rem_meet_greet..." accanto a "rem_meet_greet..."), e prima venivano
 * fuse nel gemello minuscolo. Escluderle costa 72 lead sul trimestre. Si e'
 * scelto di escluderle comunque: una regola che si spiega in una riga vale piu'
 * dello 0,2% di lead recuperati per congettura.
 */
export function nomeConforme(nome: string): boolean {
  return nome === nome.toLowerCase();
}

/**
 * Varianti "instant": stessa campagna, distribuzione immediata tramite un
 * flusso HubSpot dedicato. Esistono solo lato lead (51 campagne, 12.281
 * eventi): nel foglio della spesa non compaiono mai, perche' non hanno un
 * budget proprio.
 */
export const SUFFISSO_INSTANT = "_test_instant";

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

/**
 * Chiave di raggruppamento di un nome campagna, o null se la riga non va
 * mostrata. Usata sui dati che arrivano al client gia' pronti (foglio Ads,
 * id_campagna_track delle trattative e degli incassi).
 *
 * Il gemello lato SQL e' sqlNomeCampagna(): le due devono restare d'accordo.
 */
export function chiaveCampagna(nome: string, variante: Variante): string | null {
  const pulito = nome.trim();
  if (!pulito || !nomeConforme(pulito)) return null;

  const chiave = pulito.toLowerCase().replace(/\s+/g, " ");
  const instant = chiave.endsWith(SUFFISSO_INSTANT) && chiave.length > SUFFISSO_INSTANT.length;

  if (variante === "instant") return instant ? chiave : null;
  if (variante === "unificate" && instant) return chiave.slice(0, -SUFFISSO_INSTANT.length);
  return chiave;
}

/**
 * Espressione SQL che produce il nome della riga. Con "unificate" la variante
 * instant confluisce nella campagna base; la forma '(.+)_test_instant' evita di
 * ridurre a stringa vuota la campagna che si chiama solo "_test_instant".
 */
export function sqlNomeCampagna(variante: Variante, alias = "c"): string {
  const nome = `lower(trim(${alias}.nome))`;
  return variante === "unificate" ? `regexp_replace(${nome}, '(.+)${SUFFISSO_INSTANT}$', '\\1')` : nome;
}

/**
 * Condizione WHERE che tiene solo le campagne da mostrare. Da concatenare con
 * AND al resto del filtro.
 */
export function sqlFiltroCampagna(variante: Variante, alias = "c"): string {
  const conforme = `${alias}.nome = lower(${alias}.nome)`;
  if (variante !== "instant") return conforme;
  // In LIKE l'underscore e' un carattere jolly: va protetto, altrimenti
  // "_test_instant" accetterebbe anche "xtestyinstant".
  return `${conforme} AND lower(trim(${alias}.nome)) LIKE '%\_test\_instant'`;
}
