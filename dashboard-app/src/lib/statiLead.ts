/**
 * Gli Stati Lead, e come se ne ricavano Appuntamenti e Consulenze per chi
 * lavora solo al telefono.
 *
 * PERCHE' ESISTE QUESTO FILE. Quattro advisor seguono il low ticket (e ogni
 * tanto l'high ticket) senza fissare videochiamate: niente appuntamento sul
 * calendario, quindi niente trattativa, quindi le colonne Appuntamenti e
 * Consulenze della tabella Advisor restano a zero. Per loro l'unica traccia del
 * lavoro e' lo Stato Lead del contatto, che pero' da solo non basta: va letta
 * la CRONOLOGIA della proprieta', perche' un contatto ne attraversa diversi e
 * sopravvive solo l'ultimo. Chi passa da "Appuntamento fissato" a "in
 * Trattative" perderebbe l'appuntamento, e chi compra diventa "Cliente" in
 * automatico e perde tutto quello che c'era prima.
 *
 * I VALORI QUI SOTTO SONO QUELLI INTERNI DI HUBSPOT, non le etichette. Li ho
 * letti da /crm/v3/properties/contacts/hs_lead_status, e fra i due c'e' piu'
 * di una sorpresa:
 *
 *   - "Persa in Chiamata" sul CRM e' scritta `Persa in Chamata`, senza la i.
 *     E' un refuso, ma e' il valore vero: il giorno in cui qualcuno lo
 *     corregge su HubSpot questo conteggio si azzera senza dire niente.
 *
 *   - "Mancata presentazione" non esiste come opzione: lo stato usato e'
 *     `No Show`.
 *
 *   - I DUE FOLLOW UP SI SOMIGLIANO IN MODO PERICOLOSO. Il pre-consulenza e'
 *     `Semina Follow up`, il post e' `Semina Follow Up (Post Consulenza)`:
 *     differiscono per una maiuscola e un suffisso. Un confronto che ignora le
 *     maiuscole, o che guarda il prefisso, li fonde - e la semina fatta PRIMA
 *     della vendita verrebbe contata come consulenza svolta. Per questo il
 *     confronto qui e' esatto, carattere per carattere, e non va rilassato.
 */

/** Stati usati nella prima fase, prima di andare in vendita. */
export const STATI_PRE_CONSULENZA = [
  "NOT_ANSWERED",
  "Semina Follow up",
  "Da Richiamare",
  "Appuntamento fissato",
  "Interesse futuro",
  "BIN",
  "numero_errato",
  // "Errore" vale come "Numero errato": sono la stessa cosa per chi chiama, e
  // Angelo ha chiesto di trattarli insieme. Nessuno dei due conta come
  // appuntamento o consulenza - stanno qui per completezza della cronologia.
  "Errore",
  "Già contattato"
] as const;

/**
 * Stati usati DOPO aver esposto il prodotto, cioe' dopo una consulenza.
 *
 * `No Show` sta qui perche' si usa su un appuntamento che era stato fissato,
 * ma e' l'unico del gruppo in cui la consulenza NON si e' tenuta: vale come
 * appuntamento e non come consulenza (vedi `contaIngresso`).
 */
export const STATI_POST_CONSULENZA = [
  "Semina Follow Up (Post Consulenza)",
  "in Trattative",
  "No Show",
  "Persa in Chamata"
] as const;

/** L'unico post-consulenza che non vale come consulenza svolta. */
export const STATO_NO_SHOW = "No Show";

/**
 * Lo stato che si mette da se' quando si crea il Boom dal Modulo di Iscrizione.
 *
 * Fuori da entrambi i gruppi di proposito: non dice niente su quante
 * consulenze sono state fatte, dice solo che una e' andata a buon fine - e
 * quella la contiamo dalla trattativa Vinta, non da qui.
 */
export const STATO_CLIENTE = "Cliente";

const PRE = new Set<string>(STATI_PRE_CONSULENZA);
const POST = new Set<string>(STATI_POST_CONSULENZA);

/** Tutti gli stati che ci interessano: gli altri si scartano in lettura. */
export const STATI_RILEVANTI = [...STATI_PRE_CONSULENZA, ...STATI_POST_CONSULENZA];

/**
 * Cosa vale un ingresso in uno stato, ai fini delle due colonne.
 *
 * Il ragionamento, nelle parole della procedura data agli advisor: per arrivare
 * a esporre il prodotto un appuntamento c'e' stato, quindi ogni stato
 * post-consulenza porta con se' anche l'appuntamento. "Appuntamento fissato"
 * invece si ferma li': l'appuntamento c'e', la consulenza non ancora.
 *
 * Gli stati pre-consulenza diversi da "Appuntamento fissato" non contano in
 * nessuna delle due colonne: sono interazione, non appuntamento.
 */
export function contaIngresso(stato: string): { appuntamento: boolean; consulenza: boolean } {
  if (stato === "Appuntamento fissato") return { appuntamento: true, consulenza: false };
  if (stato === STATO_NO_SHOW) return { appuntamento: true, consulenza: false };
  if (POST.has(stato)) return { appuntamento: true, consulenza: true };
  return { appuntamento: false, consulenza: false };
}

export function ePreConsulenza(stato: string): boolean {
  return PRE.has(stato);
}

export function ePostConsulenza(stato: string): boolean {
  return POST.has(stato);
}

/**
 * Chi lavora senza fissare appuntamenti.
 *
 * Sono gli stessi quattro che il Bot Slack tiene fuori dagli overbooking
 * (OVERBOOKING_ESCLUSI): low ticket, tutto al telefono, nessuna videochiamata.
 * Qui stanno i nomi e non gli id perche' un nome si rilegge, un id no: la
 * corrispondenza con HubSpot si risolve a ogni giro dall'elenco dei
 * proprietari, e se un nome non si trova lo script si ferma invece di contare
 * zero in silenzio.
 *
 * NON E' UNA LISTA CONDIVISA COL BOT, che vive in un altro progetto e legge la
 * sua da una variabile d'ambiente. Se cambia chi fa cosa, vanno aggiornate
 * tutte e due - ed e' la ragione per cui questo commento esiste.
 */
export const ADVISOR_TELEFONICI = [
  "Chiara Soldati",
  "Nelly Salinas",
  "Anna Natale",
  "Asia Cuccu"
] as const;

/** Confronto sui nomi con la stessa normalizzazione usata altrove in tabella. */
export function eAdvisorTelefonico(nome: string): boolean {
  const k = nome.trim().toLowerCase().replace(/\s+/g, " ");
  return ADVISOR_TELEFONICI.some((n) => n.toLowerCase() === k);
}
