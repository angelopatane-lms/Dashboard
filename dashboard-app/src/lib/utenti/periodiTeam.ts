import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";

/**
 * IN CHE SQUADRA ERA CIASCUNO, GIORNO PER GIORNO.
 *
 * PERCHE' SERVE. Le tabelle Advisor e Setter filtrano le righe STORICHE del
 * foglio Operatori sull'elenco delle persone DI OGGI. Finche' nessuno esce la
 * differenza non si vede; il giorno in cui qualcuno esce, il suo passato
 * sparisce insieme a lui - non solo dalla riga, ma dalle card in alto e dalla
 * tabella delle campagne, che si calcolano su queste stesse righe. Il 10
 * novembre 2026 erano nove persone: Vincenzo Meglioli con 42 appuntamenti e
 * 25 consulenze nel solo ottobre, Ilaria Pisanu con 35 appuntamenti, Silvia
 * Schiavinato. Lavoro fatto, pagato, e invisibile.
 *
 * E' LO STESSO MOTIVO DI ./squadraAl.ts, con una domanda diversa. Li' serve la
 * squadra di UN giorno solo (il report parla di ieri) e si riavvolge fino a
 * quel giorno. Qui le righe da giudicare sono migliaia e coprono mesi: un
 * riavvolgimento per ogni data vorrebbe dire una lettura del database al
 * giorno. Si riavvolge una volta sola e si tiene il risultato come TRATTI -
 * "dal 3 giugno al 6 novembre e' stato Advisor" - su cui una data si verifica
 * senza toccare piu' niente.
 *
 * SI TENGONO TUTTE LE SQUADRE, non solo quella che interessa, e non e' uno
 * spreco: e' l'unico modo di dare ogni giorno a una squadra sola. Misurata la
 * prima versione, che guardava un team per volta, le righe del 9 ottobre di
 * Sabina Noia - il giorno in cui e' passata dagli Advisor ai Setter -
 * comparivano su tutte e due le pagine. Con tutte le squadre davanti, la
 * domanda diventa "quel giorno in quale stava?", e una risposta sola esclude
 * l'altra.
 *
 * IL LIMITE, ed e' bene saperlo. `utente_team_storia` comincia il 19 maggio
 * 2026, quando l'osservatore e' stato acceso. Chi era gia' uscito prima non ha
 * ne' fotografia ne' movimenti, e per lui non c'e' niente da ricostruire:
 * resta fuori come prima. Sono 48 persone e 4.658 righe, e per rimetterle
 * servirebbe un'altra fonte - l'ultimo team noto, scritto a mano.
 *
 * DAVANTI AL DUBBIO SI CONTA. Un tratto che non sappiamo quando comincia parte
 * da sempre (`-Infinity`): chi oggi e' in squadra e non ha mai cambiato vede
 * tutto il suo storico, cioe' esattamente quello che vedeva prima. La
 * correzione aggiunge righe a chi e' uscito, e sposta - non cancella - quelle
 * di chi ha cambiato squadra.
 */

export type Tratto = {
  /** Il nome del team, come lo scrive HubSpot. */
  team: string;
  /** Istante d'inizio in ms; -Infinity = "c'era gia' e non sappiamo da quando". */
  da: number;
  /** Istante di fine in ms; per chi c'e' ancora arriva a adesso. */
  a: number;
  /** Vero se il tratto e' ancora aperto, cioe' se quella persona c'e' adesso. */
  aperto?: boolean;
};

export type PeriodiSquadra = {
  /** nome normalizzato -> i tratti nel team PRINCIPALE, dal piu' recente. */
  perNome: Map<string, Tratto[]>;
  /**
   * Lo stesso per il SOTTO-TEAM: Programmi, Eventi, Telefonici, Chatter.
   *
   * SERVE A RIMETTERE OGNUNO NELLA SUA SEZIONE DI ALLORA. Senza, chi e'
   * uscito finiva in un gruppo a parte in fondo alla tabella, e chi ha
   * cambiato sotto-team si vedeva in quello di oggi anche guardando un mese
   * in cui stava altrove: Sabina Noia compariva fra i Telefonici anche nel
   * mese in cui faceva l'advisor, perche' Telefonici e' il suo sotto-team di
   * adesso, da Setter.
   */
  sottoPerNome: Map<string, Tratto[]>;
  /** Il movimento piu' vecchio che la storia conosce: prima di questo non sa. */
  dalGiorno: string | null;
};

/**
 * Quanto puo' tardare la storia rispetto alla realta'.
 *
 * I movimenti non portano il momento in cui qualcuno e' stato spostato, ma
 * quello in cui l'osservatore se n'e' accorto, e l'osservatore passa di
 * notte: gli ingressi di ottobre 2026 sono tutti timbrati fra le 03:50 e le
 * 04:30 UTC. Mihaela Tiganciuc ha lavorato il 19 ottobre e risulta entrata
 * nei Setter il 20 alle 04:26 - sono sei righe vere che all'inizio del 19
 * sembrano di nessuno. Trentasei ore coprono il ritardo di un giro con un po'
 * di margine.
 */
const RITARDO_OSSERVATORE = 36 * 3_600_000;

/**
 * Null quando il database non risponde: chi chiama in quel caso fa come prima,
 * cioe' guarda il solo elenco di oggi. Una tabella senza gli usciti e' quella
 * che c'era fino a ieri; una tabella vuota non la vuole nessuno.
 */
export async function periodiSquadra(): Promise<PeriodiSquadra | null> {
  try {
    const db = getDb();

    const [{ rows: adesso }, { rows: movimenti }] = await Promise.all([
      db.query<{ user_id: string | null; nome: string | null; genere: string; team_nome: string | null }>(
        `SELECT user_id::text, nome, genere, team_nome FROM utente_team_adesso`
      ),
      db.query<{
        user_id: string | null;
        nome: string | null;
        azione: string;
        genere: string;
        team_nome: string | null;
        quando: Date;
      }>(
        `SELECT user_id::text, nome, azione, genere, team_nome, quando
           FROM utente_team_storia
          ORDER BY quando DESC`
      )
    ]);

    const nomeDi = new Map<string, string>();
    /** "genere|utente|team" di chi ci sta adesso. */
    const dentroOra = new Set<string>();
    for (const r of adesso) {
      if (!r.user_id) continue;
      if (r.nome) nomeDi.set(r.user_id, r.nome);
      if (!r.team_nome) continue;
      dentroOra.add(`${r.genere}|${r.user_id}|${r.team_nome}`);
    }

    let piuVecchio: number | null = null;
    const eventi = new Map<string, { azione: string; quando: number }[]>();
    for (const m of movimenti) {
      const t = new Date(m.quando).getTime();
      if (!Number.isFinite(t)) continue;
      if (piuVecchio === null || t < piuVecchio) piuVecchio = t;
      if (!m.user_id || !m.team_nome) continue;
      if (m.nome && !nomeDi.has(m.user_id)) nomeDi.set(m.user_id, m.nome);
      const k = `${m.genere}|${m.user_id}|${m.team_nome}`;
      const lista = eventi.get(k) ?? [];
      lista.push({ azione: m.azione, quando: t });
      eventi.set(k, lista);
    }

    // IL RIAVVOLGIMENTO, una coppia persona-squadra alla volta. Si parte da
    // adesso e si va all'indietro: un "aggiunto" chiude il tratto che stavamo
    // seguendo (prima di quel momento era fuori), un "tolto" ne apre uno nuovo
    // (prima di quel momento era dentro).
    const ADESSO = Date.now();
    const perNome = new Map<string, Tratto[]>();
    const sottoPerNome = new Map<string, Tratto[]>();
    for (const k of new Set([...dentroOra, ...eventi.keys()])) {
      const primo = k.indexOf("|");
      const secondo = k.indexOf("|", primo + 1);
      const genere = k.slice(0, primo);
      const user = k.slice(primo + 1, secondo);
      const team = k.slice(secondo + 1);

      let dentro = dentroOra.has(k);
      let fine = ADESSO;
      const tratti: Tratto[] = [];
      for (const e of eventi.get(k) ?? []) {
        if (e.azione === "aggiunto") {
          if (dentro) {
            tratti.push({ team, da: e.quando, a: fine, aperto: fine === ADESSO });
            dentro = false;
          }
        } else if (e.azione === "tolto") {
          if (!dentro) {
            dentro = true;
            fine = e.quando;
          }
        }
      }
      // Quello che resta aperto in fondo viene da prima della storia.
      if (dentro) tratti.push({ team, da: -Infinity, a: fine, aperto: fine === ADESSO });
      if (!tratti.length) continue;

      // PER NOME, perche' per chi e' uscito e' l'unica chiave che resta: il
      // foglio Operatori scrive il nome, non l'id. Vedi ./squadraAl.ts.
      const nome = nomeDi.get(user);
      if (!nome) continue;
      const chiave = chiaveNome(nome);
      const dove = genere === "principale" ? perNome : sottoPerNome;
      dove.set(chiave, [...(dove.get(chiave) ?? []), ...tratti]);
    }

    for (const tratti of perNome.values()) tratti.sort((x, y) => y.a - x.a);
    for (const tratti of sottoPerNome.values()) tratti.sort((x, y) => y.a - x.a);

    return {
      perNome,
      sottoPerNome,
      dalGiorno: piuVecchio === null ? null : new Date(piuVecchio).toISOString().slice(0, 10)
    };
  } catch (e) {
    console.error("[periodiSquadra]", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * In che squadra stava quella persona in quel giorno.
 *
 * - `null` = la storia non la conosce affatto, e chi chiama deve decidere da
 *   solo (di solito: fidarsi dell'elenco di oggi).
 * - `""` = la conosce, ma quel giorno non stava in nessuna squadra.
 *
 * SI GUARDA L'INIZIO DEL GIORNO, com'e' gia' la regola di ./squadraAl.ts: chi
 * viene tolto alle dieci di mattina ha lavorato quella mattina, e la riga di
 * quel giorno resta sua. Guardare invece se il giorno e il tratto si toccano
 * da qualche parte darebbe due risposte nel giorno di un passaggio, e la riga
 * finirebbe contata su tutte e due le pagine.
 *
 * L'ECCEZIONE E' CHI QUEL GIORNO NON STAVA DA NESSUNA PARTE e sta per
 * entrare: il suo primo giorno di lavoro non sarebbe di nessuno. Allora vale
 * la prima squadra in cui entra entro il giro successivo dell'osservatore -
 * vedi RITARDO_OSSERVATORE. L'eccezione NON PUO' CREARE DOPPIONI, perche'
 * scatta solo quando all'inizio del giorno la persona non ha nessuna squadra,
 * cioe' quando nessun'altra pagina sta rivendicando quella riga.
 */
export function teamDelGiorno(periodi: PeriodiSquadra, nome: string, dataIso: string): string | null {
  const tratti = periodi.perNome.get(chiaveNome(nome));
  if (!tratti?.length) return null;
  // La mezzanotte come istante UTC: lo scarto di Roma e' un'ora o due, e un
  // cambio di squadra registrato fra mezzanotte e le due non e' mai successo.
  const inizio = Date.parse(`${dataIso}T00:00:00Z`);
  if (!Number.isFinite(inizio)) return null;

  const allInizio = tratti.find((t) => t.da <= inizio && inizio < t.a);
  if (allInizio) return allInizio.team;

  const staPerEntrare = tratti
    .filter((t) => t.da > inizio && t.da < inizio + RITARDO_OSSERVATORE)
    .sort((x, y) => x.da - y.da)[0];
  return staPerEntrare ? staPerEntrare.team : "";
}

/**
 * In che squadra sta adesso, secondo la stessa ricostruzione.
 *
 * NON E' teamDelGiorno(oggi): quello guarda l'inizio della giornata, perche'
 * chi viene tolto alle quattro di mattina ha comunque lavorato quel giorno.
 * Per dire "oggi non c'e' piu'" serve invece l'istante attuale, o chi e'
 * uscito stamattina risulterebbe ancora dentro fino a mezzanotte.
 *
 * Stringa vuota = la conosce ma oggi non sta in nessuna squadra; `null` = non
 * la conosce affatto.
 */
export function squadraAdesso(periodi: PeriodiSquadra, nome: string): string | null {
  const tratti = periodi.perNome.get(chiaveNome(nome));
  if (!tratti?.length) return null;
  const aperto = tratti.find((t) => t.aperto);
  return aperto ? aperto.team : "";
}
