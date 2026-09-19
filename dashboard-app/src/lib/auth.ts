// Accesso con password controllato sul server: la password resta nella variabile
// d'ambiente DASHBOARD_PASSWORD e non arriva mai al browser.
// Dopo l'accesso il browser riceve un cookie di sessione (dura finché non si chiude il browser).

export const AUTH_COOKIE = "dashboard_auth";

export function configuredPassword() {
  return process.env.DASHBOARD_PASSWORD || null;
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

export async function isAuthorized(cookieValue: string | undefined) {
  if (!authRequired()) return true;
  const password = configuredPassword();
  if (!password || !cookieValue) return false;
  return safeEqual(cookieValue, await authToken(password));
}

export async function checkPassword(attempt: string) {
  const password = configuredPassword();
  if (!password) return false;
  return safeEqual(await authToken(attempt), await authToken(password));
}
