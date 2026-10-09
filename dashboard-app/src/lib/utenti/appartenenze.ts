import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";

/**
 * In che team sta ciascuno, letto dalla fotografia di HubSpot.
 *
 * SI LEGGE DAL DATABASE E NON DA HUBSPOT: la fotografia in `utente_team_adesso`
 * e' la stessa che genera lo storico dei movimenti - vedi ./osserva.ts - e si
 * aggiorna a ogni giro degli Stati Lead, a ogni apertura della finestra dei
 * team e subito dopo ogni modifica fatta da li'. Interrogare HubSpot a ogni
 * pagina vorrebbe dire due letture della stessa cosa, libere di divergere, e
 * una chiamata in piu' su un tetto che condividiamo con decine di flussi.
 *
 * GLI ACCOUNT SPENTI E QUELLI DI SERVIZIO QUI DENTRO NON CI SONO GIA' PIU':
 * li toglie l'osservatore quando posa la fotografia.
 */

export type Appartenenze = {
  /** nome normalizzato -> nome del team principale. */
  principale: Map<string, string>;
  /** nome normalizzato -> nome del sotto-team, uno solo per persona. */
  sotto: Record<string, string>;
  /**
   * Chi HubSpot conosce, anche se non sta in nessun team.
   *
   * SERVE A DISTINGUERE DUE SILENZI. Senza, "HubSpot dice che non ha team" e
   * "HubSpot non lo conosce" si leggono uguali - in entrambi i casi non c'e'
   * una riga - e chi legge tornerebbe a fidarsi del foglio. Togliendo una
   * persona da ogni team, la Dashboard avrebbe continuato a mostrarla dov'era.
   */
  noti: Set<string>;
};

/**
 * Vuote se la fotografia non si legge o non c'e' ancora: chi chiama in quel
 * caso torna a fare come prima, invece di presentare pagine senza nessuno.
 */
export async function appartenenze(): Promise<Appartenenze> {
  const vuote: Appartenenze = { principale: new Map(), sotto: {}, noti: new Set() };
  try {
    const { rows } = await getDb().query<{
      nome: string | null;
      genere: string;
      team_nome: string | null;
    }>(`SELECT nome, genere, team_nome FROM utente_team_adesso`);

    const principale = new Map<string, string>();
    const sotto: Record<string, string> = {};
    const noti = new Set<string>();
    for (const r of rows) {
      if (!r.nome) continue;
      const k = chiaveNome(r.nome);
      noti.add(k);
      if (!r.team_nome) continue;
      if (r.genere === "principale") principale.set(k, r.team_nome);
      else if (r.genere === "secondario") sotto[k] = r.team_nome;
    }
    return { principale, sotto, noti };
  } catch (e) {
    console.error("[appartenenze]", e instanceof Error ? e.message : e);
    return vuote;
  }
}
