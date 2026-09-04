// Regole di business condivise per interpretare i record HubSpot.
//
// Stavano scritte due volte (in DashboardEnterprise e in api/hubspot-boom):
// due copie che vanno tenute allineate a mano sono due copie destinate a
// divergere. Qui c'e' una definizione sola, usata sia dalla pagina Advisor
// (aggregazione per operatore) sia dalla pagina Campagne (per campagna), cosi'
// i numeri delle due pagine si riconciliano per costruzione.

/** Un incasso conta come CHIUSURA solo se e' il primo (o unico) pagamento. */
export const CHIUSURE_TIPOLOGIE = new Set(["Acconto", "Quota unica"]);

/** Contribuiscono all'INCASSATO anche rate e upgrade, che pero' non sono
 *  nuove chiusure: portano denaro su una vendita gia' conclusa. */
export const BOOM_TIPOLOGIE = new Set(["Acconto", "Rata", "Quota unica", "Upgrade"]);

/** Pipeline "Appuntamenti (High Ticket)": la fonte degli appuntamenti fissati. */
export const PIPELINE_APPUNTAMENTI = "433643709";

/** Normalizzazione dei nomi (campagne, operatori) per confronti affidabili. */
export function normalizzaChiave(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
