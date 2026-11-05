/**
 * I proprietari HubSpot: dall'id al nome e dal nome all'id.
 *
 * SERVE A DUE PADRONI - la fotografia della notte e i Boom letti dal vivo -
 * ed e' il motivo per cui sta in un file suo invece che dentro uno dei due.
 *
 * ANCHE GLI ARCHIVIATI, in una seconda chiamata: chi ha lasciato l'azienda
 * sparisce dall'elenco normale ma resta scritto sulle trattative di allora, e
 * senza questo nelle pagine comparirebbe un numero al posto di un nome.
 *
 * DAL NOME ALL'ID serve al foglio Operatori, dove le persone stanno scritte
 * col nome e basta. A PARITA' DI NOME VINCE CHI NON E' ARCHIVIATO: 24 nomi su
 * 513 appartengono a piu' di un id, e sono vecchi account rimasti indietro.
 * Verificato il 5 novembre 2026 - sui due casi che riguardano una squadra,
 * Laura Becherucci e Nora D'Ascanio, la regola sceglie l'id giusto tutte e due
 * le volte.
 */
import { chiaveNome } from "@/lib/nomi";

const HUBSPOT = "https://api.hubapi.com";

export type Proprietari = {
  perId: Map<string, string>;
  perNome: Map<string, string>;
};

export async function proprietari(token: string): Promise<Proprietari> {
  const perId = new Map<string, string>();
  const perNome = new Map<string, string>();
  for (const archiviati of [false, true]) {
    let after: string | undefined;
    do {
      const u = `${HUBSPOT}/crm/v3/owners?limit=100&archived=${archiviati}${after ? `&after=${after}` : ""}`;
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) break;
      const d = (await r.json()) as {
        results?: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
        paging?: { next?: { after?: string } };
      };
      for (const o of d.results ?? []) {
        const nome = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || (o.email ?? "");
        if (!nome) continue;
        if (!perId.has(String(o.id))) {
          perId.set(String(o.id), nome + (archiviati ? " (archiviato)" : ""));
        }
        const chiave = chiaveNome(nome);
        if (!perNome.has(chiave)) perNome.set(chiave, String(o.id));
      }
      after = d.paging?.next?.after;
    } while (after);
  }
  return { perId, perNome };
}
