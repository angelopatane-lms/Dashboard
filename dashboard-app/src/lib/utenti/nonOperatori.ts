/**
 * Account che su HubSpot esistono e stanno in una squadra, ma dietro non
 * hanno una persona che lavora.
 *
 * PERCHE' SERVE UNA LISTA, e perche' qui. Angelo Patane' ha un secondo
 * account - `angelo.patane.icmd@gmail.com` - che usa per provare le
 * prenotazioni: a novembre 2026 portava 39 appuntamenti e 4 consulenze, tutti
 * finti, dentro i numeri degli Advisor. Il modo ovvio di toglierlo sarebbe
 * marcarlo "Advisor*" nel foglio Hubspot User List, dove l'asterisco segna
 * gia' chi non e' piu' operativo. Misurato l'11 novembre 2026: non funziona.
 * Quella colonna la legge soltanto chi HubSpot non conosce, e questo account
 * HubSpot lo conosce benissimo - `app.principale` dice "Advisor" - quindi il
 * foglio viene scavalcato. Vedi ../operatoriTeam.ts.
 *
 * E TOGLIERLO DAL TEAM SUL PORTALE non basterebbe lo stesso: sparirebbe da
 * oggi, ma le 77 righe storiche resterebbero in tabella, perche' dal 19
 * maggio 2026 le righe passate si giudicano sulla fotografia dei team, che
 * per ogni giorno provato - marzo, giugno, ottobre, novembre - dice "Advisor".
 * E' la stessa regola che l'8 novembre ha rimesso in tabella il passato di chi
 * e' uscito davvero. Qui serve l'opposto: un conto che non e' mai esistito.
 *
 * DUE NUMERAZIONI, ED ENTRAMBE SERVONO. Il foglio degli utenti porta l'id del
 * PROPRIETARIO (1322482887), la fotografia dei team porta l'id UTENTE
 * (60496930): per i vecchi account i due numeri coincidono, per i nuovi no -
 * vedi ./squadraAl.ts. Chi filtra deve usare quello della sua fonte, e il nome
 * resta l'ultima rete per le righe del foglio Operatori, che un id non ce
 * l'hanno.
 *
 * QUESTA LISTA TOGLIE PERSONE DAI NUMERI, quindi si allunga solo per account
 * di servizio o di prova, mai per qualcuno che lavora davvero: per chi lavora
 * e poi esce c'e' gia' la storia dei team, che ne conserva il passato invece
 * di cancellarlo.
 */

import { chiaveNome } from "@/lib/nomi";

/** Come li chiama il foglio Hubspot User List, colonna "Hubspot ID". */
export const NON_OPERATORI_PROPRIETARIO = new Set(["1322482887"]);

/** Come li chiama la fotografia dei team, `hs_internal_user_id`. */
export const NON_OPERATORI_UTENTE = new Set(["60496930"]);

/** L'ultima rete: le righe del foglio Operatori portano solo il nome. */
export const NON_OPERATORI_NOME = new Set([chiaveNome("Angelo Patanè")]);

/** Se un nome, comunque scritto, e' di un account che non lavora. */
export function nonOperatorePerNome(nome: string): boolean {
  const k = chiaveNome(nome);
  return Boolean(k) && NON_OPERATORI_NOME.has(k);
}
