/**
 * Dopo una fusione, le trattative del contatto: quante e quando sono nate.
 *
 * COME SI LANCIA
 *   npx tsx scripts/controlla-fusioni-trattative.ts
 *
 * A COSA SERVE. Il codice di unione, quando la fusione interrompe il flusso
 * che crea la trattativa, fa rientrare il contatto nel flusso. Il rischio e'
 * di crearne una di troppo. Qui si guarda, per ogni contatto fuso dal codice
 * nuovo, se dopo l'ora dell'unione sono nate trattative: una e' il
 * recupero, due sono il doppione.
 *
 * SI PRENDE L'ORA DELL'UNIONE dalla riga "unione:" scritta nel campo
 * `unione_flussi_prima`, non da `lastmodifieddate`, che cambia a ogni soffio.
 */
import "./env";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

(async () => {
  const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST", headers: H,
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "unione_flussi_prima", operator: "HAS_PROPERTY" }] }],
      properties: ["firstname", "lastname", "unione_flussi_prima", "unione_data", "num_associated_deals"],
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
    }),
  });
  const d = await r.json();
  console.log(`\nContatti fusi dal codice nuovo: ${d.total ?? 0}\n`);

  let doppioni = 0;
  for (const c of d.results ?? []) {
    const q = c.properties;
    const campo = String(q.unione_flussi_prima ?? "");
    const oraUnione = /unione: (\S+)/.exec(campo)?.[1] ?? "";
    const esito = /REISCRIVI_TRATTATIVA=(\w+)/.exec(campo)?.[1] ?? "?";

    const a = await fetch(`https://api.hubapi.com/crm/v4/objects/contacts/${c.id}/associations/deals?limit=100`, { headers: H });
    const ids = ((await a.json()).results ?? []).map((x: { toObjectId: string }) => String(x.toObjectId));

    let dopo: { id: string; nome: string; quando: string }[] = [];
    let tutte: { id: string; nome: string; quando: string }[] = [];
    if (ids.length) {
      const b = await fetch("https://api.hubapi.com/crm/v3/objects/deals/batch/read", {
        method: "POST", headers: H,
        body: JSON.stringify({ properties: ["createdate", "dealname", "dealstage"], inputs: ids.map((i: string) => ({ id: i })) }),
      });
      tutte = ((await b.json()).results ?? []).map((x: { id: string; properties: Record<string, string> }) =>
        ({ id: x.id, nome: x.properties.dealname ?? "", quando: x.properties.createdate ?? "" }));
      dopo = tutte.filter((t) => oraUnione && t.quando > oraUnione);
    }

    const nome = `${q.firstname ?? ""} ${q.lastname ?? ""}`.trim();
    const allarme = dopo.length > 1 ? "  <<< DOPPIONE" : "";
    if (dopo.length > 1) doppioni++;
    console.log(`${c.id}  ${nome.padEnd(24)} unione ${oraUnione}  esito ${esito}  trattative totali ${tutte.length}, nate dopo l'unione ${dopo.length}${allarme}`);
    for (const t of tutte) console.log(`    ${t.quando}  ${t.id}  ${t.nome}${t.quando > oraUnione ? "   (dopo l'unione)" : ""}`);
  }
  console.log(`\n${doppioni ? `ATTENZIONE: ${doppioni} contatti con piu' di una trattativa nata dopo l'unione` : "Nessun doppione: nessun contatto ha piu' di una trattativa nata dopo l'unione."}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
