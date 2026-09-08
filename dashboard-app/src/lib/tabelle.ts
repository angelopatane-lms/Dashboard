// Misure e classi condivise dalle tabelle di Campagne, Advisor e Setter.
//
// Stanno insieme perche' le due tabelle devono avere lo stesso aspetto: colonne
// dei numeri della stessa larghezza, stesso separatore, stessa prima colonna
// bloccata. Tenendo le costanti in due file diverse sarebbero divergute alla
// prima modifica.

/**
 * Larghezza delle colonne dei numeri, ricavata dall'intestazione piu' lunga
 * invece che scelta a occhio.
 *
 * Sono tutte uguali e devono contenere l'intestazione su UNA RIGA SOLA: con
 * whitespace-nowrap un valore troppo stretto non manderebbe il testo a capo, lo
 * farebbe uscire nella colonna accanto. Le intestazioni sono in maiuscoletto a
 * 12px con spaziatura allargata, dove un carattere occupa circa 8 pixel; i 20
 * di margine coprono il padding orizzontale.
 *
 * Cosi' se un giorno si rinomina una colonna la larghezza segue da sola.
 */
export function larghezzaColonnaNumeri(intestazioni: string[]): number {
  return Math.max(...intestazioni.map((h) => h.length)) * 8 + 20;
}

/**
 * Larghezza di una colonna di testo, misurata sui valori che ci sono davvero.
 *
 * Deve contenere il valore intero su una riga sola: troncarlo nasconderebbe la
 * fine, che nei nomi campagna e' dove due voci si distinguono, e mandarlo a capo
 * darebbe righe di altezze diverse. Ma fissarla sul caso peggiore sprecherebbe
 * mezzo schermo su ogni riga normale: fra i nomi campagna il piu' lungo e' di 94
 * caratteri contro una mediana di 29.
 *
 * La stima e' 7,6 pixel per carattere piu' il padding, volutamente per eccesso:
 * se cadesse corta il testo uscirebbe dalla colonna.
 */
export function larghezzaColonnaTesto(
  valori: string[],
  minimo: number,
  massimo: number,
  // Spazio oltre al testo: copre il padding della cella e l'errore della stima.
  // Le colonne strette - Categoria, e il nome su Advisor e Setter - usano 14
  // invece di 28, perche' li' il margine si vedeva come vuoto sprecato accanto
  // alla voce piu' lunga. La colonna Campagna tiene 28: e' quella dove un nome
  // che non entra viene troncato, quindi vale la pena essere prudenti.
  margine = 28
): number {
  const piuLungo = valori.reduce((acc, v) => Math.max(acc, v.length), 0);
  return Math.min(Math.max(Math.round(piuLungo * 7.6) + margine, minimo), massimo);
}

/**
 * Classi per le colonne che restano ferme mentre si scorre in orizzontale.
 *
 * Servono a non perdere il riferimento: scorrendo verso le ultime colonne, senza
 * il blocco non si saprebbe piu' di quale campagna - o di quale persona - si
 * stanno leggendo i numeri. Su telefono, dove la tabella e' molto piu' larga
 * dello schermo, e' la differenza fra una tabella usabile e una da indovinare.
 *
 * Ogni cella bloccata ha bisogno di un fondo opaco, altrimenti il contenuto che
 * scorre le passerebbe sotto in trasparenza.
 */
export const BLOCCATA = "sticky z-10";

/**
 * LE LINEE VERTICALI DELLA ZONA BLOCCATA, disegnate come ombre e non come bordi.
 *
 * Con border-collapse i bordi appartengono alla TABELLA, non alla cella: quando
 * si scorre in orizzontale se ne vanno insieme al resto e la linea sparisce,
 * proprio mentre serve di piu'. Le ombre invece si disegnano con la cella, che
 * essendo bloccata resta ferma.
 *
 * Sono ombre INTERNE, disegnate dentro la cella. Un'ombra esterna cadrebbe
 * sopra la cella accanto, che scorre e ha un fondo suo: la linea finiva coperta
 * e a destra non si vedeva. All'interno non c'e' niente che possa coprirla.
 *
 * Il colore e' slate-300 (#cbd5e1) e non il bianco usato fra le colonne dei
 * numeri: le colonne di testo non hanno la mappa di calore, quindi su fondo
 * bianco una linea bianca non si vedrebbe.
 */

/** Linea a sinistra e a destra: per la colonna di testo che sta in mezzo. */
export const LINEE_LATERALI = "shadow-[inset_1px_0_0_0_#cbd5e1,inset_-1px_0_0_0_#cbd5e1]";

/** Solo la linea a destra: per l'unica colonna di testo di Advisor e Setter. */
export const LINEA_DESTRA = "shadow-[inset_-1px_0_0_0_#cbd5e1]";

/**
 * LA RIGA DELLE INTESTAZIONI RESTA IN ALTO mentre le righe le scorrono sotto.
 *
 * Su una tabella da centinaia di campagne, arrivati a meta' elenco non si
 * saprebbe piu' quale numero sta in quale colonna, e si dovrebbe tornare su a
 * ricontrollare a ogni riga.
 *
 * Perche' funzioni il contenitore della tabella deve avere un'altezza massima.
 * Ha overflow-x per lo scorrimento orizzontale, e per specifica CSS questo lo
 * rende contenitore di scorrimento anche in verticale: l'intestazione si
 * aggancia a lui, e senza un tetto d'altezza lui non scorre mai, quindi non si
 * fisserebbe a niente. Con il tetto la tabella scorre dentro di se'.
 */
export const INTESTAZIONE_FERMA = "sticky top-0 z-20";

/**
 * Le celle d'angolo: quelle dell'intestazione sopra le colonne bloccate.
 *
 * Sono ferme in due direzioni insieme, quindi devono stare sopra sia alle altre
 * intestazioni sia alle colonne bloccate, altrimenti scorrendo in diagonale una
 * delle due passerebbe sopra il proprio titolo.
 */
export const INTESTAZIONE_ANGOLO = "sticky top-0 z-30";

/**
 * La linea sotto l'intestazione, disegnata come ombra ESTERNA.
 *
 * Un bordo qui non servirebbe: con border-collapse appartiene alla tabella e se
 * ne andrebbe scorrendo, lasciando i titoli a galleggiare sulle righe. L'ombra
 * invece si disegna con la cella, che resta ferma.
 *
 * INTERNA come le linee verticali, e per lo stesso motivo: provata esterna,
 * spariva appena si scorreva. Su queste celle - dentro una tabella con
 * border-collapse - le ombre esterne non si vedono, e restava a reggere la
 * linea solo il bordo della prima riga, che essendo un bordo della tabella se
 * ne andava scorrendo. Dentro la cella invece l'ombra e' ferma quanto lei.
 *
 * Siccome ora la linea la disegna l'intestazione, la prima riga della prima
 * categoria non ha piu' il suo bordo alto: si sarebbero sommati in una riga
 * grigia doppia.
 */
export const LINEA_SOTTO = "shadow-[inset_0_-2px_0_0_#e2e8f0]";
