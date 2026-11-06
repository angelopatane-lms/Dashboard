/**
 * Per ogni incasso di una finestra: chi l'ha chiuso, chi aveva fissato
 * l'appuntamento, e da dove si ricava il setter.
 *
 *   npx tsx scripts/chi-ha-fissato-i-boom.ts 2026-11-01 2026-11-05
 *
 * TRE STRADE PER IL SETTER, e non danno lo stesso risultato:
 *   1. la proprieta' `setter` sull'incasso stesso;
 *   2. la proprieta' `setter` della trattativa (`id_trattativa`), da HubSpot:
 *      e' il ripiego che usano le pagine delle squadre, per non svegliare Neon;
 *   3. `trattativa.setter_id` nel database, congelato al giorno
 *      dell'appuntamento: e' il ripiego della Dashboard.
 * Qui si stampano tutte e tre, cosi' si vede dove si perde per strada.
 */
import "./env";
import { getDb } from "../src/lib/db";
import { proprietari } from "../src/lib/squadre/proprietari";
import { estremiRoma, sfoglia } from "../src/lib/report/giornaliero";
import { CHIUSURE_TIPOLOGIE } from "../src/lib/hubspotRegole";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";

(async () => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const da = process.argv[2] ?? "2026-11-01";
  const a = process.argv[3] ?? "2026-11-05";
  const nomi = await proprietari(token);

  const incassi = await sfoglia(
    token,
    BOOM,
    [
      { propertyName: "data_di_pagamento", operator: "GTE", value: String(estremiRoma(da).da) },
      { propertyName: "data_di_pagamento", operator: "LT", value: String(estremiRoma(a).a) }
    ],
    ["data_di_pagamento", "importo", "tipologia_di_incasso", "hubspot_owner_id", "setter", "id_trattativa", "prodotto"],
    400
  );

  // 2. il setter della trattativa, da HubSpot
  const idTratt = [...new Set(incassi.map((b) => (b.properties.id_trattativa ?? "").trim()).filter(Boolean))];
  const daHubspot = new Map<string, string>();
  for (let i = 0; i < idTratt.length; i += 100) {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/deals/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: ["setter"], inputs: idTratt.slice(i, i + 100).map((id) => ({ id })) })
    });
    if (!r.ok) continue;
    const d = (await r.json()) as any;
    for (const t of d.results ?? []) {
      const s = (t.properties.setter ?? "").trim();
      if (s) daHubspot.set(t.id, s);
    }
  }

  // 3. il setter congelato nel database
  const daDb = new Map<string, string>();
  if (idTratt.length) {
    const { rows } = await getDb().query<{ deal_id: string; setter_id: string }>(
      `SELECT deal_id::text AS deal_id, setter_id::text AS setter_id
         FROM trattativa WHERE deal_id = ANY($1::bigint[]) AND setter_id IS NOT NULL`,
      [idTratt.map(Number).filter(Number.isFinite)]
    );
    for (const r of rows) daDb.set(r.deal_id, r.setter_id);
  }

  const chi = (id: string) => (id ? nomi.perId.get(id) ?? `(${id})` : "—");
  const chiusure = incassi.filter((b) => CHIUSURE_TIPOLOGIE.has((b.properties.tipologia_di_incasso ?? "").trim()));
  console.log(`FINESTRA ${da} -> ${a}: ${incassi.length} incassi, di cui ${chiusure.length} chiusure\n`);
  console.log("CHIUSURE, una per riga:\n");

  let conSetter = 0;
  let soloDb = 0;
  for (const b of chiusure) {
    const p = b.properties;
    const idT = (p.id_trattativa ?? "").trim();
    const suIncasso = (p.setter ?? "").trim();
    const suTrattativa = daHubspot.get(idT) ?? "";
    const nelDb = daDb.get(idT) ?? "";
    const vincente = suIncasso || suTrattativa;
    if (vincente) conSetter++;
    else if (nelDb) soloDb++;
    console.log(
      `  ${Number(p.importo).toLocaleString("it-IT").padStart(7)} EUR  ${(p.prodotto ?? "").slice(0, 26).padEnd(26)}` +
        ` chiuso da ${chi((p.hubspot_owner_id ?? "").trim()).padEnd(24)}`
    );
    console.log(
      `           setter: sull'incasso ${(suIncasso ? chi(suIncasso) : "VUOTO").padEnd(24)}` +
        ` sulla trattativa ${(suTrattativa ? chi(suTrattativa) : "VUOTO").padEnd(24)}` +
        ` nel database ${nelDb ? chi(nelDb) : "VUOTO"}`
    );
  }

  console.log(`\nRIASSUNTO delle ${chiusure.length} chiusure:`);
  console.log(`   con un setter che le pagine delle squadre riescono a vedere: ${conSetter}`);
  console.log(`   che solo il database saprebbe attribuire:                    ${soloDb}`);
  console.log(`   senza setter da nessuna parte:                               ${chiusure.length - conSetter - soloDb}`);
  process.exit(0);
})();
