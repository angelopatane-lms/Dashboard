import { getDb } from "@/lib/db";
import { guessCategoria } from "@/lib/campaignCategory";
import { chiaveNome } from "@/lib/nomi";

/**
 * Quanti lead ha ricevuto ciascuno OGGI, contati su HubSpot invece che sul
 * foglio.
 *
 * PERCHE' SOLO OGGI. Il foglio Operatori e' una FOTOGRAFIA: una volta scritta,
 * quella riga non cambia piu' nemmeno se il lead passa a qualcun altro la
 * settimana dopo. E' il suo pregio, ed e' il motivo per cui lo storico resta
 * suo. Il giorno in corso una fotografia non ce l'ha ancora.
 *
 * COSA RISOLVE. Il 13 ottobre 2026 Valentina Scardozzi mostrava 0 assegnati
 * mentre su HubSpot ne aveva 20, presi tutti quel giorno. Il foglio aveva le
 * sue righe - gli stati li contava - ma la colonna Assegnati restava a zero:
 * dentro quello script i due conteggi non leggono dalla stessa parte, e per una
 * persona nata su HubSpot sei giorni prima il secondo non la vedeva. Tutti gli
 * altri combaciavano entro due unita'.
 *
 * SI CONTA LA CRONOLOGIA, NON IL PROPRIETARIO DI ADESSO, ed e' il punto
 * delicato. `hubspot_owner_assigneddate` dice quando il proprietario ATTUALE ha
 * preso il contatto: contando quello, un lead che la sera passa da Tizio a Caio
 * sparisce dal conto di Tizio come se non l'avesse mai avuto. Misurato il 13
 * ottobre 2026: Marvin Alessandrin passava da 40 a 18 nel giro di un
 * pomeriggio. La cronologia del campo invece conserva ogni passaggio: chi l'ha
 * ricevuto oggi l'ha ricevuto, e il numero non torna indietro. E' la stessa
 * fotografia che fa il foglio, ricostruita da HubSpot.
 *
 * NON TOCCA I CHATTER: per loro la fonte degli assegnati e' Sales Copilot, e la
 * tabella sostituisce quelle celle riga per riga.
 */

const HUBSPOT = "https://api.hubapi.com";

/** Quanto vale il conteggio prima di rifarlo. */
export const FRESCHEZZA_MINUTI = 5;

/** Con `propertiesWithHistory` HubSpot non accetta lotti piu' grandi di 50. */
const LOTTO = 50;

/**
 * Le etichette di campagna del foglio, che non sono esattamente le nostre.
 *
 * Il foglio usa "ICMD 14" dove noi diciamo "ICMD", e ha due voci che per noi
 * sono assenze: "NESSUNA" quando il contatto non ha una campagna e "ALTRO"
 * quando ce l'ha ma non rientra in nessuna categoria. Si traducono qui, perche'
 * queste righe finiscono accanto a quelle del foglio e il filtro Campagna deve
 * selezionarle insieme.
 */
const COME_NEL_FOGLIO: Record<string, string> = {
  ICMD: "ICMD 14",
  Nessuna: "NESSUNA",
  Altro: "ALTRO"
};

export type AssegnatiOggi = {
  /** nome normalizzato -> campagna del foglio -> quanti. */
  conteggi: Record<string, Record<string, number>>;
  totale: number;
  presoAt: string;
  /** Vero quando la fotografia ha piu' di FRESCHEZZA_MINUTI. */
  vecchia: boolean;
};

const oggiRoma = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

/** Mezzanotte di oggi a Roma, come istante UTC. */
function inizioGiornataRoma(): Date {
  const adesso = new Date();
  const giorno = oggiRoma();
  // Lo scarto da UTC in questo momento dell'anno: scritto a mano sarebbe
  // sbagliato due volte l'anno, di notte.
  const fuso = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    timeZoneName: "longOffset"
  })
    .formatToParts(adesso)
    .find((p) => p.type === "timeZoneName")?.value;
  const scarto = /GMT([+-])(\d{2}):(\d{2})/.exec(fuso ?? "");
  const segno = scarto?.[1] === "-" ? -1 : 1;
  const minuti = scarto ? segno * (Number(scarto[2]) * 60 + Number(scarto[3])) : 0;
  const mezzanotte = new Date(`${giorno}T00:00:00Z`);
  mezzanotte.setUTCMinutes(mezzanotte.getUTCMinutes() - minuti);
  return mezzanotte;
}

/**
 * Quello che c'e' in archivio, fresco o no.
 *
 * LA PAGINA LEGGE SOLO DA QUI e non calcola mai: il conto vero sono una
 * quarantina di chiamate a HubSpot e una ventina di secondi, che su un
 * caricamento di pagina non si possono spendere. A rinfrescarlo e' la rotta
 * /api/assegnati-oggi, che il browser chiama per conto suo.
 *
 * NIENTE IN ARCHIVIO VUOL DIRE NIENTE DA CORREGGERE: le righe restano quelle
 * del foglio, cioe' il comportamento di prima.
 */
export async function assegnatiOggiInArchivio(): Promise<AssegnatiOggi | null> {
  try {
    const { rows } = await getDb().query<{
      dati: AssegnatiOggi["conteggi"];
      totale: number;
      preso_at: Date;
    }>(`SELECT dati, totale, preso_at FROM assegnati_oggi_cache WHERE giorno = $1::date`, [
      oggiRoma()
    ]);
    if (!rows.length) return null;
    const preso = new Date(rows[0].preso_at);
    return {
      conteggi: rows[0].dati,
      totale: rows[0].totale,
      presoAt: preso.toISOString(),
      vecchia: Date.now() - preso.getTime() >= FRESCHEZZA_MINUTI * 60_000
    };
  } catch (e) {
    console.error("[assegnatiOggi] archivio non leggibile:", e);
    return null;
  }
}

/**
 * Rifa' il conto da HubSpot e lo salva. Lento di proposito: lo chiama la rotta.
 *
 * DUE PASSI. Prima i contatti che hanno cambiato proprietario oggi, poi la
 * cronologia di quel campo per ciascuno - l'unico posto dove e' scritto CHI
 * l'ha ricevuto e quando. Un contatto passato tre volte oggi conta per tutte e
 * tre le persone: e' quello che e' successo davvero.
 */
export async function ricalcolaAssegnatiOggi(token: string): Promise<AssegnatiOggi> {
  const inizio = inizioGiornataRoma();
  const fine = new Date(inizio);
  fine.setUTCDate(fine.getUTCDate() + 1);

  const campagnaDi = new Map<string, string>();
  const ids: string[] = [];
  let dopo: string | undefined;
  do {
    const d = await chiedi<{
      results?: Array<{ id: string; properties: Record<string, string | null> }>;
      paging?: { next?: { after?: string } };
    }>(token, `${HUBSPOT}/crm/v3/objects/contacts/search`, {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hubspot_owner_assigneddate",
              operator: "GTE",
              value: String(inizio.getTime())
            },
            {
              propertyName: "hubspot_owner_assigneddate",
              operator: "LT",
              value: String(fine.getTime())
            }
          ]
        }
      ],
      properties: ["recent_conversion_event_name"],
      limit: 100,
      after: dopo
    });
    for (const c of d.results ?? []) {
      ids.push(c.id);
      const categoria = guessCategoria(c.properties.recent_conversion_event_name ?? "");
      campagnaDi.set(c.id, COME_NEL_FOGLIO[categoria] ?? categoria);
    }
    dopo = d.paging?.next?.after;
  } while (dopo);

  const nomi = await proprietari(token);
  const conteggi: Record<string, Record<string, number>> = {};
  let totale = 0;

  for (let i = 0; i < ids.length; i += LOTTO) {
    const d = await chiedi<{
      results?: Array<{
        id: string;
        propertiesWithHistory?: {
          hubspot_owner_id?: Array<{ value?: string; timestamp: string }>;
        };
      }>;
    }>(token, `${HUBSPOT}/crm/v3/objects/contacts/batch/read`, {
      inputs: ids.slice(i, i + LOTTO).map((id) => ({ id })),
      propertiesWithHistory: ["hubspot_owner_id"]
    });
    for (const c of d.results ?? []) {
      const campagna = campagnaDi.get(c.id) ?? "NESSUNA";
      for (const v of c.propertiesWithHistory?.hubspot_owner_id ?? []) {
        const quando = new Date(v.timestamp);
        if (quando < inizio || quando >= fine) continue;
        const nome = nomi.get(String(v.value ?? "").trim());
        if (!nome) continue;
        const suo = (conteggi[chiaveNome(nome)] ??= {});
        suo[campagna] = (suo[campagna] ?? 0) + 1;
        totale++;
      }
    }
  }

  const esito: AssegnatiOggi = {
    conteggi,
    totale,
    presoAt: new Date().toISOString(),
    vecchia: false
  };
  await getDb()
    .query(
      `INSERT INTO assegnati_oggi_cache (giorno, dati, totale, preso_at)
       VALUES ($1::date, $2::jsonb, $3, now())
       ON CONFLICT (giorno) DO UPDATE SET
         dati = EXCLUDED.dati, totale = EXCLUDED.totale, preso_at = now()`,
      [oggiRoma(), JSON.stringify(conteggi), totale]
    )
    .catch((e) => console.error("[assegnatiOggi] non salvato:", e));
  return esito;
}

/** Una chiamata a HubSpot, con un respiro quando ci chiede di rallentare. */
async function chiedi<T>(token: string, url: string, body: unknown): Promise<T> {
  for (let tentativo = 1; ; tentativo++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body)
    });
    if (r.status === 429 && tentativo < 4) {
      await new Promise((ok) => setTimeout(ok, 1200 * tentativo));
      continue;
    }
    if (!r.ok) throw new Error(`HubSpot: HTTP ${r.status}`);
    return (await r.json()) as T;
  }
}

/** id del proprietario -> nome, archiviati compresi: un lead puo' essere di chi e' uscito. */
async function proprietari(token: string): Promise<Map<string, string>> {
  const nomi = new Map<string, string>();
  for (const archiviati of [false, true]) {
    let dopo: string | undefined;
    for (let p = 0; p < 12; p++) {
      const u = new URL(`${HUBSPOT}/crm/v3/owners`);
      u.searchParams.set("limit", "100");
      if (archiviati) u.searchParams.set("archived", "true");
      if (dopo) u.searchParams.set("after", dopo);
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!r.ok) break;
      const d = (await r.json()) as {
        results?: Array<{ id: string; firstName?: string; lastName?: string }>;
        paging?: { next?: { after?: string } };
      };
      for (const o of d.results ?? []) {
        const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
        if (nome) nomi.set(String(o.id), nome);
      }
      dopo = d.paging?.next?.after;
      if (!dopo) break;
    }
  }
  return nomi;
}

/**
 * Le righe di oggi del foglio, con gli Assegnati riscritti da HubSpot.
 *
 * SI SOSTITUISCE, NON SI SOMMA: le due fonti contano gli stessi lead. E si
 * sostituisce tutto, anche dove il foglio aveva gia' un numero, perche'
 * mescolare le due dentro la stessa giornata darebbe un totale che non viene da
 * nessuna parte - la nostra divisione in campagne e quella dello script non
 * sono la stessa funzione, e lo stesso lead potrebbe finire in due righe.
 *
 * TUTTE LE ALTRE COLONNE RESTANO DEL FOGLIO: chiamate, connessioni, stati.
 */
export function conAssegnatiDiOggi<T extends Record<string, string>>(
  righe: T[],
  conteggi: AssegnatiOggi["conteggi"] | null,
  colonnaOperatore = "Operatore",
  /**
   * Grafie gia' note dei nomi, da usare quando la riga nuova riguarda
   * qualcuno che oggi non ha ancora righe. Senza, si ripiegava sulla chiave
   * normalizzata - tutta minuscola - e quella diventava una SECONDA riga in
   * tabella accanto a quella vera: stessa persona, nome scritto in due modi.
   */
  nomiNoti?: Iterable<string>
): T[] {
  if (!conteggi || !Object.keys(conteggi).length) return righe;

  const rimaste = new Map<string, number>();
  for (const [persona, campagne] of Object.entries(conteggi)) {
    for (const [campagna, quanti] of Object.entries(campagne)) {
      rimaste.set(`${persona}|${campagna}`, quanti);
    }
  }

  const corrette: T[] = righe.map((r) => {
    const persona = chiaveNome(String(r[colonnaOperatore] ?? ""));
    const chiave = `${persona}|${String(r["Campagna"] ?? "")}`;
    const quanti = rimaste.get(chiave);
    rimaste.delete(chiave);
    // Le righe che il conteggio non conosce vanno a zero, non restano
    // com'erano: oggi gli Assegnati vengono da HubSpot, e una riga
    // sopravvissuta sarebbe un numero di un'altra fonte in mezzo agli altri.
    return { ...r, Assegnati: String(quanti ?? 0) } as T;
  });

  // Chi oggi ha ricevuto lead su una campagna di cui il foglio non ha ancora
  // una riga - il caso di una persona appena entrata - entra con una riga sua.
  const data = righe[0]?.["Data"] ?? oggiRoma();
  const nomeVero = new Map<string, string>();
  // Prima le grafie note, poi quelle di oggi: a parita' di persona vince la
  // riga di oggi, che e' la piu' recente.
  for (const n of nomiNoti ?? []) {
    const s = String(n ?? "").trim();
    if (s) nomeVero.set(chiaveNome(s), s);
  }
  for (const r of righe) {
    const n = String(r[colonnaOperatore] ?? "");
    if (n) nomeVero.set(chiaveNome(n), n);
  }
  for (const [chiave, quanti] of rimaste) {
    const taglio = chiave.lastIndexOf("|");
    const persona = chiave.slice(0, taglio);
    corrette.push({
      Data: data,
      [colonnaOperatore]: nomeVero.get(persona) ?? persona,
      Campagna: chiave.slice(taglio + 1),
      Assegnati: String(quanti)
    } as unknown as T);
  }
  return corrette;
}
