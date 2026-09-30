import { fetchCsv } from "@/lib/csv";
import { chiaveNome } from "@/lib/nomi";

/**
 * Chi appartiene a un team, letto dal foglio degli utenti HubSpot.
 *
 * PERCHE' QUI E NON DENTRO LE PAGINE. La stessa lettura serviva alla pagina
 * Advisor, a quella Setter e ora a quella pubblica, ed era copiata in tutte e
 * tre. Copiata vuol dire libera di divergere: la pagina pubblica era nata con
 * un confronto per prefisso invece che esatto, e si portava dentro anche le
 * quattro persone con Team Principale "Advisor*" - la stessa tabella mostrava
 * quattro righe in piu' dell'originale, e nessuno se ne sarebbe accorto finche'
 * non avesse messo le due schermate una accanto all'altra.
 */

const FOGLIO_UTENTI = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_UTENTI = "0";

export type OperatoriTeam = {
  /** I nomi normalizzati, per confrontarli con la colonna Operatore. */
  chiavi: Set<string>;
  /** Gli stessi nomi come sono scritti nel foglio, in ordine alfabetico:
   *  servono all'agenda, che li mostra in testa alle colonne. */
  nomi: string[];
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
    const righe = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${FOGLIO_UTENTI}/export?format=csv&gid=${GID_UTENTI}`,
      { next: { revalidate: 0 } }
    );
    // Confronto ESATTO sul nome del team: "Advisor*" e' un'altra cosa da
    // "Advisor", e prenderlo per somiglianza cambia le righe della tabella.
    const atteso = chiaveNome(team);
    const soloLoro = righe.filter((r) => chiaveNome((r["Team Principale"] ?? "").toString()) === atteso);
    return {
      chiavi: new Set(soloLoro.map((r) => chiaveNome((r["User"] ?? "").toString())).filter(Boolean)),
      nomi: Array.from(new Set(soloLoro.map((r) => (r["User"] ?? "").toString().trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b, "it")
      )
    };
  } catch {
    return null;
  }
}
