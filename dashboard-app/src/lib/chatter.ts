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
 * conversazioni e scrive. "Assegnati", "Chiamate" e "Connessioni" sulla sua
 * riga sono numeri veri che rispondono a un'altra domanda, e sostituirli con
 * parole sue costa una riga qui invece di una seconda tabella.
 *
 * SOLO CON IL FILTRO TEAM SU "CHATTER". Nella vista mista le intestazioni
 * restano quelle del telefono: sono la maggioranza delle righe, e un titolo non
 * puo' dire due cose insieme. E' il compromesso che tiene una tabella sola -
 * un totale solo, nove colonne confrontabili - senza mentire quando si guarda
 * il gruppo da vicino.
 *
 * "KPI 1, 2, 3" SONO SEGNAPOSTO, e sono voluti cosi': le metriche vere non si
 * sanno ancora, e un nome plausibile messo adesso - "Messaggi", "Conversazioni"
 * - verrebbe letto come definitivo da chi guarda la tabella e resterebbe li'
 * anche dopo che i dati arrivano da un'altra misura. Un segnaposto che si vede
 * essere un segnaposto si cambia; un nome sbagliato che sembra giusto no.
 * Quando le tre metriche sono decise si cambiano queste tre stringhe, e la
 * tabella si adegua da sola: l'etichetta e' anche la chiave dell'ordinamento.
 */
export const INTESTAZIONI_CHATTER: Record<string, string> = {
  Assegnati: "KPI 1",
  Chiamate: "KPI 2",
  Connessioni: "KPI 3"
};

/**
 * Perche' quelle tre colonne mostrano un trattino invece di un numero.
 *
 * I dati dei chatter non stanno su HubSpot ma su REvio e su un'applicazione
 * fatta in casa, che la dashboard non legge ancora. Finche' non la legge,
 * sotto quei titoli ci sarebbero i numeri di HubSpot - 3 lead assegnati, zero
 * chiamate, zero connessioni - che rispondono a una domanda diversa da quella
 * che il titolo pone.
 */
export const CHATTER_DATI_ATTESI =
  "I dati dei chatter arrivano da REvio e dall'applicazione interna: la dashboard non li legge ancora.";
