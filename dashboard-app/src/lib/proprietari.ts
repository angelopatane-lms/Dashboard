import { getDb } from "@/lib/db";

const HUBSPOT_API = "https://api.hubapi.com";

/**
 * I proprietari HubSpot: da id numerico a nome e cognome.
 *
 * PERCHE' UNA COPIA IN BANCA DATI. Le tabelle `trattativa` e `no_show` tengono
 * l'id del setter, non il nome: il nome cambia (matrimoni, correzioni di
 * anagrafica) mentre l'id no, e duplicarlo su migliaia di righe sarebbe solo
 * spazio sprecato. Ma tradurre l'id in nome richiamando HubSpot a ogni
 * caricamento di pagina costerebbe cinque chiamate per un dato che cambia una
 * volta al mese, quindi la traduzione si copia qui.
 *
 * GLI ARCHIVIATI SONO IL MOTIVO PRINCIPALE. /crm/v3/owners esclude di default
 * gli utenti DISATTIVATI, e gli ex dipendenti sono una fetta reale dello
 * storico: senza `archived=true` si leggono 76 proprietari invece di 496, e
 * nella sola analisi di luglio sette persone restavano senza nome - fra cui
 * chi aveva fissato 38 appuntamenti poi disertati. Un'anagrafica che perde chi
 * ha lasciato l'azienda non serve a niente su uno storico di tre anni.
 */

export type Proprietario = { id: number; nome: string; attivo: boolean };

/** Tutti i proprietari, attivi e disattivati. */
export async function leggiProprietariHubSpot(token: string): Promise<Proprietario[]> {
  const out = new Map<number, Proprietario>();

  for (const archiviati of [false, true]) {
    let dopo = "";
    for (;;) {
      const u = new URL(`${HUBSPOT_API}/crm/v3/owners`);
      u.searchParams.set("limit", "100");
      if (archiviati) u.searchParams.set("archived", "true");
      if (dopo) u.searchParams.set("after", dopo);

      const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`owners ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();

      for (const o of j.results ?? []) {
        const id = Number(o.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || String(o.email ?? "").trim();
        if (!nome) continue;
        // Chi compare in entrambe le liste conta come attivo: la prima
        // passata, quella senza `archived`, vince.
        if (!out.has(id)) out.set(id, { id, nome, attivo: !archiviati });
      }

      dopo = j.paging?.next?.after ?? "";
      if (!dopo) break;
    }
  }

  return [...out.values()];
}

/** Copia l'anagrafica in banca dati. Restituisce quanti sono. */
export async function sincronizzaProprietari(token: string): Promise<number> {
  const elenco = await leggiProprietariHubSpot(token);
  if (!elenco.length) throw new Error("Nessun proprietario letto da HubSpot: non sovrascrivo l'anagrafica.");

  const db = getDb();
  await db.query(
    `INSERT INTO proprietario (id, nome, attivo)
     SELECT * FROM UNNEST($1::bigint[], $2::text[], $3::boolean[])
     ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, attivo = EXCLUDED.attivo`,
    [elenco.map((p) => p.id), elenco.map((p) => p.nome), elenco.map((p) => p.attivo)]
  );

  return elenco.length;
}

/**
 * La traduzione id -> nome, dalla banca dati.
 *
 * Non ricade su HubSpot se la tabella e' vuota: chi chiama deve poter
 * distinguere "anagrafica non ancora sincronizzata" da "nome che non esiste", e
 * una chiamata di rete nascosta dentro un getter e' il tipo di cosa che rende
 * lenta una pagina senza che si capisca perche'.
 */
export async function nomiProprietari(): Promise<Map<number, string>> {
  const { rows } = await getDb().query<{ id: string; nome: string }>(
    `SELECT id::text AS id, nome FROM proprietario`
  );
  return new Map(rows.map((r) => [Number(r.id), r.nome]));
}

/**
 * La traduzione id -> nome per chi serve una pagina.
 *
 * Legge dalla banca dati, e ricade su HubSpot solo se l'anagrafica non e'
 * ancora stata sincronizzata: un id numerico al posto di un nome in tabella e'
 * un difetto che nessuno segnala, perche' sembra un dato strano e non un
 * guasto, quindi vale la chiamata in piu' la prima volta.
 *
 * Restituisce un oggetto e non una Map perche' e' la forma che le due rotte
 * HubSpot usavano gia'.
 */
export async function nomiPerRotta(token: string): Promise<Record<string, string>> {
  try {
    const dalDb = await nomiProprietari();
    if (dalDb.size) return Object.fromEntries([...dalDb].map(([id, nome]) => [String(id), nome]));
  } catch (e) {
    console.warn("[proprietari] anagrafica non leggibile dal database:", e instanceof Error ? e.message : e);
  }
  const elenco = await leggiProprietariHubSpot(token);
  return Object.fromEntries(elenco.map((p) => [String(p.id), p.nome]));
}
