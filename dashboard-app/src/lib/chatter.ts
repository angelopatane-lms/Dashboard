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

/**
 * Il sotto-team su HubSpot, che dal 12 ottobre 2026 e' la fonte vera.
 *
 * Il commento qui sopra diceva che la lista viveva nel codice perche' "oggi
 * quella colonna non distingue i chatter". Adesso li distingue: il sotto-team
 * Chatter esiste su HubSpot e ci sono dentro cinque persone. Quindi chi e'
 * chatter lo dice HubSpot, come per Telefonici, Eventi e Programmi - e tre
 * account creati il 12 ottobre lo sono diventati senza che nessuno toccasse
 * questo file.
 */
export const SOTTO_TEAM_CHATTER = "Chatter";

/**
 * I due nomi di prima, rimasti SOLO come rete di salvataggio.
 *
 * Servono quando la fotografia dei sotto-team non c'e' - non e' ancora stata
 * presa, o la lettura e' fallita - e senza di loro la tabella tornerebbe a non
 * distinguere nessuno. Non vanno piu' aggiornati a mano: una persona nuova si
 * aggiunge mettendola nel sotto-team Chatter su HubSpot, non qui.
 */
export const CHATTER = ["Bartolo Giordanengo", "Chiara Fiorese"] as const;

/** Confronto sui nomi con la stessa normalizzazione usata in tabella. */
export function eChatter(nome: string): boolean {
  const k = nome.trim().toLowerCase().replace(/\s+/g, " ");
  return CHATTER.some((n) => n.toLowerCase() === k);
}

/**
 * Chi e' chatter: prima HubSpot, poi la lista.
 *
 * `sottoTeam` e' quello che la fotografia dice per quella persona. Quando c'e'
 * decide lui, anche se dice "Telefonici" per uno dei due nomi scritti sopra:
 * una lista scritta a mano che vince su un dato vero e' il modo in cui le due
 * cose divergono e nessuno se ne accorge.
 */
export function eChatterCon(sottoTeam: string | undefined, nome: string): boolean {
  if (sottoTeam) return sottoTeam === SOTTO_TEAM_CHATTER;
  return eChatter(nome);
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

/**
 * Cosa dire quando il numero c'e' davvero.
 *
 * DUE DELLE TRE COLONNE HANNO TROVATO UNA FONTE: Sales Copilot sa quanti lead
 * ha in mano una persona e quanti messaggi ha mandato. "Connessioni" no, e
 * resta un trattino: non e' una colonna che si possa stimare da messaggi e
 * assegnati, e riempirla con un numero vicino sarebbe peggio del trattino.
 */
export const CHATTER_DA_COPILOT = "Da Sales Copilot";

/**
 * Perche' il trattino resta anche ora che la fonte esiste.
 *
 * NESSUN NUMERO NON E' ZERO. Copilot risponde senza persone per i giorni che
 * non ha ancora ricostruito, e una persona che non si aggancia a nessuno dei
 * nostri non ha un numero da mostrare: in entrambi i casi la verita' e' "non
 * lo sappiamo", e uno zero la direbbe al contrario.
 */
export const CHATTER_COPILOT_MUTO =
  "Sales Copilot non ha ancora numeri per questa persona in questo periodo: non e' zero.";
