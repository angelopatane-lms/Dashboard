import { getDb } from "@/lib/db";

/**
 * Lo storico dei team, ottenuto guardando invece che scrivendo.
 *
 * IL PROBLEMA. HubSpot dice chi sta in quale team adesso, e nient'altro: non
 * c'e' nessuno storico dell'appartenenza. Quando una persona passa dai Setter
 * agli Advisor a meta' mese, i giorni precedenti si rileggono come se ci fosse
 * sempre stata, e il suo lavoro finisce attribuito alla squadra sbagliata. E'
 * la stessa forma del guasto di `hubspot_owner_assigneddate`, che tiene solo
 * l'ultima assegnazione e ci ha impedito di ricostruire i giorni passati.
 *
 * PERCHE' NON SCRIVENDO. Il 9 ottobre 2026 si e' misurato che togliere una
 * persona da un sotto-team via API non si puo' - vedi `TOGLIERE_NON_SI_PUO` in
 * ./team.ts - quindi i cambi si faranno sempre dal portale. Uno storico
 * alimentato dalle nostre scritture vedrebbe solo gli ingressi fatti da noi:
 * sarebbe incompleto da un lato solo, cioe' il modo peggiore, perche'
 * sembrerebbe completo. Osservare vede tutto, compreso quello fatto a mano.
 *
 * COSA PROTEGGE QUESTA FUNZIONE. Che una lettura andata male si traduca in una
 * fila di uscite: se HubSpot risponde male, o risponde con zero team, non si
 * annota niente e non si aggiorna la fotografia. Senza questo controllo un
 * minuto di 503 scriverebbe "tolto" per tutti e poi "aggiunto" per tutti al
 * giro dopo, e lo storico - che e' l'unica copia di quell'informazione -
 * resterebbe sporco per sempre.
 */

const HUBSPOT = "https://api.hubapi.com";

type Appartenenza = {
  userId: string;
  teamId: string;
  genere: "principale" | "secondario";
  nome: string | null;
  email: string | null;
  teamNome: string | null;
};

export type Osservazione = {
  /** Quante appartenenze risultano adesso su HubSpot. */
  adesso: number;
  ingressi: Array<{ nome: string | null; team: string | null; genere: string }>;
  uscite: Array<{ nome: string | null; team: string | null; genere: string }>;
  /** La prima volta la fotografia si posa senza annotare niente. */
  primaVolta: boolean;
  /** Perche' non si e' fatto niente, quando non si e' fatto niente. */
  fermo?: string;
};

async function chiama<T>(token: string, url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!r.ok) {
      console.error(`[team] ${url.split("/").slice(-2).join("/")}: HubSpot ${r.status}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.error("[team]", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Chi ha un account ancora attivo, ed e' una persona.
 *
 * IL PORTALE CONTIENE 508 UTENTI, LE PERSONE ATTIVE SONO 68. Gli altri sono
 * account disattivati, che restano elencati per sempre portandosi dietro i team
 * che avevano. Senza toglierli, ventun persone comparivano due volte - Nora
 * D'Ascanio con l'indirizzo aziendale e con il gmail, e i team solo sul primo -
 * e una modifica fatta cercando per nome poteva finire su quello spento, dove
 * non cambia niente per nessuno.
 *
 * DUE CONDIZIONI, ED ENTRAMBE DICHIARATE. `hs_deactivated` sull'oggetto CRM
 * `users` dice se l'account e' spento. Non basta: dei 84 che risultano attivi,
 * SEDICI sono account di servizio delle integrazioni - indirizzi
 * @appserviceaccount - e uno di loro sta perfino nel team Advisor, quindi
 * comparirebbe in tabella come se fosse un advisor. Si tolgono con
 * `hs_is_app_service_account` e i suoi due fratelli.
 *
 * SI ERA PROVATO A DEDURLO dalla presenza di un record proprietario: dava gli
 * stessi 68, ma per la ragione sbagliata - gli account di servizio un record
 * proprietario non ce l'hanno. Due segnali che coincidono per caso si
 * separano il giorno in cui uno dei due cambia, e nessuno se ne accorge.
 *
 * NULL SE NON SI RIESCE A LEGGERLI, e chi chiama non filtra: un elenco vuoto
 * qui cancellerebbe tutte le appartenenze in un colpo solo, e il giro dopo le
 * riscriverebbe come ingressi. Lo storico e' l'unica copia di
 * quell'informazione e non deve riempirsi di movimenti mai avvenuti.
 */
async function attivi(token: string): Promise<Set<string> | null> {
  const vero = (v: unknown) => v === "true" || v === true;
  const persone = new Set<string>();
  let after: string | undefined;
  do {
    const d = await chiamaPost<{
      results?: Array<{ properties?: Record<string, string> }>;
      paging?: { next?: { after?: string } };
    }>(token, `${HUBSPOT}/crm/v3/objects/users/search`, {
      filterGroups: [{ filters: [{ propertyName: "hs_deactivated", operator: "EQ", value: "false" }] }],
      properties: [
        "hs_internal_user_id",
        "hs_is_app_service_account",
        "hs_is_bot",
        "hs_is_hubspot_generated_app_service_account"
      ],
      limit: 100,
      ...(after ? { after } : {})
    });
    if (!d) return null;
    for (const r of d.results ?? []) {
      const p = r.properties ?? {};
      if (!p.hs_internal_user_id) continue;
      if (vero(p.hs_is_app_service_account) || vero(p.hs_is_bot) || vero(p.hs_is_hubspot_generated_app_service_account)) continue;
      persone.add(String(p.hs_internal_user_id));
    }
    after = d.paging?.next?.after;
  } while (after);
  return persone.size ? persone : null;
}

async function chiamaPost<T>(token: string, url: string, corpo: unknown): Promise<T | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(corpo)
    });
    if (!r.ok) {
      console.error(`[team] ${url.split("/").slice(-2).join("/")}: HubSpot ${r.status}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.error("[team]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Nome ed email di ogni utente, per non tenere nello storico solo dei numeri. */
async function anagrafica(token: string) {
  const per = new Map<string, { nome: string | null; email: string | null }>();
  let after: string | undefined;
  do {
    const d = await chiama<{
      results?: Array<{ id: string; email?: string; firstName?: string; lastName?: string }>;
      paging?: { next?: { after?: string } };
    }>(token, `${HUBSPOT}/settings/v3/users?limit=100${after ? `&after=${after}` : ""}`);
    if (!d) return null;
    for (const u of d.results ?? []) {
      const nome = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
      per.set(String(u.id), { nome: nome || null, email: u.email ?? null });
    }
    after = d.paging?.next?.after;
  } while (after);
  return per;
}

/**
 * Guarda com'e' adesso, annota le differenze, rimette la fotografia.
 *
 * TUTTO IN UNA TRANSAZIONE: annotare gli eventi e aggiornare la fotografia
 * sono lo stesso gesto. Separarli vorrebbe dire che un errore nel mezzo
 * lascerebbe la fotografia nuova senza gli eventi che la spiegano, e quei
 * cambiamenti sparirebbero senza che nessuno possa accorgersene.
 */
/**
 * @param annota false aggiorna la fotografia SENZA scrivere eventi.
 *
 * SERVE DOPO UNA MODIFICA FATTA DA NOI. La fotografia va rimessa in pari
 * subito, o il giro dopo rivedrebbe quel cambiamento come nuovo; ma gli eventi
 * li ha gia' scritti chi ha fatto la modifica, con i dettagli che qui non ci
 * sono. Senza questo, lo spostamento di Sabina Noia e' finito nello storico due
 * volte, e uno storico che conta le scritture invece dei movimenti non serve
 * piu' a ricostruire niente.
 */
export async function osservaTeam(token: string, scrivi = true, annota = true): Promise<Osservazione> {
  const vuoto: Osservazione = { adesso: 0, ingressi: [], uscite: [], primaVolta: false };

  const team = await chiama<{
    results?: Array<{ id: string; name: string; userIds?: string[]; secondaryUserIds?: string[] }>;
  }>(token, `${HUBSPOT}/settings/v3/users/teams`);
  if (!team) return { ...vuoto, fermo: "i team non si sono potuti leggere" };

  const squadre = team.results ?? [];
  // ZERO TEAM NON E' UNA RISPOSTA CREDIBILE: il portale ne ha sempre almeno
  // uno. Se arriva zero, qualcosa non ha funzionato e il silenzio somiglia a
  // un'azienda senza squadre.
  if (!squadre.length) return { ...vuoto, fermo: "HubSpot ha risposto senza nessun team" };

  const chi = await anagrafica(token);
  if (!chi) return { ...vuoto, fermo: "l'elenco degli utenti non si e' potuto leggere" };

  const vivi = await attivi(token);
  if (!vivi) console.warn("[team] proprietari non letti: non si escludono gli account disattivati");

  const adesso = new Map<string, Appartenenza>();
  for (const s of squadre) {
    const teamId = String(s.id);
    const metti = (userId: string, genere: "principale" | "secondario") => {
      // Gli account disattivati restano nei team per sempre: si saltano, o la
      // stessa persona comparirebbe due volte con team diversi.
      if (vivi && !vivi.has(String(userId))) return;
      const u = chi.get(String(userId));
      adesso.set(`${userId}|${teamId}|${genere}`, {
        userId: String(userId),
        teamId,
        genere,
        nome: u?.nome ?? null,
        email: u?.email ?? null,
        teamNome: s.name ?? null
      });
    };
    for (const u of s.userIds ?? []) metti(String(u), "principale");
    for (const u of s.secondaryUserIds ?? []) metti(String(u), "secondario");
  }

  if (!adesso.size) return { ...vuoto, fermo: "nessuna appartenenza nei team letti" };

  const db = getDb();
  const { rows: prima } = await db.query<{
    user_id: string;
    team_id: string;
    genere: string;
    nome: string | null;
    team_nome: string | null;
  }>(`SELECT user_id, team_id, genere, nome, team_nome FROM utente_team_adesso`);

  const primaChiavi = new Map(prima.map((r) => [`${r.user_id}|${r.team_id}|${r.genere}`, r]));
  const primaVolta = prima.length === 0;

  const ingressi = [...adesso.entries()].filter(([k]) => !primaChiavi.has(k)).map(([, v]) => v);
  const uscite = [...primaChiavi.entries()]
    .filter(([k]) => !adesso.has(k))
    .map(([, r]) => ({
      userId: r.user_id,
      teamId: r.team_id,
      genere: r.genere as "principale" | "secondario",
      nome: r.nome,
      email: null,
      teamNome: r.team_nome
    }));

  const esito: Osservazione = {
    adesso: adesso.size,
    // LA PRIMA VOLTA NON SI ANNOTA NIENTE: non sappiamo da quando queste
    // persone sono nei loro team, e scrivere oggi come data d'ingresso di
    // tutti sarebbe inventare una storia che non e' avvenuta.
    ingressi: primaVolta
      ? []
      : ingressi.map((v) => ({ nome: v.nome, team: v.teamNome, genere: v.genere })),
    uscite: primaVolta ? [] : uscite.map((v) => ({ nome: v.nome, team: v.teamNome, genere: v.genere })),
    primaVolta
  };

  if (!scrivi) return esito;

  const c = await db.connect();
  try {
    await c.query("BEGIN");

    if (!primaVolta && annota) {
      for (const [azione, elenco] of [
        ["aggiunto", ingressi],
        ["tolto", uscite]
      ] as const) {
        for (const v of elenco) {
          await c.query(
            `INSERT INTO utente_team_storia
               (user_id, nome, email, azione, genere, team_id, team_nome, prima, dopo, fonte)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, 'osservato')`,
            [v.userId, v.nome, v.email, azione, v.genere, v.teamId, v.teamNome]
          );
        }
      }
    }

    // La fotografia si rifa' intera invece di aggiornarla pezzo per pezzo: e'
    // la forma che non puo' divergere da quello che si e' appena letto.
    //
    // IN UN'UNICA ISTRUZIONE, non una riga per volta: sono centotrenta e passa
    // appartenenze, e un viaggio fino a Neon per ciascuna faceva aspettare
    // undici secondi chi apriva la finestra. Messe tutte insieme, uno solo.
    await c.query("DELETE FROM utente_team_adesso");
    const righe = [...adesso.values()];
    if (righe.length) {
      const valori: unknown[] = [];
      const segnaposti = righe.map((v, i) => {
        valori.push(v.userId, v.teamId, v.genere, v.nome, v.email, v.teamNome);
        const b = i * 6;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
      });
      await c.query(
        `INSERT INTO utente_team_adesso (user_id, team_id, genere, nome, email, team_nome)
         VALUES ${segnaposti.join(", ")}`,
        valori
      );
    }

    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }

  return esito;
}
