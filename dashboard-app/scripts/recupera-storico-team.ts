import { richiedi } from "./env";
import { getDb } from "../src/lib/db";

/**
 * Il passato dei team, ricostruito dalla cronologia dei contatti.
 *
 * IL PROBLEMA. HubSpot non conserva nessuno storico dell'appartenenza ai team:
 * dice chi c'e' adesso, e dopo uno spostamento i mesi passati si rileggono come
 * se quella persona fosse sempre stata nella squadra nuova. Il nostro storico
 * esiste dal 9 ottobre 2026 in avanti; prima di quella data non c'era niente.
 *
 * DOVE IL PASSATO E' RIMASTO. Su ogni contatto, nella proprieta'
 * `hs_owning_teams`: HubSpot la ricalcola su TUTTI i contatti di una persona
 * nello stesso istante in cui la sposti, e ne tiene la cronologia con la data.
 * Risale almeno al 2025.
 *
 * COME SI DISTINGUE UNO SPOSTAMENTO DA UN PASSAGGIO DI MANO. `hs_owning_teams`
 * cambia per due ragioni diverse: la persona ha cambiato squadra, oppure il
 * contatto ha cambiato proprietario. Si guarda `hubspot_owner_id` nello stesso
 * istante: se e' cambiato anche quello, il contatto e' passato di mano e non
 * dice niente sulla squadra di nessuno.
 *
 * E PERCHE' SI GUARDANO PIU' CONTATTI. Uno spostamento vero compare su TUTTI i
 * contatti di quella persona insieme; un passaggio di mano su uno solo.
 * Chiedendone venti e tenendo solo cio' che si vede sulla maggioranza, il
 * rumore sparisce da se'. Misurato il 9 ottobre 2026 su Sabina Noia, spostata
 * quella mattina: 10 contatti su 10.
 *
 * QUESTE RIGHE SONO DEDOTTE, non osservate, e si marcano `fonte =
 * 'ricostruito'`. E' l'unica categoria che puo' sbagliarsi, e chi legge deve
 * poterlo sapere.
 *
 * Si lancia con:  npx tsx scripts/recupera-storico-team.ts [--scrivi]
 * Senza --scrivi non tocca niente e stampa quello che farebbe.
 */

const HUBSPOT = "https://api.hubapi.com";

/** Da quando si guarda indietro. Prima di qui non si cerca. */
const DA = Date.parse("2026-01-01T00:00:00.000Z");

/** Quanti contatti per persona: venti bastano a distinguere il segnale. */
const CAMPIONE = 20;

/**
 * Quanta parte del campione deve mostrare lo stesso cambiamento.
 *
 * Meta' e' prudente: uno spostamento vero si vede su tutti quelli che quella
 * persona possedeva in quel momento, e chi ne possedeva pochi allora entra
 * comunque. Sotto questa soglia restano i passaggi di mano che il controllo
 * sul proprietario non ha gia' tolto.
 */
const SOGLIA = 0.5;

/** I team principali: serve a dire se un movimento e' principale o secondario. */
const PRINCIPALI = new Set(["136290156", "140488894", "145156693", "145157437", "156454541"]);

type Voce = { value: string; timestamp: string };

const intestazioni = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json"
});

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quante chiamate sono andate perse malgrado i tentativi: si dice alla fine. */
let perse = 0;

/**
 * SI RIPROVA, E SE NON CE LA FA SI DICE.
 *
 * Settanta persone in fila fanno due chiamate ciascuna, e il tetto del token e'
 * 19 al secondo condiviso con decine di flussi Zapier: qualcuna torna 429. La
 * prima versione di questo script restituiva null e il chiamante saltava quella
 * persona senza una parola - due esecuzioni davano 60 e 48 movimenti, e Giusy
 * Pucci spariva fra l'una e l'altra. Una ricostruzione del passato che cambia a
 * ogni giro non e' una ricostruzione.
 */
async function chiama<T>(token: string, url: string, corpo?: unknown): Promise<T | null> {
  for (let tentativo = 1; tentativo <= 5; tentativo++) {
    try {
      const r = await fetch(url, {
        method: corpo ? "POST" : "GET",
        headers: intestazioni(token),
        cache: "no-store",
        ...(corpo ? { body: JSON.stringify(corpo) } : {})
      });
      if (r.ok) return (await r.json()) as T;
      if (r.status === 429 || r.status >= 500) {
        await attendi(tentativo * 1000);
        continue;
      }
      console.error(`   HubSpot ${r.status} su ${url.split("/").slice(-2).join("/")}`);
      perse++;
      return null;
    } catch (e) {
      if (tentativo === 5) {
        console.error("   ", e instanceof Error ? e.message : e);
        perse++;
        return null;
      }
      await attendi(tentativo * 1000);
    }
  }
  console.error(`   rinuncio dopo cinque tentativi: ${url.split("/").slice(-2).join("/")}`);
  perse++;
  return null;
}

/** I proprietari attivi, con il loro nome. */
async function proprietari(token: string) {
  const out: Array<{ id: string; nome: string; userId: string }> = [];
  let after: string | undefined;
  do {
    const d = await chiama<{
      results?: Array<{ id: string; userId?: number; firstName?: string; lastName?: string }>;
      paging?: { next?: { after?: string } };
    }>(token, `${HUBSPOT}/crm/v3/owners?limit=100&archived=false${after ? `&after=${after}` : ""}`);
    if (!d) return out;
    for (const o of d.results ?? []) {
      const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
      if (nome && o.userId) out.push({ id: String(o.id), nome, userId: String(o.userId) });
    }
    after = d.paging?.next?.after;
  } while (after);
  return out;
}

/** I contatti piu' vecchi fra quelli che possiede: sono quelli che hanno visto di piu'. */
async function contattiDi(token: string, owner: string) {
  const d = await chiama<{ results?: Array<{ id: string }> }>(
    token,
    `${HUBSPOT}/crm/v3/objects/contacts/search`,
    {
      filterGroups: [{ filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: owner }] }],
      sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
      properties: ["hs_object_id"],
      limit: CAMPIONE
    }
  );
  return (d?.results ?? []).map((x) => x.id);
}

async function cronologie(token: string, ids: string[]) {
  if (!ids.length) return [];
  const d = await chiama<{
    results?: Array<{ id: string; propertiesWithHistory?: Record<string, Voce[]> }>;
  }>(token, `${HUBSPOT}/crm/v3/objects/contacts/batch/read`, {
    inputs: ids.map((id) => ({ id })),
    propertiesWithHistory: ["hs_owning_teams", "hubspot_owner_id"],
    properties: ["hs_object_id"]
  });
  return d?.results ?? [];
}

const insieme = (v: string) =>
  new Set((v ?? "").split(";").map((x) => x.trim()).filter(Boolean));

type Movimento = {
  ownerId: string;
  nome: string;
  quando: Date;
  azione: "aggiunto" | "tolto";
  teamId: string;
  visti: number;
  suQuanti: number;
};

/**
 * I movimenti di una persona, dedotti dai suoi contatti.
 *
 * SI RAGGRUPPA PER GIORNO e non per istante: HubSpot a volte scrive lo stesso
 * spostamento in due passaggi - prima svuota, poi riscrive - e contarli come
 * due eventi darebbe una persona che esce da tutto e poi rientra.
 */
function movimentiDi(
  rec: Array<{ id: string; propertiesWithHistory?: Record<string, Voce[]> }>,
  ownerId: string,
  nome: string
): Movimento[] {
  // giorno -> contatto -> {prima, dopo}
  const perGiorno = new Map<string, Map<string, { prima: Set<string>; dopo: Set<string> }>>();

  for (const c of rec) {
    const team = c.propertiesWithHistory?.hs_owning_teams ?? [];
    const prop = c.propertiesWithHistory?.hubspot_owner_id ?? [];
    const quandoProp = (prop ?? []).map((v) => Date.parse(v.timestamp));

    // La cronologia arriva dal piu' recente al piu' vecchio.
    for (let i = 0; i < team.length - 1; i++) {
      const t = Date.parse(team[i].timestamp);
      if (!Number.isFinite(t) || t < DA) continue;
      // Il contatto ha cambiato padrone in quell'istante: non dice niente
      // sulla squadra di nessuno.
      if (quandoProp.some((x) => Math.abs(x - t) < 120_000)) continue;

      const giorno = new Date(t).toISOString().slice(0, 10);
      if (!perGiorno.has(giorno)) perGiorno.set(giorno, new Map());
      const delGiorno = perGiorno.get(giorno)!;
      const attuale = delGiorno.get(c.id);
      // Dentro lo stesso giorno conta il PRIMO "prima" e l'ULTIMO "dopo":
      // in mezzo ci possono stare i passaggi intermedi di una scrittura sola.
      if (!attuale) delGiorno.set(c.id, { prima: insieme(team[i + 1].value), dopo: insieme(team[i].value) });
      else attuale.prima = insieme(team[i + 1].value);
    }
  }

  const out: Movimento[] = [];
  for (const [giorno, perContatto] of perGiorno) {
    const quanti = perContatto.size;
    const conta = new Map<string, number>();
    for (const { prima, dopo } of perContatto.values()) {
      for (const t of dopo) if (!prima.has(t)) conta.set(`+${t}`, (conta.get(`+${t}`) ?? 0) + 1);
      for (const t of prima) if (!dopo.has(t)) conta.set(`-${t}`, (conta.get(`-${t}`) ?? 0) + 1);
    }
    for (const [k, n] of conta) {
      if (n / rec.length < SOGLIA) continue;
      out.push({
        ownerId,
        nome,
        quando: new Date(`${giorno}T12:00:00.000Z`),
        azione: k[0] === "+" ? "aggiunto" : "tolto",
        teamId: k.slice(1),
        visti: n,
        suQuanti: quanti
      });
    }
  }
  return out.sort((a, b) => a.quando.getTime() - b.quando.getTime());
}

(async () => {
  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  richiedi("DATABASE_URL");
  const scrivi = process.argv.includes("--scrivi");

  const team = await chiama<{ results?: Array<{ id: string; name: string }> }>(
    token,
    `${HUBSPOT}/settings/v3/users/teams`
  );
  const nomiTeam = new Map((team?.results ?? []).map((t) => [String(t.id), t.name]));
  const nomeDi = (id: string) => nomiTeam.get(id) ?? `team ${id} (non esiste piu')`;

  const persone = await proprietari(token);
  console.log(`proprietari attivi: ${persone.length}`);
  console.log(`si guarda indietro fino al ${new Date(DA).toISOString().slice(0, 10)}`);
  console.log("");

  const tutti: Movimento[] = [];
  const senzaContatti: string[] = [];
  for (const p of persone) {
    // Un respiro fra una persona e l'altra: due chiamate a testa su un tetto di
    // 19 al secondo che condividiamo con tutto il resto.
    await attendi(120);
    const ids = await contattiDi(token, p.id);
    if (!ids.length) {
      senzaContatti.push(p.nome);
      continue;
    }
    const rec = await cronologie(token, ids);
    const m = movimentiDi(rec, p.id, p.nome);
    if (!m.length) continue;
    tutti.push(...m);
    console.log(`${p.nome} (${ids.length} contatti)`);
    for (const x of m) {
      console.log(
        `   ${x.quando.toISOString().slice(0, 10)}  ${x.azione === "tolto" ? "−" : "+"} ${nomeDi(x.teamId)}` +
          `   [${x.visti}/${rec.length}]`
      );
    }
  }

  console.log("");
  console.log(`movimenti ricostruiti: ${tutti.length} su ${new Set(tutti.map((x) => x.nome)).size} persone`);
  console.log(`persone senza contatti da guardare: ${senzaContatti.length}`);

  // NON SI SCRIVE UNA RICOSTRUZIONE INCOMPLETA. Se qualche chiamata e' andata
  // persa, mancano i movimenti di qualcuno e non si sa di chi: scriverla
  // vorrebbe dire credere per sempre a un passato con dei buchi.
  if (perse) {
    console.log("");
    console.log(`ATTENZIONE: ${perse} chiamate perse. La ricostruzione e' incompleta e NON viene scritta.`);
    console.log("Rilancialo: ritenta da solo sui 429, quindi di solito al secondo giro passa.");
    return;
  }

  if (!scrivi) {
    console.log("(sola lettura. Per scrivere: --scrivi)");
    return;
  }

  const db = getDb();
  // SI RISCRIVE SOLO CIO' CHE E' RICOSTRUITO, mai quello che e' stato osservato
  // o fatto da noi: lanciarlo due volte non deve raddoppiare niente ne' toccare
  // le righe vere.
  const { rowCount: tolte } = await db.query(
    `DELETE FROM utente_team_storia WHERE fonte = 'ricostruito'`
  );
  console.log(`righe ricostruite precedenti rimosse: ${tolte}`);

  let scritte = 0;
  for (const x of tutti) {
    await db.query(
      `INSERT INTO utente_team_storia
         (quando, user_id, nome, email, azione, genere, team_id, team_nome, prima, dopo, fonte, prove)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, NULL, NULL, 'ricostruito', $8)`,
      [
        x.quando.toISOString(),
        x.ownerId,
        x.nome,
        x.azione,
        PRINCIPALI.has(x.teamId) ? "principale" : "secondario",
        x.teamId,
        nomiTeam.get(x.teamId) ?? null,
        `${x.visti}/${x.suQuanti}`
      ]
    );
    scritte++;
  }
  console.log(`righe scritte: ${scritte}`);
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERRORE:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
