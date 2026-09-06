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
export function larghezzaColonnaTesto(valori: string[], minimo: number, massimo: number): number {
  const piuLungo = valori.reduce((acc, v) => Math.max(acc, v.length), 0);
  return Math.min(Math.max(Math.round(piuLungo * 7.6) + 28, minimo), massimo);
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
 * Il colore e' slate-300 (#cbd5e1) e non il bianco usato fra le colonne dei
 * numeri: le colonne di testo non hanno la mappa di calore, quindi su fondo
 * bianco una linea bianca non si vedrebbe.
 */

/** Linea a sinistra e a destra: per la colonna di testo che sta in mezzo. */
export const LINEE_LATERALI = "shadow-[inset_1px_0_0_0_#cbd5e1,1px_0_0_0_#cbd5e1]";

/** Solo la linea a destra: per l'unica colonna di testo di Advisor e Setter. */
export const LINEA_DESTRA = "shadow-[1px_0_0_0_#cbd5e1]";
