import { getDb } from "@/lib/db";
import { STATI_RILEVANTI } from "@/lib/statiLead";
import { squadraTelefonici } from "@/lib/statiLead/squadra";

/**
 * Porta in banca dati la cronologia degli Stati Lead dei quattro advisor che
 * lavorano solo al telefono.
 *
 * STA QUI E NON NELLO SCRIPT perche' ha due chiamanti - il giro notturno e il
 * comando a mano - e una copia sola e' la ragione per cui i due non possono
 * dare risultati diversi sullo stesso periodo. E' lo stesso motivo per cui
 * `trascrizioni/sync.ts` sta in lib e non in scripts.
 *
 * Il perche' di tutto il resto - cosa si conta e con quali trappole - sta in
 * src/lib/statiLead.ts e nel commento della tabella stato_lead_storia.
 */

const HUBSPOT = "https://api.hubapi.com";
const RILEVANTI = new Set<string>(STATI_RILEVANTI);
const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Da quando esiste la cronologia caricata: prima di questa data non sappiamo
 * niente, e un contatto gia' visto nel 2025 risulterebbe nuovo.
 */
const ORIGINE = "2026-01-01T00:00:00.000Z";

type Voce = { value: string; timestamp: string };

export type EsitoStatiLead = {
  advisor: Array<{ nome: string; contatti: number; ingressi: number }>;
  ingressi: number;
  da: string;
};

async function hubspot<T>(token: string, url: string, body?: unknown): Promise<T> {
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (res.status === 429) {
      await attesa(1000 * (tentativo + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} su ${url}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
  throw new Error(`HubSpot continua a rispondere 429 su ${url}`);
}

/**
 * Chi sono gli advisor telefonici, e con quale id.
 *
 * LA FONTE E' IL TEAM SU HUBSPOT, non piu' un elenco di nomi scritto qui: la
 * stessa informazione viveva in tre posti e il giorno in cui ne entra uno nuovo
 * senza aggiornarli tutti, le sue colonne mostrano zero. Dettagli e rete di
 * sicurezza in squadra.ts.
 */
async function proprietariTelefonici(token: string): Promise<Map<string, number>> {
  const s = await squadraTelefonici(token);
  if (s.fonte === "riserva") {
    console.warn("[stati-lead] squadra dalla lista di riserva: il team non si e' potuto leggere");
  }
  return s.perNome;
}

/** Gli id dei contatti di quel proprietario toccati dalla data in poi. */
async function contattiDi(token: string, proprietario: number, da: Date): Promise<string[]> {
  const out: string[] = [];
  let after: string | undefined;
  do {
    const body = {
      filterGroups: [
        {
          filters: [
            { propertyName: "hubspot_owner_id", operator: "EQ", value: String(proprietario) },
            // NOTA: per i contatti la proprieta' e' `lastmodifieddate`.
            // `hs_lastmodifieddate` esiste per altri oggetti e qui HubSpot non
            // da' errore: restituisce zero risultati, che si legge come "non ha
            // lavorato".
            { propertyName: "lastmodifieddate", operator: "GTE", value: da.toISOString() }
          ]
        }
      ],
      // Nessun limite superiore sulla data: un contatto il cui stato e'
      // cambiato dentro il periodo ma che e' stato ritoccato dopo sarebbe
      // altrimenti escluso. A filtrare davvero e' la data delle voci di
      // cronologia, piu' avanti.
      properties: ["hs_object_id"],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      limit: 100,
      ...(after ? { after } : {})
    };
    const d = await hubspot<{ results?: Array<{ id: string }>; paging?: { next?: { after?: string } } }>(
      token,
      `${HUBSPOT}/crm/v3/objects/contacts/search`,
      body
    );
    for (const r of d.results ?? []) out.push(r.id);
    after = d.paging?.next?.after;
    await attesa(220);
  } while (after);
  return out;
}

/**
 * Chi aveva il contatto in un certo istante, dalla cronologia del proprietario.
 *
 * Le voci arrivano dalla piu' recente: si scende finche' non se ne trova una
 * non successiva all'istante cercato. Null quando la cronologia non arriva
 * cosi' indietro - succede sui contatti vecchi, e li' e' meglio non attribuire
 * che attribuire a caso.
 */
function valoreA(storia: Voce[], istante: number): string | null {
  for (const v of storia) {
    const t = Date.parse(v.timestamp);
    if (Number.isFinite(t) && t <= istante) {
      const x = (v.value ?? "").trim();
      return x || null;
    }
  }
  return null;
}

function proprietarioA(storia: Voce[], istante: number): number | null {
  const x = valoreA(storia, istante);
  const id = Number(x);
  return x && Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Da dove ripartire quando non lo si dice: il checkpoint meno un margine.
 *
 * IL MARGINE SERVE a coprire la corsa fra le due letture - il giro precedente
 * puo' aver letto un contatto un istante prima che qualcuno lo cambiasse - e
 * il ritardo con cui HubSpot aggiorna lastmodifieddate. Sono secondi, al
 * massimo minuti: due ore sono gia' abbondanti.
 *
 * ERA UN GIORNO, ed era tarato su un giro notturno solo. Dal 6 ottobre 2026 il
 * giro si ripete ogni ora, perche' Appuntamenti e Consulenze dei quattro
 * advisor telefonici si ricostruiscono da qui e restavano fermi a ieri per
 * tutta la giornata: alle 21:00 la tabella diceva ancora zero su chi aveva
 * lavorato. Con il margine di un giorno, ripetere ogni ora avrebbe voluto dire
 * rileggere ventiquattro volte la stessa finestra.
 *
 * Il recupero di un buco non passa di qui: si chiede con ?da=AAAA-MM-GG, che
 * scavalca questa funzione.
 */
const MARGINE_ORE = 2;

export async function daDoveRipartire(margineOre = MARGINE_ORE): Promise<Date> {
  const db = getDb();
  const { rows } = await db.query<{ aggiornato_at: Date }>(
    `SELECT aggiornato_at FROM sync_checkpoint WHERE tipo = 'stati-lead'`
  );
  return rows[0]
    ? new Date(rows[0].aggiornato_at.getTime() - margineOre * 3600_000)
    : new Date(ORIGINE);
}

/** Una riga di stato_lead_storia prima di essere scritta. */
type Riga = [number, string, string, number | null, string | null];

/**
 * Le voci di cronologia di un blocco di contatti, filtrate e datate.
 *
 * CINQUANTA PER VOLTA, non cento: con propertiesWithHistory HubSpot rifiuta i
 * blocchi piu' grandi ("maximum number of inputs supported in a batch request
 * for property histories is 50"), mentre senza cronologia ne accetta cento.
 *
 * STA FUORI DAL CICLO perche' ha due chiamanti: il giro completo e
 * aggiornaUnContatto(), che serve al webhook. Una copia per ciascuno sarebbe
 * divergita alla prima modifica a uno dei filtri, e la differenza si sarebbe
 * vista solo come numeri diversi fra chi aggiorna in diretta e chi recupera.
 */
async function righeDaContatti(token: string, ids: string[], da: Date): Promise<Riga[]> {
  if (!ids.length) return [];
  const d = await hubspot<{
    results?: Array<{ id: string; propertiesWithHistory?: Record<string, Voce[]> }>;
  }>(token, `${HUBSPOT}/crm/v3/objects/contacts/batch/read`, {
    // La campagna costa zero chiamate in piu': e' una proprieta' nella stessa
    // richiesta che gia' facevamo per stato e proprietario.
    propertiesWithHistory: ["hs_lead_status", "hubspot_owner_id", "id_campagna_refresh"],
    properties: ["hs_object_id"],
    inputs: ids.map((x) => ({ id: x }))
  });

  const valori: Riga[] = [];
  for (const c of d.results ?? []) {
    const stati = c.propertiesWithHistory?.hs_lead_status ?? [];
    const storiaProprietari = c.propertiesWithHistory?.hubspot_owner_id ?? [];
    const storiaCampagne = c.propertiesWithHistory?.id_campagna_refresh ?? [];
    for (const v of stati) {
      const stato = (v.value ?? "").trim();
      // Le voci vuote esistono davvero: un flusso che azzera la proprieta'.
      if (!stato || !RILEVANTI.has(stato)) continue;
      const t = Date.parse(v.timestamp);
      if (!Number.isFinite(t) || t < da.getTime()) continue;
      valori.push([
        Number(c.id),
        new Date(t).toISOString(),
        stato,
        proprietarioA(storiaProprietari, t),
        valoreA(storiaCampagne, t)
      ]);
    }
  }
  return valori;
}

/**
 * Scrive le righe, in aggiornamento e non in solo inserimento: lo stesso
 * istante puo' arrivare due volte - prima dal webhook, poi dal giro di
 * recupero - e la seconda volta non deve ne' fallire ne' duplicare.
 */
async function scriviRighe(valori: Riga[]): Promise<void> {
  if (!valori.length) return;
  await getDb().query(
    `INSERT INTO stato_lead_storia (contatto_id, ts, stato, proprietario_id, campagna)
     SELECT * FROM UNNEST($1::bigint[], $2::timestamptz[], $3::text[], $4::bigint[], $5::text[])
     ON CONFLICT (contatto_id, ts) DO UPDATE
       SET stato = EXCLUDED.stato, proprietario_id = EXCLUDED.proprietario_id,
           campagna = EXCLUDED.campagna`,
    [
      valori.map((x) => x[0]),
      valori.map((x) => x[1]),
      valori.map((x) => x[2]),
      valori.map((x) => x[3]),
      valori.map((x) => x[4])
    ]
  );
}

/**
 * Un contatto solo, riletto per intero. E' quello che chiama il webhook.
 *
 * NON SI FIDA DELL'EVENTO, E RILEGGE. Il payload di un workflow dice che una
 * proprieta' e' cambiata, non se quel cambio vale come appuntamento: la regola
 * vera - conta il PRIMO appuntamento di ogni coppia advisor-contatto - si
 * decide sulla cronologia intera, e un endpoint che scrivesse l'istante
 * ricevuto conterebbe due volte chi viene ripreso un mese dopo. Stesse
 * funzioni e stesso SQL del giro completo, un solo contatto in ingresso: e' la
 * scelta che fa gia' il webhook delle trattative, per lo stesso motivo.
 *
 * DALL'ORIGINE e non dall'ultimo giro: per un contatto solo la chiamata costa
 * uguale, e chiude per sempre i buchi di quel contatto invece di rimediare
 * all'ultima finestra. La scrittura e' in aggiornamento, quindi rileggere
 * cronologia gia' nota non fa danni.
 */
export async function aggiornaUnContatto(
  token: string,
  contattoId: string
): Promise<{ contattoId: string; righe: number }> {
  const valori = await righeDaContatti(token, [contattoId], new Date(ORIGINE));
  await scriviRighe(valori);
  return { contattoId, righe: valori.length };
}

export async function sincronizzaStatiLead(opzioni: {
  token: string;
  da: Date;
  scrivi: boolean;
}): Promise<EsitoStatiLead> {
  const { token, da, scrivi } = opzioni;
  const db = getDb();
  const iniziato = new Date();
  const proprietari = await proprietariTelefonici(token);
  const advisor: EsitoStatiLead["advisor"] = [];
  let ingressiTotali = 0;

  for (const [nome, id] of proprietari) {
    const contatti = await contattiDi(token, id, da);
    let ingressi = 0;

    // CINQUANTA, non cento: con propertiesWithHistory HubSpot rifiuta i blocchi
    // piu' grandi ("maximum number of inputs supported in a batch request for
    // property histories is 50"), mentre senza cronologia ne accetta cento.
    for (let i = 0; i < contatti.length; i += 50) {
      const valori = await righeDaContatti(token, contatti.slice(i, i + 50), da);
      if (scrivi) await scriviRighe(valori);
      ingressi += valori.length;
      await attesa(220);
    }

    advisor.push({ nome, contatti: contatti.length, ingressi });
    ingressiTotali += ingressi;
  }

  if (scrivi) {
    await db.query(
      `INSERT INTO sync_checkpoint (tipo, ultimo_id, contatti, eventi, aggiornato_at)
       VALUES ('stati-lead', 0, 0, $1, $2)
       ON CONFLICT (tipo) DO UPDATE SET eventi = EXCLUDED.eventi, aggiornato_at = EXCLUDED.aggiornato_at`,
      [ingressiTotali, iniziato.toISOString()]
    );
  }

  return { advisor, ingressi: ingressiTotali, da: da.toISOString() };
}
