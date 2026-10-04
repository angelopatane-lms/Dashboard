/**
 * Chi fissa appuntamenti dalla chat invece che al telefono.
 *
 * PERCHE' UNA LISTA NEL CODICE E NON NEL FOGLIO. Il foglio "Hubspot User List"
 * e' il posto dove i ruoli sono gia' dichiarati - Team Principale dice Advisor
 * o Setter - e sarebbe la casa giusta anche per questo: cambiando ruolo lo
 * aggiornerebbe chi di dovere, senza un rilascio. Oggi pero' quella colonna non
 * distingue i chatter: Giordanengo, Fiorese e De Vizio risultano tutti
 * "Setter". Finche' resta cosi' la lista vive qui, ed e' la seconda del
 * progetto dopo ADVISOR_TELEFONICI: due liste scritte a mano che possono
 * divergere da chi fa cosa davvero, e di cui nessuno si accorge finche' un
 * numero non sembra strano.
 *
 * COME SI RICONOSCONO NEI DATI, se un giorno servisse verificarla: fissano
 * appuntamenti con ZERO chiamate. A settembre 2026 Giordanengo ha fatto 35
 * appuntamenti con 0 chiamate e 0 connessioni, Fiorese 17 con 0 e 0. Non uso
 * questo segnale per decidere l'appartenenza - un telefonico con un mese fiacco
 * ci finirebbe dentro da solo - ma serve a controllare che la lista sia ancora
 * giusta.
 *
 * VALENTINA DE VIZIO NON E' QUI, pur essendo stata descritta come meta' setter
 * e meta' chatter: a settembre ha fatto 892 chiamate e 423 connessioni, quindi
 * il grosso del suo lavoro e' al telefono. Chi fa entrambe le cose finisce
 * comunque in un gruppo solo, perche' il foglio Operatori non separa
 * l'attivita' per canale: la riga e' una sola e dice quanti appuntamenti, non
 * da dove sono arrivati.
 */

export const CHATTER = ["Bartolo Giordanengo", "Chiara Fiorese"] as const;

/** Confronto sui nomi con la stessa normalizzazione usata in tabella. */
export function eChatter(nome: string): boolean {
  const k = nome.trim().toLowerCase().replace(/\s+/g, " ");
  return CHATTER.some((n) => n.toLowerCase() === k);
}
