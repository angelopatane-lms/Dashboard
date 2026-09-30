// Accesso con password controllato sul server: la password resta nella variabile
// d'ambiente DASHBOARD_PASSWORD e non arriva mai al browser.
// Dopo l'accesso il browser riceve un cookie di sessione (dura finché non si chiude il browser).
//
// DUE PASSWORD, DUE LIVELLI.
//
// Quella di sempre apre tutto. La seconda - DASHBOARD_PASSWORD_RIDOTTA - apre
// soltanto le pagine sotto /pubblico, cioe' la tabella KPI Advisor con i suoi
// filtri: numeri aggregati per operatore, senza nomi di contatti, telefoni o
// collegamenti alle registrazioni.
//
// PERCHE' NON UNA PAGINA SENZA PASSWORD. La tabella non si disegna da sola: i
// numeri li chiede il browser a quattro rotte interne, che restituiscono piu'
// dettaglio di quello che si vede a schermo - l'importo di ogni singolo
// incasso, il prodotto, gli id di campagna. Aprendo la pagina si sarebbero
// dovute aprire anche quelle, e chi ne trovava l'indirizzo vedeva i ricavi
// vendita per vendita. Con una seconda password non si apre niente al mondo:
// cambia solo quanto vede chi entra.

export const AUTH_COOKIE = "dashboard_auth";

/** Quanto vede chi ha fatto l'accesso. */
export type Livello = "piena" | "ridotta";

export function configuredPassword() {
  return process.env.DASHBOARD_PASSWORD || null;
}

/** La seconda password. Se non e' impostata, il livello ridotto non esiste e
 *  le pagine sotto /pubblico restano raggiungibili solo con quella piena. */
export function configuredPasswordRidotta() {
  return process.env.DASHBOARD_PASSWORD_RIDOTTA || null;
}

/** In locale senza password si entra liberamente; online, senza password, resta tutto chiuso. */
export function authRequired() {
  return Boolean(configuredPassword()) || process.env.NODE_ENV === "production";
}

/** Il cookie contiene un'impronta della password, non la password: se la password cambia, va rifatto l'accesso. */
export async function authToken(password: string) {
  const data = new TextEncoder().encode(`dashboard:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Confronto a tempo costante, per non rivelare quanti caratteri sono giusti. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Che livello vale il cookie che arriva.
 *
 * Si confrontano le impronte di ENTRAMBE le password anche quando la prima
 * combacia gia': saltare il secondo confronto farebbe misurare tempi diversi a
 * seconda di quale password si ha in mano, e da li' si capisce quale delle due
 * si sta indovinando.
 */
export async function livelloDaCookie(cookieValue: string | undefined): Promise<Livello | null> {
  if (!authRequired()) return "piena";
  if (!cookieValue) return null;
  const piena = configuredPassword();
  const ridotta = configuredPasswordRidotta();
  const combaciaPiena = piena ? safeEqual(cookieValue, await authToken(piena)) : false;
  const combaciaRidotta = ridotta ? safeEqual(cookieValue, await authToken(ridotta)) : false;
  if (combaciaPiena) return "piena";
  if (combaciaRidotta) return "ridotta";
  return null;
}

/**
 * La password digitata, e che livello apre.
 *
 * Si provano tutte e due sempre, per lo stesso motivo di sopra.
 */
export async function livelloDiPassword(attempt: string): Promise<Livello | null> {
  const impronta = await authToken(attempt);
  const piena = configuredPassword();
  const ridotta = configuredPasswordRidotta();
  const combaciaPiena = piena ? safeEqual(impronta, await authToken(piena)) : false;
  const combaciaRidotta = ridotta ? safeEqual(impronta, await authToken(ridotta)) : false;
  if (combaciaPiena) return "piena";
  if (combaciaRidotta) return "ridotta";
  return null;
}
