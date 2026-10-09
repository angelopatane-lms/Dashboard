import "./env";
import { writeFileSync } from "node:fs";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const AF = "Appuntamento fissato";
(async () => {
  const ids: string[] = []; let after: string | undefined;
  do {
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST", headers: H, body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "hs_lead_status", operator: "EQ", value: AF }] }],
        properties: ["hs_lead_status"], limit: 100, after })
    });
    if (!r.ok) { console.log("ricerca fallita:", r.status); break; }
    const j: any = await r.json();
    for (const c of j.results ?? []) ids.push(c.id);
    after = j.paging?.next?.after;
  } while (after);
  console.log(`contatti in "${AF}": ${ids.length}\n`);

  const esito: Array<{ id: string; da: string; giorni: number }> = [];
  let senzaStoria = 0, chiesti = 0, tornati = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const lotto = ids.slice(i, i + 50);
    chiesti += lotto.length;
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST", headers: H, body: JSON.stringify({
        inputs: lotto.map((id) => ({ id })), propertiesWithHistory: ["hs_lead_status"] }) });
    if (!r.ok) { console.log("lotto fallito:", r.status); continue; }
    const j: any = await r.json();
    tornati += (j.results ?? []).length;
    for (const c of j.results ?? []) {
      const storia = (c.propertiesWithHistory?.hs_lead_status ?? []) as Array<{ value: string; timestamp: string }>;
      // L'INGRESSO PIU' RECENTE in quello stato: se il contatto e' entrato e
      // uscito piu' volte, conta l'ultima volta che ci e' entrato, non la prima.
      const voce = storia.find((v) => String(v.value).trim() === AF);
      if (!voce) { senzaStoria += 1; continue; }
      const t = new Date(voce.timestamp);
      esito.push({ id: c.id, da: t.toISOString(), giorni: Math.floor((Date.now() - t.getTime()) / 864e5) });
    }
  }
  console.log(`letti ${tornati} su ${chiesti} chiesti; senza una voce "${AF}" in cronologia: ${senzaStoria}\n`);

  const fasce: Array<[string, (g: number) => boolean]> = [
    ["entro 7 giorni        ", (g) => g <= 7],
    ["da 8 a 30 giorni      ", (g) => g > 7 && g <= 30],
    ["da 31 a 60 giorni     ", (g) => g > 30 && g <= 60],
    ["da 61 a 180 giorni    ", (g) => g > 60 && g <= 180],
    ["oltre 180 giorni      ", (g) => g > 180]
  ];
  console.log("DA QUANTO SONO FERMI IN QUELLO STATO:");
  for (const [et, f] of fasce) {
    const n = esito.filter((x) => f(x.giorni)).length;
    console.log(`   ${et} ${String(n).padStart(4)}`);
  }
  const vecchi = esito.filter((x) => x.giorni > 60).length;
  console.log(`\n   gia' oltre i 60 giorni: ${vecchi}  <- la pulizia di stamattina non li ha presi`);
  const max = esito.reduce((m, x) => x.giorni > m ? x.giorni : m, 0);
  console.log(`   il piu' vecchio: ${max} giorni`);

  writeFileSync("scripts/_618.json", JSON.stringify(esito), "utf8");
  console.log(`\nelenco salvato (${esito.length} contatti), pronto per la scrittura`);
})();
