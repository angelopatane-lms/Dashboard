// Accesso con password controllato sul server: la password resta nella variabile
// d'ambiente DASHBOARD_PASSWORD e non arriva mai al browser.
// Dopo l'accesso il browser riceve un cookie di sessione (dura finché non si chiude il browser).
//
// PIU' PASSWORD, PIU' LIVELLI.
//
// Quella di sempre apre tutto. Le altre aprono ciascuna UNA pagina sotto
// /pubblico: ADVISOR_DASHBOARD_PASSWORD la tabella KPI Advisor, SETTER_DASHBOARD_PASSWORD
// la tabella KPI Setter, ognuna con i suoi filtri - numeri aggregati per
// operatore, senza nomi di contatti, telefoni o collegamenti alle registrazioni.
// Chi ha quella degli Advisor non vede i Setter e viceversa: sono due pubblici
// diversi, e la password dice a quale si appartiene.
//
// PERCHE' NON UNA PAGINA SENZA PASSWORD. La tabella non si disegna da sola: i
// numeri li chiede il browser a rotte interne, alcune delle quali restituiscono
// piu' dettaglio di quello che si vede a schermo - l'importo di ogni singolo
// incasso, il prodotto, gli id di campagna. Aprendo la pagina si sarebbero
// dovute aprire anche quelle, e chi ne trovava l'indirizzo vedeva i ricavi
// vendita per vendita. Con una password in piu' non si apre niente al mondo:
// cambia solo quanto vede chi entra.

export const AUTH_COOKIE = "dashboard_auth";

/** Le password che aprono una pagina sola, e quale. */
const LIVELLI_RIDOTTI = {
  advisor: { variabile: "ADVISOR_DASHBOARD_PASSWORD", pagina: "/pubblico/advisor" },
  setter: { variabile: "SETTER_DASHBOARD_PASSWORD", pagina: "/pubblico/setter" }
} as const;

export type LivelloRidotto = keyof typeof LIVELLI_RIDOTTI;

/** Quanto vede chi ha fatto l'accesso. */
export type Livello = "piena" | LivelloRidotto;

export function configuredPassword() {
  return process.env.DASHBOARD_PASSWORD || null;
}

/** L'unica pagina che apre un livello ridotto. */
export function paginaDelLivello(livello: LivelloRidotto) {
  return LIVELLI_RIDOTTI[livello].pagina;
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
 * Che livello vale un'impronta.
 *
 * Si confronta con TUTTE le password impostate anche quando una combacia gia':
 * fermarsi alla prima farebbe misurare tempi diversi a seconda di quale
 * password si ha in mano, e da li' si capisce quale si sta indovinando.
 * Se due password coincidono vince quella che apre di piu'.
 */
async function livelloDiImpronta(impronta: string): Promise<Livello | null> {
  const candidati: Array<[Livello, string | null]> = [
    ["piena", configuredPassword()],
    ...Object.entries(LIVELLI_RIDOTTI).map(
      ([livello, { variabile }]) => [livello as LivelloRidotto, process.env[variabile] || null] as [Livello, string | null]
    )
  ];
  let trovato: Livello | null = null;
  for (const [livello, password] of candidati) {
    const combacia = password ? safeEqual(impronta, await authToken(password)) : false;
    if (combacia && !trovato) trovato = livello;
  }
  return trovato;
}

/** Che livello vale il cookie che arriva. */
export async function livelloDaCookie(cookieValue: string | undefined): Promise<Livello | null> {
  if (!authRequired()) return "piena";
  if (!cookieValue) return null;
  return livelloDiImpronta(cookieValue);
}

/** La password digitata, e che livello apre. */
export async function livelloDiPassword(attempt: string): Promise<Livello | null> {
  return livelloDiImpronta(await authToken(attempt));
}
