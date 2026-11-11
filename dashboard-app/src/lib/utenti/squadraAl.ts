import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";
import { NON_OPERATORI_UTENTE } from "./nonOperatori";

/**
 * In che squadra stava ciascuno IN UN GIORNO PASSATO, non adesso.
 *
 * PERCHE' SERVE. Il report parla sempre del giorno prima, e chi lo legge vuole
 * sapere com'era quel giorno. Chiedere alla fotografia di adesso chi era
 * Setter ieri fa sparire il lavoro di chi e' uscito nel frattempo: l'8
 * novembre 2026 Elena Mondino era stata tolta dalla squadra il 5 e Vincenzo
 * Meglioli archiviato il 6, e con la sola fotografia i loro appuntamenti dei
 * giorni precedenti non sarebbero piu' esistiti. La regola decisa quel giorno
 * e' l'opposto: chi era in squadra QUEL GIORNO si conta, anche se oggi non c'e'
 * piu'.
 *
 * COME. La fotografia `utente_team_adesso` dice il presente, e
 * `utente_team_storia` tiene ogni ingresso e ogni uscita con la data - le
 * uscite comprese, anche quelle per account archiviato. Si parte da adesso e si
 * RIAVVOLGE: ogni movimento avvenuto dal giorno chiesto in poi si applica
 * all'inverso, un "aggiunto" si toglie e un "tolto" si rimette. Quello che
 * resta e' la squadra come era all'inizio di quel giorno.
 *
 * ALL'INIZIO DEL GIORNO, NON ALLA FINE, ed e' la ragione per cui si riavvolge
 * anche il giorno stesso: chi viene archiviato a meta' giornata ha lavorato
 * quella mattina, e il report di quella giornata deve ancora vederlo.
 *
 * TRE CHIAVI, perche' nessuna da sola basta. La fotografia e la storia parlano
 * di `user_id`, l'id interno dell'utente; le trattative portano l'id del
 * PROPRIETARIO, che e' un'altra numerazione - per i vecchi account i due numeri
 * coincidono (Mariarosaria di Prisco e' 29871451 in entrambi), per i nuovi no
 * (Bartolo Giordanengo e' 1722494666 come proprietario e 63034338 come utente).
 * L'API dei proprietari fa da ponte, ma SOLO PER CHI E' ATTIVO: per un account
 * archiviato restituisce il nome e non l'id utente. Percio' si cerca per id
 * utente, poi per id uguale, e in ultimo per nome - che per gli usciti e'
 * l'unica chiave che resta.
 */

export type SquadraDi = { principale: string; sotto: string };

export type SquadreAl = {
  /** per id utente HubSpot (`hs_internal_user_id`). */
  perUserId: Map<string, SquadraDi>;
  /** per nome normalizzato: l'ultima risorsa, ma per chi e' uscito e' la sola. */
  perNome: Map<string, SquadraDi>;
  /** Quanti movimenti sono stati riavvolti: zero vuol dire "come adesso". */
  riavvolti: number;
};

/** La mezzanotte di Roma di quel giorno, come istante. */
function inizioRoma(giorno: string): Date {
  const [a, m, g] = giorno.split("-").map(Number);
  const utc = Date.UTC(a, m - 1, g);
  // Lo scarto di Roma a quella data: +1 d'inverno, +2 con l'ora legale.
  const scarto = -new Date(utc).getTimezoneOffset() * 60000;
  return new Date(utc - scarto);
}

/**
 * Null quando il database non risponde: chi chiama in quel caso fa come prima
 * invece di scartare tutti. Un report con un numero da rivedere e' meglio di un
 * report che dice zero.
 */
export async function squadreAl(giorno: string): Promise<SquadreAl | null> {
  try {
    const db = getDb();
    const da = inizioRoma(giorno);

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
      }>(
        `SELECT user_id::text, nome, azione, genere, team_nome
           FROM utente_team_storia
          WHERE quando >= $1
          ORDER BY quando DESC`,
        [da.toISOString()]
      )
    ]);

    // Le appartenenze come insieme di chiavi "utente|genere|team": e' la forma
    // su cui un movimento si applica e si disfa senza ambiguita'.
    const dentro = new Set<string>();
    const nomeDi = new Map<string, string>();
    for (const r of adesso) {
      if (!r.user_id) continue;
      // Gli account di prova non stanno in nessuna squadra, ne' oggi ne' in un
      // giorno passato: chi chiede "di che squadra era" riceve "non lo
      // conosciamo", che e' la risposta vera. Vedi ./nonOperatori.ts.
      if (NON_OPERATORI_UTENTE.has(r.user_id)) continue;
      if (r.nome) nomeDi.set(r.user_id, r.nome);
      if (!r.team_nome) continue;
      dentro.add(`${r.user_id}|${r.genere}|${r.team_nome}`);
    }

    // IL RIAVVOLGIMENTO, dal movimento piu' recente al piu' vecchio.
    for (const m of movimenti) {
      if (!m.user_id || !m.team_nome) continue;
      if (NON_OPERATORI_UTENTE.has(m.user_id)) continue;
      if (m.nome && !nomeDi.has(m.user_id)) nomeDi.set(m.user_id, m.nome);
      const chiave = `${m.user_id}|${m.genere}|${m.team_nome}`;
      if (m.azione === "aggiunto") dentro.delete(chiave);
      else if (m.azione === "tolto") dentro.add(chiave);
    }

    const perUserId = new Map<string, SquadraDi>();
    for (const chiave of dentro) {
      const [user, genere, team] = chiave.split("|");
      const v = perUserId.get(user) ?? { principale: "", sotto: "" };
      if (genere === "principale") v.principale = team;
      else v.sotto = team;
      perUserId.set(user, v);
    }

    const perNome = new Map<string, SquadraDi>();
    for (const [user, v] of perUserId) {
      const nome = nomeDi.get(user);
      if (nome) perNome.set(chiaveNome(nome), v);
    }

    return { perUserId, perNome, riavvolti: movimenti.length };
  } catch {
    return null;
  }
}

/**
 * La squadra di un proprietario, provando le tre chiavi in ordine. Stringa
 * vuota quando nessuna risponde: vuol dire "non lo conosciamo", che e' diverso
 * da "non ha squadra".
 */
export function squadraDiProprietario(
  squadre: SquadreAl,
  proprietario: { id: string; userId?: string; nome?: string }
): SquadraDi | null {
  if (proprietario.userId) {
    const v = squadre.perUserId.get(String(proprietario.userId));
    if (v) return v;
  }
  const uguale = squadre.perUserId.get(String(proprietario.id));
  if (uguale) return uguale;
  if (proprietario.nome) {
    const v = squadre.perNome.get(chiaveNome(proprietario.nome));
    if (v) return v;
  }
  return null;
}
