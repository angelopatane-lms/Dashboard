import { createHmac } from "crypto";

/**
 * Il gettone che apre una singola trascrizione sul nostro endpoint.
 *
 * E' PER TRASCRIZIONE, NON UNA CHIAVE UNICA. L'indirizzo finisce su una
 * proprieta' del contatto in HubSpot, quindi lo vede chiunque apra quella
 * scheda: una chiave valida per tutto sarebbe di fatto pubblica in azienda. Un
 * gettone calcolato sull'identificativo vale solo per quella call, non rivela
 * il segreto con cui e' stato calcolato, e non apre nient'altro.
 *
 * Trentadue caratteri e non sessantaquattro: e' un indirizzo che una persona
 * puo' ritrovarsi a leggere in un campo del CRM, e meta' firma e' abbondante
 * per quello che protegge.
 */
export function gettoneTrascrizione(id: string, segreto: string): string {
  return createHmac("sha256", segreto).update(`trascrizione:${id}`, "utf8").digest("hex").slice(0, 32);
}
