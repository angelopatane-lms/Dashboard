import { chiaveNome } from "@/lib/nomi";
import { righeRecessi, type RigaRecesso } from "@/lib/recessi/foglioMary";

/**
 * DAL RECESSO SCRITTO NEL FOGLIO AL BOOM DA MARCARE SU HUBSPOT.
 *
 * LA CATENA E' contatto -> trattative -> Boom, e non contatto -> Boom. I Boom
 * stanno appesi alle trattative: cercarli dal contatto da' quasi sempre zero,
 * e sbagliare questo passaggio fa crollare l'aggancio dal 57% al 23%.
 *
 * SI AGGANCIA PER NOME E IMPORTO perche' il foglio non offre altro: la
 * colonna MAIL e' vuota su tutte e 192 le righe, NUMERO su una sola, e la
 * DATA PAGAMENTO e' compilata su 29. Il nome trova la persona, l'importo
 * sceglie quale dei suoi pagamenti e' quello stornato.
 *
 * L'IMPORTO DEVE COINCIDERE AL CENTESIMO (un euro di tolleranza). Con una
 * soglia larga si agganciava di piu' - 128 righe invece di 110 - ma qualche
 * aggancio era un'altra vendita della stessa persona, e marcare come stornato
 * un incasso buono e' un danno peggiore di un recesso non registrato.
 *
 * L'ADVISOR DEL FOGLIO E' LA CONTROPROVA, non la chiave: quei nomi hanno 38
 * grafie diverse per una ventina di persone - "Asma", "Mozumder",
 * "Scivvhitano" - e servono solo a scegliere quando un cliente ha piu'
 * pagamenti dello stesso importo.
 */

const API = "https://api.hubapi.com";
const BOOM = "2-130365112";
export const RECESSED = "recessed";

export type Agganciato = {
  riga: RigaRecesso;
  boomId: string;
  importoBoom: number;
  dataPagamento: string;
  faseAttuale: string;
};

export type Esito = {
  righe: number;
  agganciati: Agganciato[];
  senzaContatto: number;
  senzaBoom: number;
};

const dormi = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hubspot(token: string, url: string, init?: RequestInit, tentativi = 4): Promise<any> {
  for (let i = 0; i < tentativi; i++) {
    const r = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store"
    });
    // HubSpot conta le richieste a finestre di dieci secondi: quando dice
    // basta si aspetta invece di perdere la riga.
    if (r.status === 429) {
      await dormi(1500 * (i + 1));
      continue;
    }
    if (!r.ok) return null;
    const testo = await r.text();
    return testo ? JSON.parse(testo) : {};
  }
  return null;
}

/** Il nome ridotto all'osso, per confrontare "Mario Rossi" con "ROSSI mario". */
const soloParole = (s: string) =>
  chiaveNome(s)
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");

async function boomDelContatto(token: string, idContatto: string) {
  const ass = await hubspot(token, `${API}/crm/v4/objects/contacts/${idContatto}/associations/deals?limit=100`);
  const trattative: string[] = (ass?.results ?? []).map((x: any) => String(x.toObjectId));
  const idBoom = new Set<string>();
  for (const d of trattative) {
    const a2 = await hubspot(token, `${API}/crm/v4/objects/deals/${d}/associations/${BOOM}?limit=100`);
    for (const x of a2?.results ?? []) idBoom.add(String(x.toObjectId));
  }
  if (!idBoom.size) return [];
  const fuori: any[] = [];
  const tutti = [...idBoom];
  for (let i = 0; i < tutti.length; i += 100) {
    const d = await hubspot(token, `${API}/crm/v3/objects/${BOOM}/batch/read`, {
      method: "POST",
      body: JSON.stringify({
        properties: ["importo", "data_di_pagamento", "boom_stage", "hubspot_owner_id"],
        inputs: tutti.slice(i, i + 100).map((id) => ({ id }))
      })
    });
    for (const b of d?.results ?? []) fuori.push({ id: String(b.id), ...b.properties });
  }
  return fuori;
}

/**
 * Aggancia le righe passate. Chi chiama decide quali: il cron passa solo
 * quelle nuove, cosi' un giro costa qualche chiamata invece di mille.
 */
export async function agganciaRecessi(token: string, righe: RigaRecesso[]): Promise<Esito> {
  const agganciati: Agganciato[] = [];
  let senzaContatto = 0;
  let senzaBoom = 0;

  for (const riga of righe) {
    const cerca = await hubspot(token, `${API}/crm/v3/objects/contacts/search`, {
      method: "POST",
      body: JSON.stringify({ query: riga.nome, properties: ["firstname", "lastname"], limit: 10 })
    });
    const vuole = soloParole(riga.nome);
    const esatti = (cerca?.results ?? []).filter(
      (c: any) => soloParole(`${c.properties?.firstname ?? ""} ${c.properties?.lastname ?? ""}`) === vuole
    );
    if (!esatti.length) {
      senzaContatto++;
      continue;
    }

    let tutti: any[] = [];
    for (const c of esatti) tutti = tutti.concat(await boomDelContatto(token, String(c.id)));

    const candidati = tutti
      .map((b) => ({ b, scarto: Math.abs(Number(b.importo || 0) - riga.importo) }))
      .filter((x) => x.scarto <= 1)
      .sort((a, b) => a.scarto - b.scarto);
    if (!candidati.length) {
      senzaBoom++;
      continue;
    }
    const scelto = candidati[0].b;
    agganciati.push({
      riga,
      boomId: String(scelto.id),
      importoBoom: Number(scelto.importo || 0),
      dataPagamento: String(scelto.data_di_pagamento ?? "").slice(0, 10),
      faseAttuale: String(scelto.boom_stage ?? "")
    });
  }

  return { righe: righe.length, agganciati, senzaContatto, senzaBoom };
}

/** Marca i Boom come "Richiesta rimborso". Ritorna quanti ne ha scritti davvero. */
export async function marcaRecessed(token: string, idBoom: string[]): Promise<number> {
  let scritti = 0;
  for (let i = 0; i < idBoom.length; i += 100) {
    const d = await hubspot(token, `${API}/crm/v3/objects/${BOOM}/batch/update`, {
      method: "POST",
      body: JSON.stringify({
        inputs: idBoom.slice(i, i + 100).map((id) => ({ id, properties: { boom_stage: RECESSED } }))
      })
    });
    scritti += (d?.results ?? []).length;
  }
  return scritti;
}

export { righeRecessi };
