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

/**
 * Come si chiamano le prime tre colonne quando in tabella ci sono solo loro.
 *
 * LE PAROLE CAMBIANO, LE COLONNE NO. Un chatter non ha lead da chiamare: apre
 * conversazioni e scrive. "Chiamate" sulla sua riga e' uno zero vero e inutile,
 * e sostituirlo con una parola sua costa una riga qui invece di una seconda
 * tabella.
 *
 * "CONNESSIONI" NON E' QUI perche' regge su tutti e due i canali: una
 * connessione e' qualcuno che ha risposto, al telefono come in chat. E' l'unica
 * delle tre parole che non ha bisogno di essere cambiata, ed e' il motivo per
 * cui questa mappa e' una mappa e non tre stringhe in fila: cambia solo quello
 * che va cambiato, il resto scorre com'e'.
 *
 * SOLO CON IL FILTRO TEAM SU "CHATTER". Nella vista mista le intestazioni
 * restano quelle del telefono: sono la maggioranza delle righe, e un titolo non
 * puo' dire due cose insieme. E' il compromesso che tiene una tabella sola -
 * un totale solo, nove colonne confrontabili - senza mentire quando si guarda
 * il gruppo da vicino.
 *
 * "KPI 1" E' UN SEGNAPOSTO, ed e' voluto cosi': la prima metrica non e' ancora
 * decisa, e un nome plausibile messo adesso verrebbe letto come definitivo da
 * chi guarda la tabella e resterebbe li' anche dopo che i dati arrivano da
 * un'altra misura. Un segnaposto che si vede essere un segnaposto si cambia;
 * un nome sbagliato che sembra giusto no. Quando la metrica e' decisa si cambia
 * questa stringa e la tabella si adegua da sola: l'etichetta e' anche la chiave
 * dell'ordinamento.
 */
export const INTESTAZIONI_CHATTER: Record<string, string> = {
  Assegnati: "KPI 1",
  Chiamate: "Messaggi"
};

/**
 * Perche' quelle tre colonne mostrano un trattino invece di un numero.
 *
 * I dati dei chatter non stanno su HubSpot ma su REvio e su un'applicazione
 * fatta in casa, che la dashboard non legge ancora. Finche' non la legge, sotto
 * quei titoli ci sarebbero i numeri di HubSpot: pochi lead assegnati, zero
 * chiamate, zero connessioni.
 *
 * VALE ANCHE PER "CONNESSIONI", che il titolo se lo tiene: la parola e' giusta
 * per tutti e due i canali, il numero no. Lo zero di HubSpot conta le chiamate
 * andate a buon fine, e sulla riga di chi non chiama mai significa "non ho
 * misurato", non "nessuno mi ha risposto".
 */
export const CHATTER_DATI_ATTESI =
  "I dati dei chatter arrivano da REvio e dall'applicazione interna: la dashboard non li legge ancora.";
