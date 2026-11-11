import { fetchCsv } from "@/lib/csv";
import { toDateIso } from "@/lib/metrics";
import { chiaveNome } from "@/lib/nomi";
import { appartenenze } from "@/lib/utenti/appartenenze";
import { periodiSquadra, squadraAdesso, teamDelGiorno, type Tratto } from "@/lib/utenti/periodiTeam";

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
  /**
   * Se una riga del foglio Operatori appartiene a questo team.
   *
   * NON BASTA L'ELENCO DI OGGI, ed e' la ragione per cui questa funzione
   * esiste: `chiavi` dice chi c'e' adesso, e usarla sulle righe storiche
   * cancella il passato di chi e' uscito. Qui la domanda e' un'altra - "quel
   * giorno era in squadra?" - e per chi non c'e' piu' la risposta la da'
   * `utente_team_storia`. Vedi ./utenti/periodiTeam.ts.
   *
   * LA DATA VALE PER TUTTI, anche per chi oggi c'e'. La prima versione faceva
   * passare senza guardare chiunque fosse nell'elenco di oggi, e misurandola
   * si e' visto il buco: Sabina Noia e' passata da Advisor a Setter il 9
   * ottobre 2026, e le sue righe di inizio ottobre comparivano su tutte e due
   * le pagine - tredici righe contate due volte. Chi cambia squadra porta con
   * se' il suo lavoro, non lo duplica.
   *
   * CHI LA STORIA NON CONOSCE AFFATTO passa lo stesso, se e' nell'elenco di
   * oggi: vuol dire che la fotografia e il foglio lo chiamano in due modi
   * diversi, o che HubSpot non lo vede, e in quel caso togliergli tutto
   * sarebbe un danno nuovo al posto di quello vecchio.
   */
  ammetteRiga: (operatore: string, data: string) => boolean;
  /**
   * Se quella persona OGGI in questa squadra non c'e' piu'.
   *
   * SERVE ALLA TABELLA per mettere le sue righe in fondo, sotto un titolo che
   * lo dica, invece che in cima insieme a chi un sotto-team non ce l'ha
   * ancora. E NON BASTA GUARDARE L'ELENCO DI OGGI: Annalisa Cafora nel foglio
   * degli utenti non c'e', ma su HubSpot nei Setter c'e' eccome, e chiamarla
   * uscita sarebbe falso. Chi decide e' la stessa fotografia che decide tutto
   * il resto.
   */
  fuoriOggi: (operatore: string) => boolean;
  /**
   * La storia dei SOTTO-TEAM, per rimettere ognuno nella sua sezione di
   * allora: nome normalizzato -> tratti `{ da, a, team }` in millisecondi.
   *
   * `da: null` vuol dire "da prima che la storia cominciasse". Numeri e non
   * date perche' questo attraversa il confine fra server e browser, dove
   * -Infinity non passa.
   */
  sottoTeamStoria: Record<string, { da: number | null; a: number; team: string }[]>;
  /**
   * LE FINESTRE IN CUI OGNUNO E' STATO IN QUESTA SQUADRA, per nome
   * normalizzato. Serve a scegliere il sotto-team guardando solo i giorni che
   * contano: vedi sottoTeamDelPeriodo in DashboardEnterprise.
   *
   * Chi la storia non conosce non c'e', e per lui vale tutto il periodo.
   */
  periodiNelTeam: Record<string, { da: number | null; a: number }[]>;
  /** Da quando la storia dei movimenti sa rispondere; null se non si e' letta. */
  storiaDal: string | null;
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
    const [righe, app, periodi] = await Promise.all([
      fetchCsv(
        `https://docs.google.com/spreadsheets/d/${FOGLIO_UTENTI}/export?format=csv&gid=${GID_UTENTI}`,
        { next: { revalidate: 0 } }
      ),
      appartenenze(),
      periodiSquadra()
    ]);

    const atteso = chiaveNome(team);
    // Confronto ESATTO sul nome del team: "Advisor*" e' un'altra cosa da
    // "Advisor", e prenderlo per somiglianza cambia le righe della tabella.
    const suo = (r: Record<string, unknown>) => {
      const nome = chiaveNome((r["User"] ?? "").toString());
      // SE HUBSPOT LA CONOSCE, VALE QUELLO CHE DICE - anche quando dice che non
      // sta in nessun team: chi viene tolto da ogni squadra deve sparire da
      // tutte e due le pagine, o quel comando non si vedrebbe da nessuna parte.
      // Chi HubSpot non conosce resta giudicato dal foglio, com'era prima.
      const quale = app.noti.has(nome)
        ? app.principale.get(nome) ?? ""
        : (r["Team Principale"] ?? "").toString();
      return Boolean(quale) && chiaveNome(quale) === atteso;
    };

    const soloLoro = righe.filter(suo);
    const chiavi = new Set(soloLoro.map((r) => chiaveNome((r["User"] ?? "").toString())).filter(Boolean));
    const oggiRoma = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });

    return {
      chiavi,
      ammetteRiga: (operatore: string, data: string) => {
        const k = chiaveNome(operatore);
        if (!k) return false;
        // Senza la storia si fa come prima: l'elenco di oggi su tutto.
        if (!periodi) return chiavi.has(k);
        // Il foglio di oggi non porta la data: quella riga e' di oggi.
        const quale = teamDelGiorno(periodi, k, toDateIso(data) || oggiRoma);
        // La storia non lo conosce: o la fotografia e il foglio lo chiamano in
        // due modi diversi, o HubSpot non lo vede. Decide il foglio, com'era
        // prima: togliergli tutto sarebbe un danno nuovo al posto di quello
        // vecchio.
        if (quale === null) return chiavi.has(k);
        return Boolean(quale) && chiaveNome(quale) === atteso;
      },
      fuoriOggi: (operatore: string) => {
        const k = chiaveNome(operatore);
        if (!k || chiavi.has(k)) return false;
        if (!periodi) return true;
        const quale = squadraAdesso(periodi, k);
        if (quale === null) return true;
        return !(Boolean(quale) && chiaveNome(quale) === atteso);
      },
      sottoTeamStoria: Object.fromEntries(
        [...(periodi?.sottoPerNome ?? new Map<string, Tratto[]>())].map(([nome, tratti]) => [
          nome,
          tratti.map((t: Tratto) => ({ da: Number.isFinite(t.da) ? t.da : null, a: t.a, team: t.team }))
        ])
      ),
      periodiNelTeam: Object.fromEntries(
        [...(periodi?.perNome ?? new Map<string, Tratto[]>())]
          .map(([nome, tratti]) => [
            nome,
            tratti
              .filter((t: Tratto) => chiaveNome(t.team) === atteso)
              .map((t: Tratto) => ({ da: Number.isFinite(t.da) ? t.da : null, a: t.a }))
          ] as const)
          .filter(([, tratti]) => tratti.length)
      ),
      storiaDal: periodi?.dalGiorno ?? null,
      nomi: Array.from(new Set(soloLoro.map((r) => (r["User"] ?? "").toString().trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b, "it")
      ),
      /**
       * Il sotto-team per nome, ma risolto per ID dove il foglio ce l'ha.
       *
       * IL NOME E' L'ULTIMA RISORSA, non la prima: il 13 ottobre 2026 una
       * collega rinominata su HubSpot e' sparita dalla sua sezione della
       * tabella finche' qualcuno non ha rifatto la fotografia. Il foglio ha la
       * colonna "Hubspot ID" ed e' la stessa chiave di `user_id` nella
       * fotografia: con quella, il nome puo' cambiare da una parte e l'altra
       * senza che si perda niente.
       */
      sottoTeam: {
        ...app.sotto,
        ...Object.fromEntries(
          righe
            .map((r) => {
              const chiave = chiaveNome((r["User"] ?? "").toString());
              const id = (r["Hubspot ID"] ?? "").toString().trim();
              const team = id ? app.sottoPerId[id] : undefined;
              return [chiave, team] as const;
            })
            .filter((coppia): coppia is readonly [string, string] => Boolean(coppia[0] && coppia[1]))
        )
      }
    };
  } catch {
    return null;
  }
}
