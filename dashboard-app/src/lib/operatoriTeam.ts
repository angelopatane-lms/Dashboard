import { fetchCsv } from "@/lib/csv";
import { chiaveNome } from "@/lib/nomi";
import { appartenenze } from "@/lib/utenti/appartenenze";

/**
 * Chi appartiene a un team: il foglio dice chi e' un operatore, HubSpot dice
 * in quale squadra sta.
 *
 * PERCHE' DUE FONTI E NON UNA. Non sono due risposte alla stessa domanda, sono
 * due domande diverse. Il foglio degli utenti HubSpot e' l'elenco delle
 * persone che lavorano: dentro ci sono solo loro, e nomi scritti come la
 * dashboard li mostra. Su HubSpot invece in "Advisor" e "Setter" ci sono anche
 * account che operatori non sono - Francesca Gallo e Vale Rubino, che non
 * possiedono nessun contatto - e prendendo HubSpot in blocco comparirebbero in
 * tabella come persone a zero.
 *
 * MA IL TEAM LO DECIDE HUBSPOT, non il foglio. Il 9 ottobre 2026 Sabina Noia e'
 * passata agli Setter dalla finestra dei team: su HubSpot il cambio e' avvenuto
 * davvero - 240 contatti hanno cambiato squadra - ma la dashboard ha continuato
 * a mostrarla fra gli Advisor, perche' il foglio si aggiorna al massimo una
 * volta al giorno e quella colonna la scrive una persona. Due fonti per la
 * stessa domanda sono libere di divergere, e divergono sempre il giorno in cui
 * qualcuno fa un cambio.
 *
 * SE LA FOTOGRAFIA NON C'E' si torna alla colonna del foglio, cioe' a come
 * funzionava prima: una pagina con i team di ieri e' meglio di una pagina
 * vuota.
 *
 * PERCHE' QUI E NON DENTRO LE PAGINE. La stessa lettura serve alla pagina
 * Advisor, a quella Setter e alle due pubbliche, ed era copiata in tutte.
 * Copiata vuol dire libera di divergere: la pagina pubblica era nata con un
 * confronto per prefisso invece che esatto, e si portava dentro anche le
 * persone con Team Principale "Advisor*" - la stessa tabella mostrava quattro
 * righe in piu' dell'originale, e nessuno se ne sarebbe accorto finche' non
 * avesse messo le due schermate una accanto all'altra.
 */

const FOGLIO_UTENTI = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_UTENTI = "0";

export type OperatoriTeam = {
  /** I nomi normalizzati, per confrontarli con la colonna Operatore. */
  chiavi: Set<string>;
  /** Gli stessi nomi come sono scritti nel foglio, in ordine alfabetico:
   *  servono all'agenda, che li mostra in testa alle colonne. */
  nomi: string[];
  /** Il sotto-team di ciascuno, per nome normalizzato: serve alla tabella per
   *  dividersi in sezioni. Vuoto quando la fotografia non c'e'. */
  sottoTeam: Record<string, string>;
};

/**
 * Null quando il foglio non risponde, e chi chiama in quel caso non filtra
 * niente: meglio la tabella intera che nessuna tabella.
 *
 * SENZA CACHE, di proposito. E' l'elenco delle persone: chi lo modifica si
 * aspetta di vedere l'effetto subito, ed e' gia' la seconda volta che una cache
 * ci fa perdere tempo - prima teneva la lista ferma fino alle 19:30, poi cinque
 * minuti, e in entrambi i casi la conclusione e' stata "il filtro non funziona"
 * mentre funzionava benissimo su dati vecchi. Sono 6 KB per apertura di pagina.
 */
export async function operatoriDelTeam(team: string): Promise<OperatoriTeam | null> {
  try {
    const [righe, app] = await Promise.all([
      fetchCsv(
        `https://docs.google.com/spreadsheets/d/${FOGLIO_UTENTI}/export?format=csv&gid=${GID_UTENTI}`,
        { next: { revalidate: 0 } }
      ),
      appartenenze()
    ]);

    const atteso = chiaveNome(team);
    // Confronto ESATTO sul nome del team: "Advisor*" e' un'altra cosa da
    // "Advisor", e prenderlo per somiglianza cambia le righe della tabella.
    const suo = (r: Record<string, unknown>) => {
      const nome = chiaveNome((r["User"] ?? "").toString());
      const daHubSpot = app.principale.get(nome);
      // Chi HubSpot non conosce resta giudicato dal foglio, com'era prima.
      const quale = daHubSpot ?? (r["Team Principale"] ?? "").toString();
      return chiaveNome(quale) === atteso;
    };

    const soloLoro = righe.filter(suo);
    return {
      chiavi: new Set(soloLoro.map((r) => chiaveNome((r["User"] ?? "").toString())).filter(Boolean)),
      nomi: Array.from(new Set(soloLoro.map((r) => (r["User"] ?? "").toString().trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b, "it")
      ),
      sottoTeam: app.sotto
    };
  } catch {
    return null;
  }
}
