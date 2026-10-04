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
 * UNA PAROLA SU TRE. "Assegnati" e "Connessioni" reggono su tutti e due i
 * canali - i lead che uno ha in mano, e quanti di loro hanno risposto, che sia
 * al telefono o in chat - e restano com'erano. Cambia solo "Chiamate", perche'
 * un chatter non chiama: scrive. Da qui la mappa invece di tre stringhe in
 * fila: dice cosa cambia, e quello che non c'e' scorre com'e'.
 *
 * ERANO TRE SEGNAPOSTO E NE E' RESTATO UNO, poi nessuno. Vale la pena
 * ricordare come e' andata, perche' e' il motivo per cui questa mappa e'
 * piccola e non va fatta crescere per abitudine: la prima idea era che tre
 * colonne su dodici non andassero bene per i chatter, e guardandole una per
 * una ne e' rimasta una sola. Prima di aggiungere una riga qui conviene
 * chiedersi se la parola che c'e' sia davvero sbagliata o solo poco familiare.
 *
 * SOLO CON IL FILTRO TEAM SU "CHATTER". Nella vista mista le intestazioni
 * restano quelle del telefono: sono la maggioranza delle righe, e un titolo non
 * puo' dire due cose insieme. E' il compromesso che tiene una tabella sola -
 * un totale solo, nove colonne confrontabili - senza mentire quando si guarda
 * il gruppo da vicino.
 */
export const INTESTAZIONI_CHATTER: Record<string, string> = {
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
 * IL TITOLO GIUSTO NON FA IL NUMERO GIUSTO, ed e' il motivo per cui il
 * trattino copre tutte e tre le colonne e non solo quella che cambia nome.
 * "Connessioni" e' la parola buona anche per loro, ma lo zero sotto di essa
 * conta le chiamate andate a buon fine: sulla riga di chi non chiama mai
 * significa "non ho misurato", non "nessuno mi ha risposto". Lo stesso per
 * "Assegnati", che su HubSpot sono due o tre lead smarriti e non il suo carico
 * di lavoro.
 */
export const CHATTER_DATI_ATTESI =
  "I dati dei chatter arrivano da REvio e dall'applicazione interna: la dashboard non li legge ancora.";
