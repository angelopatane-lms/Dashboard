import { getDb } from "@/lib/db";

/**
 * Spostare una persona di team, da qui invece che da HubSpot.
 *
 * COME SI TOGLIE UN SOTTO-TEAM, che e' la parte che non si trova scritta da
 * nessuna parte. `PUT /settings/v3/users/{id}` e' documentato come
 * SOSTITUZIONE di `secondaryTeamIds`, ma non lo e': mandare la lista senza un
 * team lo lascia dov'e'. Provato il 9 ottobre 2026 in sei modi - lista
 * ridotta, lista vuota, `null`, oggetto utente completo, endpoint con la
 * versione nella rotta, `PATCH` (405) - tutti con risposta 200 e nessun
 * effetto. Le rotte dal lato del team danno 404, e `hs_owning_teams`
 * sull'oggetto CRM `users` risulta scrivibile ma e' uno specchio che HubSpot
 * ricalcola. L'unica cosa che toglie e' `secondaryTeamIds: [""]`, che svuota
 * tutto; `["", id]` da' 400. Quindi una sostituzione sono DUE chiamate.
 *
 * IL PRINCIPALE INVECE SI SCRIVE E BASTA: e' un valore singolo, si sostituisce
 * con l'id nuovo e si azzera con `""` (non con `null`, che risponde ok e non fa
 * niente). Provato il 9 ottobre 2026.
 *
 * COSA SIGNIFICA CAMBIARE IL PRINCIPALE. Non e' un'etichetta: `hubspot_team_id`
 * di tutti i contatti e le trattative della persona si riscrive, e non dal
 * giorno del cambio in avanti - su TUTTI, anche su quelli di mesi fa. I record
 * entrano ed escono dai filtri per team dei flussi e cambia chi li vede. Visto
 * accadere sul contatto 884973649118, passato da Setter ad Advisor il 6 ottobre
 * 2026 insieme al suo proprietario.
 *
 * ED E' PER QUESTO CHE OGNI MOVIMENTO LASCIA UNA RIGA. HubSpot non conserva
 * nessuno storico dei team: dopo uno spostamento i mesi passati si rileggono
 * come se la persona fosse sempre stata nella squadra nuova. Le righe in
 * `utente_team_storia` sono l'unica copia di quell'informazione, e sono quello
 * che permette di rimettere le persone nella riga giusta guardando settembre.
 * I cambi fatti sul portale non passano da qui: li raccoglie l'osservatore in
 * ./osserva.ts, confrontando la composizione di oggi con quella del giro prima.
 */

const HUBSPOT = "https://api.hubapi.com";

/**
 * Quali sotto-team spettano a quale team principale.
 *
 * SCRITTA QUI PERCHE' HUBSPOT NON LA SA: `/settings/v3/users/teams` non
 * espone nessun `parentTeamId` - i nove team sono tutti allo stesso livello, e
 * la parentela esiste solo nel modo in cui l'azienda li usa. Finche' e' cosi'
 * questa mappa e' la fonte, e va aggiornata qui quando nasce un sotto-team.
 */
export const SOTTO_PER_PRINCIPALE: Record<string, string[]> = {
  "136290156": ["192153511", "192070945"], // Advisor -> Programmi, Eventi
  "140488894": ["192154168", "192154352"] // Setter  -> Telefonici, Chatter
};

/** I team principali: quelli a cui una persona appartiene, uno solo alla volta. */
const PRINCIPALI = new Set([
  "136290156", // Advisor
  "140488894", // Setter
  "145156693", // Customer Success
  "145157437", // Junior Customer Success
  "156454541" // Coach LMS
]);

/**
 * Il valore che svuota i sotto-team.
 *
 * Una costante con un nome, perche' letto nel codice `[""]` sembra un errore di
 * battitura e il primo che passa lo "aggiusta" in `[]` - che non funziona.
 */
const SVUOTA = [""];

/** Lo stesso, per il principale: la stringa vuota lo toglie, `null` no. */
const NESSUN_PRINCIPALE = "";

export type Utente = {
  userId: string;
  nome: string;
  email: string;
  ruolo: string | null;
  teamPrincipale: string | null;
  sottoTeam: string[];
};

export type TeamNoto = { id: string; nome: string; principale: boolean };

async function hubspot<T>(
  token: string,
  url: string,
  init?: { method: string; body: unknown }
): Promise<{ ok: true; dati: T } | { ok: false; stato: number; messaggio: string }> {
  const r = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    ...(init?.body ? { body: JSON.stringify(init.body) } : {})
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, stato: r.status, messaggio: t.slice(0, 300) };
  }
  const testo = await r.text();
  return { ok: true, dati: (testo ? JSON.parse(testo) : {}) as T };
}

/** Tutti i team del portale, con il nome e se sono principali. */
export async function teamNoti(token: string): Promise<TeamNoto[]> {
  const r = await hubspot<{ results?: Array<{ id: string; name: string }> }>(
    token,
    `${HUBSPOT}/settings/v3/users/teams`
  );
  if (!r.ok) throw new Error(`team non leggibili: HubSpot ${r.stato}`);
  return (r.dati.results ?? []).map((t) => ({
    id: String(t.id),
    nome: t.name,
    principale: PRINCIPALI.has(String(t.id))
  }));
}

/**
 * Un utente con i suoi team.
 *
 * SI LEGGE L'UTENTE SINGOLO e non l'elenco: la chiamata in blocco restituisce
 * solo id, email, nome e ruoli - i team ci sono solo qui.
 */
export async function leggiUtente(token: string, userId: string): Promise<Utente> {
  const r = await hubspot<{
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    roleId?: string;
    primaryTeamId?: string;
    secondaryTeamIds?: string[];
  }>(token, `${HUBSPOT}/settings/v3/users/${encodeURIComponent(userId)}`);
  if (!r.ok) throw new Error(`utente ${userId} non leggibile: HubSpot ${r.stato} ${r.messaggio}`);
  const u = r.dati;
  return {
    userId: String(u.id),
    nome: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
    email: u.email ?? "",
    ruolo: u.roleId ?? null,
    teamPrincipale: u.primaryTeamId ?? null,
    sottoTeam: (u.secondaryTeamIds ?? []).map(String)
  };
}

export type Movimento = {
  genere: "principale" | "secondario";
  azione: "aggiunto" | "tolto";
  teamId: string;
  teamNome: string | null;
};

export type Esito = {
  utente: Utente;
  movimenti: Movimento[];
  cambiato: boolean;
};

function uguali(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Scrive i sotto-team, svuotando prima.
 *
 * IL `roleId` VA RIMANDATO SU ENTRAMBE LE CHIAMATE: c'e' una segnalazione
 * secondo cui un aggiornamento che non lo include cancella il ruolo
 * dell'utente, cioe' i suoi permessi. Verificato che rimandandolo resta.
 */
async function scriviSottoTeam(token: string, userId: string, elenco: string[], ruolo: string | null) {
  const url = `${HUBSPOT}/settings/v3/users/${encodeURIComponent(userId)}`;
  const base = ruolo ? { roleId: ruolo } : {};

  const a = await hubspot(token, url, { method: "PUT", body: { ...base, secondaryTeamIds: SVUOTA } });
  if (!a.ok) throw new Error(`svuotamento dei sotto-team rifiutato (${a.stato}): ${a.messaggio}`);

  if (!elenco.length) return;

  const b = await hubspot(token, url, { method: "PUT", body: { ...base, secondaryTeamIds: elenco } });
  if (!b.ok) throw new Error(`riscrittura dei sotto-team rifiutata (${b.stato}): ${b.messaggio}`);
}

async function scriviPrincipale(token: string, userId: string, teamId: string | null, ruolo: string | null) {
  const base = ruolo ? { roleId: ruolo } : {};
  const r = await hubspot(token, `${HUBSPOT}/settings/v3/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: { ...base, primaryTeamId: teamId ?? NESSUN_PRINCIPALE }
  });
  if (!r.ok) throw new Error(`cambio del team principale rifiutato (${r.stato}): ${r.messaggio}`);
}

/**
 * Porta una persona al team principale e al sotto-team voluti.
 *
 * UN SOLO SOTTO-TEAM ALLA VOLTA, perche' e' cosi' che li usa l'azienda:
 * sceglierne uno sostituisce quello di prima, senza che nessuno debba
 * ricordarsi di togliere il vecchio. `sottoTeam: null` lo lascia senza.
 *
 * CAMBIANDO IL PRINCIPALE, UN SOTTO-TEAM CHE NON GLI APPARTIENE CADE: Programmi
 * su un Setter sarebbe una combinazione che la regola non prevede, e lasciarla
 * li' vorrebbe dire che la finestra mostra uno stato che non puo' nemmeno
 * essere ricreato scegliendolo.
 *
 * SI RILEGGE PER CONFERMA invece di fidarsi del 200: e' esattamente cosi' che
 * si e' scoperto che la scrittura documentata non toglieva niente.
 */
export async function impostaTeam(
  token: string,
  userId: string,
  voluto: { principale?: string | null; sottoTeam?: string | null }
): Promise<Esito> {
  const team = await teamNoti(token);
  const nomi = new Map(team.map((t) => [t.id, t.nome]));

  const utente = await leggiUtente(token, userId);

  const principaleVoluto =
    voluto.principale === undefined ? utente.teamPrincipale : voluto.principale || null;
  if (principaleVoluto && !PRINCIPALI.has(principaleVoluto)) {
    throw new Error(`${nomi.get(principaleVoluto) ?? principaleVoluto} non e' un team principale`);
  }

  const ammessi = principaleVoluto ? SOTTO_PER_PRINCIPALE[principaleVoluto] ?? [] : [];
  let sottoVoluto = voluto.sottoTeam === undefined ? utente.sottoTeam[0] ?? null : voluto.sottoTeam || null;
  if (sottoVoluto && !ammessi.includes(sottoVoluto)) {
    // Se il sotto-team e' stato chiesto esplicitamente e' un errore da dire; se
    // invece sta cadendo perche' e' cambiato il principale, cade in silenzio.
    if (voluto.sottoTeam !== undefined) {
      throw new Error(
        `${nomi.get(sottoVoluto) ?? sottoVoluto} non appartiene a ` +
          `${nomi.get(principaleVoluto ?? "") ?? "questo team principale"}`
      );
    }
    sottoVoluto = null;
  }

  const sottoFinale = sottoVoluto ? [sottoVoluto] : [];
  const cambiaPrincipale = principaleVoluto !== utente.teamPrincipale;
  const cambiaSotto = !uguali(utente.sottoTeam, sottoFinale);

  if (!cambiaPrincipale && !cambiaSotto) {
    // Niente da fare: non si scrive e non si annota, cosi' lo storico resta un
    // elenco di cambiamenti veri e non di clic.
    return { utente, movimenti: [], cambiato: false };
  }

  // I SOTTO-TEAM PRIMA DEL PRINCIPALE. Se si cambiasse prima il principale, per
  // un istante la persona avrebbe un sotto-team che non gli spetta, e quello e'
  // l'istante in cui un flusso potrebbe leggerla.
  if (cambiaSotto) {
    try {
      await scriviSottoTeam(token, userId, sottoFinale, utente.ruolo);
    } catch (e) {
      // Fra svuotamento e riscrittura la persona resta un istante senza
      // sotto-team: se la seconda fallisce, si prova a rimettere com'era.
      let recupero = "";
      try {
        if (utente.sottoTeam.length) await scriviSottoTeam(token, userId, utente.sottoTeam, utente.ruolo);
        recupero = " I sotto-team di partenza sono stati rimessi.";
      } catch {
        recupero =
          ` ATTENZIONE: ${utente.nome} potrebbe essere rimasto senza i sotto-team ` +
          `${utente.sottoTeam.map((t) => nomi.get(t) ?? t).join(", ")} - da controllare subito sul portale.`;
      }
      throw new Error(`${e instanceof Error ? e.message : String(e)}.${recupero}`);
    }
  }

  if (cambiaPrincipale) await scriviPrincipale(token, userId, principaleVoluto, utente.ruolo);

  const dopo = await leggiUtente(token, userId);

  // IL CONTROLLO CHE CONTA: un 200 qui dentro non vuol dire che sia cambiato
  // qualcosa. Se il risultato non e' quello voluto si dice, invece di scrivere
  // righe di storia che raccontano una cosa mai avvenuta.
  if (dopo.teamPrincipale !== principaleVoluto || !uguali(dopo.sottoTeam, sottoFinale)) {
    throw new Error(
      `HubSpot ha risposto ok ma ${utente.nome} risulta ` +
        `${nomi.get(dopo.teamPrincipale ?? "") ?? "senza principale"}` +
        `${dopo.sottoTeam.length ? " / " + dopo.sottoTeam.map((t) => nomi.get(t) ?? t).join(", ") : ""}` +
        ` invece di ${nomi.get(principaleVoluto ?? "") ?? "senza principale"}` +
        `${sottoFinale.length ? " / " + nomi.get(sottoFinale[0]) : ""}: non registrato`
    );
  }

  if (utente.ruolo && !dopo.ruolo) {
    throw new Error(
      `ATTENZIONE: i team di ${utente.nome} sono stati cambiati ma ha perso il ruolo ` +
        `${utente.ruolo}, cioe' i suoi permessi. Da rimettere a mano dal portale.`
    );
  }

  // UNO SPOSTAMENTO SONO DUE EVENTI, non uno: "tolto da A" e "aggiunto a B".
  // Letto come stato basterebbe una riga sola, ma qui servono gli eventi con la
  // loro data, perche' e' con quelli che si ricostruisce un mese passato.
  const movimenti: Movimento[] = [];
  const segna = (genere: Movimento["genere"], azione: Movimento["azione"], teamId: string | null) => {
    if (!teamId) return;
    movimenti.push({ genere, azione, teamId, teamNome: nomi.get(teamId) ?? null });
  };
  if (cambiaPrincipale) {
    segna("principale", "tolto", utente.teamPrincipale);
    segna("principale", "aggiunto", principaleVoluto);
  }
  if (cambiaSotto) {
    for (const t of utente.sottoTeam) if (!sottoFinale.includes(t)) segna("secondario", "tolto", t);
    for (const t of sottoFinale) if (!utente.sottoTeam.includes(t)) segna("secondario", "aggiunto", t);
  }

  const db = getDb();
  for (const m of movimenti) {
    await db.query(
      `INSERT INTO utente_team_storia
         (user_id, nome, email, azione, genere, team_id, team_nome, prima, dopo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        utente.userId,
        utente.nome,
        utente.email,
        m.azione,
        m.genere,
        m.teamId,
        m.teamNome,
        [utente.teamPrincipale, ...utente.sottoTeam].filter(Boolean) as string[],
        [dopo.teamPrincipale, ...dopo.sottoTeam].filter(Boolean) as string[]
      ]
    );
  }

  return { utente: dopo, movimenti, cambiato: true };
}

/** Gli ultimi movimenti, per mostrarli accanto alla finestra. */
export async function storiaTeam(userId?: string, limite = 50) {
  const { rows } = await getDb().query<{
    quando: Date;
    nome: string | null;
    azione: string;
    genere: string | null;
    team_nome: string | null;
  }>(
    `SELECT quando, nome, azione, genere, team_nome FROM utente_team_storia
      WHERE ($1::text IS NULL OR user_id = $1)
      ORDER BY quando DESC LIMIT $2`,
    [userId ?? null, limite]
  );
  return rows.map((r) => ({
    quando: new Date(r.quando).toISOString(),
    nome: r.nome,
    azione: r.azione,
    genere: r.genere,
    team: r.team_nome
  }));
}
