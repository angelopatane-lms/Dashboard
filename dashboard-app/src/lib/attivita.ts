/**
 * Da quanto tempo nessuno tocca questa pagina.
 *
 * PERCHE' ESISTE. Neon fa pagare il tempo in cui il database e' acceso, non le
 * query, e lo sospende dopo cinque minuti di silenzio. Le ricariche automatiche
 * della Dashboard bastavano a tenerlo sveglio per sempre: il 21 ottobre 2026 il
 * progetto era all'80% delle 100 CU-ore mensili con dieci giorni ancora da
 * fare, e la causa era una scheda lasciata aperta su un computer mai spento.
 *
 * `document.visibilityState` da solo non basta. Dice "visibile" anche quando la
 * finestra sta dietro a un'altra applicazione o su un secondo monitor che
 * nessuno guarda: in quel caso la scheda continua a interrogare, e il conto
 * continua a salire. Qui si guarda invece se un essere umano ha fatto
 * qualcosa - mosso il mouse, premuto un tasto, scrollato, ripreso la scheda.
 *
 * NON E' UNA MISURA DI PRECISIONE, ed e' giusto cosi': serve a distinguere "c'e'
 * qualcuno davanti" da "questa pagina e' aperta e basta da ieri sera". Chi sta
 * davvero guardando la Dashboard l'ha toccata da meno di mezz'ora per
 * definizione, quindi per lui non cambia niente.
 */

const EVENTI = ["mousemove", "pointerdown", "keydown", "scroll", "focus", "visibilitychange"];

let ultimoTocco = Date.now();

if (typeof window !== "undefined") {
  const segna = () => {
    // Tornare su una scheda nascosta conta come tocco; nasconderla no.
    if (document.visibilityState === "visible") ultimoTocco = Date.now();
  };
  for (const e of EVENTI) window.addEventListener(e, segna, { passive: true });
}

/** Millisecondi dall'ultimo segno di vita. */
export const inattivoDa = (): number => Date.now() - ultimoTocco;

/**
 * True se qualcuno ha toccato la pagina da meno di `minuti`.
 *
 * Lato server risponde sempre true: le ricariche automatiche vivono solo nel
 * browser, e un valore prudente qui non puo' fare danni.
 */
export const attivoDaPoco = (minuti = 30): boolean =>
  typeof window === "undefined" || inattivoDa() < minuti * 60 * 1000;
