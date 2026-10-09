import { ADVISOR_TELEFONICI } from "@/lib/statiLead";

/**
 * Chi sono gli advisor telefonici, chiesto a HubSpot invece che scritto qui.
 *
 * PERCHE'. La stessa informazione viveva in tre posti - questa lista di nomi,
 * i criteri di un workflow HubSpot, e la variabile d'ambiente del bot Slack - e
 * il giorno in cui qualcuno ne aggiunge un quinto senza toccarli tutti, i suoi
 * Appuntamenti e Consulenze mostrano zero. Uno zero che somiglia in tutto a una
 * giornata tranquilla. L'8 ottobre 2026 e' successo davvero: il gruppo e'
 * passato da quattro a otto persone e la Dashboard non lo sapeva.
 *
 * LA FONTE E' IL TEAM "Eventi" SU HUBSPOT, letto da /settings/v3/users/teams.
 * E' l'unico posto dove quell'appartenenza e' dichiarata da chi la decide, e si
 * aggiorna da se': quando una persona entra nel team, i suoi contatti portano
 * Eventi entro pochi minuti senza che nessuno tocchi niente.
 *
 * NON SI USA IL FILTRO PER TEAM DENTRO I WORKFLOW, e non per pigrizia: il
 * selettore dei team scrive su `hubspot_team_id`, che contiene solo il team
 * PRIMARIO. Un sotto-team fatto di membri secondari li' dentro non compare, e
 * il filtro seleziona zero contatti senza dare errore - verificato sul portale
 * il 9 ottobre 2026, dopo che il flusso degli Stati Lead era rimasto muto per
 * mezza giornata proprio per questo. L'unica proprieta' esatta e'
 * `hs_owning_teams`, che pero' e' nascosta e nel selettore non si trova.
 */

const HUBSPOT = "https://api.hubapi.com";

/**
 * Il team che dichiara chi lavora al telefono.
 *
 * In una variabile d'ambiente perche' un team si puo' rinominare o ricreare, e
 * in quel caso l'id cambia: meglio poterlo correggere senza un rilascio, visto
 * che il guasto si manifesterebbe come un elenco vuoto.
 */
const TEAM_TELEFONICI = process.env.HUBSPOT_TEAM_TELEFONICI || "192070945";

type Squadra = {
  /** nome -> id proprietario, nella stessa forma che usava la lista scritta a mano. */
  perNome: Map<string, number>;
  /** Da dove viene: serve a dirlo nei registri, non a decidere. */
  fonte: "team" | "riserva";
};

async function chiama<T>(token: string, url: string): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!r.ok) {
      console.error(`[squadra] ${url.split("/").slice(-2).join("/")}: HubSpot ${r.status}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.error("[squadra]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Tutti i proprietari, per tradurre gli id utente del team in id proprietario. */
async function proprietari(token: string) {
  const perUtente = new Map<string, { nome: string; id: number }>();
  const perNome = new Map<string, number>();
  let after: string | undefined;
  do {
    const u = `${HUBSPOT}/crm/v3/owners?limit=100&archived=false${after ? `&after=${after}` : ""}`;
    const d = await chiama<{
      results?: Array<{ id: string; userId?: number; firstName?: string; lastName?: string }>;
      paging?: { next?: { after?: string } };
    }>(token, u);
    if (!d) return null;
    for (const o of d.results ?? []) {
      const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
      if (!nome) continue;
      perNome.set(nome, Number(o.id));
      // L'ELENCO DEL TEAM PORTA ID UTENTE, NON ID PROPRIETARIO: sono numeri
      // diversi per quasi tutti - coincidono solo per chi ha un account
      // vecchio - e confonderli significa non trovare nessuno.
      if (o.userId) perUtente.set(String(o.userId), { nome, id: Number(o.id) });
    }
    after = d.paging?.next?.after;
  } while (after);
  return { perUtente, perNome };
}

/**
 * La squadra, dal team se si riesce e dalla lista scritta a mano se no.
 *
 * LA RISERVA NON E' UN DETTAGLIO. Se la lettura fallisse e restituissimo un
 * elenco vuoto, il giro degli Stati Lead non raccoglierebbe piu' niente e le
 * due colonne andrebbero a zero - cioe' il guasto si travestirebbe da giornata
 * senza appuntamenti, che e' il modo di sbagliare che questo progetto incontra
 * piu' spesso. Meglio continuare con i quattro di sempre e dirlo nel registro.
 */
export async function squadraTelefonici(token: string): Promise<Squadra> {
  const riserva = async (): Promise<Squadra> => {
    const p = await proprietari(token);
    const perNome = new Map<string, number>();
    for (const n of ADVISOR_TELEFONICI) {
      const id = p?.perNome.get(n);
      if (id) perNome.set(n, id);
    }
    if (!perNome.size) {
      throw new Error(
        "non si riesce a stabilire chi sono gli advisor telefonici: " +
          `ne' dal team ${TEAM_TELEFONICI} ne' dalla lista di riserva in src/lib/statiLead.ts`
      );
    }
    return { perNome, fonte: "riserva" };
  };

  const team = await chiama<{
    results?: Array<{ id: string; name: string; userIds?: string[]; secondaryUserIds?: string[] }>;
  }>(token, `${HUBSPOT}/settings/v3/users/teams`);
  if (!team) {
    console.warn("[squadra] team non leggibile, uso la lista di riserva");
    return riserva();
  }

  const t = (team.results ?? []).find((x) => String(x.id) === TEAM_TELEFONICI);
  if (!t) {
    console.warn(`[squadra] il team ${TEAM_TELEFONICI} non esiste piu', uso la lista di riserva`);
    return riserva();
  }

  const p = await proprietari(token);
  if (!p) return riserva();

  // I MEMBRI SONO QUELLI SECONDARI, non i principali: un sotto-team si popola
  // aggiungendo le persone come membri extra, e `userIds` resta vuoto.
  const utenti = [...(t.secondaryUserIds ?? []), ...(t.userIds ?? [])];
  const perNome = new Map<string, number>();
  for (const u of utenti) {
    const o = p.perUtente.get(String(u));
    if (o) perNome.set(o.nome, o.id);
  }

  if (!perNome.size) {
    console.warn(`[squadra] il team "${t.name}" risulta vuoto, uso la lista di riserva`);
    return riserva();
  }

  // Si dice quando la composizione si discosta da quella scritta nel codice:
  // non e' un errore - e' il motivo per cui questa funzione esiste - ma e'
  // bene che resti scritto da qualche parte.
  const nuovi = [...perNome.keys()].filter((n) => !(ADVISOR_TELEFONICI as readonly string[]).includes(n));
  if (nuovi.length) {
    console.info(`[squadra] dal team "${t.name}" arrivano anche: ${nuovi.join(", ")}`);
  }

  return { perNome, fonte: "team" };
}
