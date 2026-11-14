// SOLA LETTURA: le riunioni di un giorno per un advisor, con dentro chi le ha
// create e quando. Serve a capire da dove nascono cinque appuntamenti
// sovrapposti sulla stessa fascia.
//
//   npx tsx scripts/riunioni-sovrapposte.ts 2026-11-14 37491871
import "./env";

const API = "https://api.hubapi.com";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const giorno = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const owner = process.argv[3] ?? "";

const istanteRoma = (g: string) => {
  const [a, m, d] = g.split("-").map(Number);
  const presunto = Date.UTC(a, m - 1, d, 0, 0, 0);
  const scarto =
    new Date(presunto).getTime() -
    new Date(new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date(presunto)).replace(" ", "T") + "Z").getTime();
  return presunto + scarto;
};

// Le date di HubSpot arrivano in due forme a seconda della proprieta': i
// millisecondi sulle date dei meeting, l'ISO sulle date di sistema.
const ora = (v: string | null | undefined) => {
  if (!v) return "-";
  const ms = /^\d+$/.test(String(v)) ? Number(v) : new Date(String(v)).getTime();
  if (!Number.isFinite(ms)) return `? ${v}`;
  return new Date(ms).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
};

(async () => {
  const dalle = istanteRoma(giorno);
  const alle = dalle + 86400000;

  const filtri: Array<{ propertyName: string; operator: string; value: string }> = [
    { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(dalle) },
    { propertyName: "hs_meeting_start_time", operator: "LT", value: String(alle) }
  ];
  if (owner) filtri.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: owner });

  const res = await fetch(`${API}/crm/v3/objects/meetings/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      filterGroups: [{ filters: filtri }],
      properties: [
        "hs_meeting_title", "hs_meeting_start_time", "hs_meeting_end_time",
        "hubspot_owner_id", "hs_meeting_outcome", "hs_createdate", "hs_lastmodifieddate",
        "hs_created_by_user_id", "hs_meeting_source", "hs_meeting_source_id",
        "hs_meeting_location", "hs_internal_meeting_notes", "hs_object_source",
        "hs_object_source_label", "hs_object_source_detail_1", "hs_activity_type"
      ],
      sorts: [{ propertyName: "hs_meeting_start_time", direction: "ASCENDING" }],
      limit: 100
    })
  });
  const dati = await res.json();
  const righe = dati.results ?? [];
  console.log(`riunioni il ${giorno}${owner ? ` per owner ${owner}` : ""}: ${righe.length}\n`);

  for (const m of righe) {
    const p = m.properties ?? {};
    console.log(`--- meeting ${m.id}`);
    console.log(`    titolo    ${p.hs_meeting_title}`);
    console.log(`    quando    ${ora(p.hs_meeting_start_time)} -> ${ora(p.hs_meeting_end_time)}`);
    console.log(`    creata    ${ora(p.hs_createdate)}  (modificata ${ora(p.hs_lastmodifieddate)})`);
    console.log(`    origine   ${p.hs_object_source_label ?? p.hs_object_source ?? "?"} / dettaglio ${p.hs_object_source_detail_1 ?? "-"}`);
    console.log(`    creata da user ${p.hs_created_by_user_id ?? "-"} | sorgente ${p.hs_meeting_source ?? "-"} ${p.hs_meeting_source_id ?? ""}`);
    console.log(`    esito     ${p.hs_meeting_outcome ?? "-"} | luogo ${p.hs_meeting_location ?? "-"}`);

    const ass = await fetch(`${API}/crm/v4/objects/meetings/${m.id}/associations/contacts?limit=10`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const a = await ass.json();
    const ids = (a.results ?? []).map((x: { toObjectId: number }) => String(x.toObjectId));
    if (ids.length) {
      const c = await fetch(`${API}/crm/v3/objects/contacts/batch/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: ["firstname", "lastname", "email", "createdate", "hubspot_owner_id"],
          inputs: ids.map((id: string) => ({ id }))
        })
      });
      const cd = await c.json();
      for (const x of cd.results ?? []) {
        const q = x.properties ?? {};
        console.log(`    contatto  ${x.id} ${q.firstname ?? ""} ${q.lastname ?? ""} <${q.email ?? "-"}>`);
      }
    } else {
      console.log("    contatto  nessuno associato");
    }

    const ad = await fetch(`${API}/crm/v4/objects/meetings/${m.id}/associations/deals?limit=10`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const adati = await ad.json();
    const deal = (adati.results ?? []).map((x: { toObjectId: number }) => String(x.toObjectId));
    console.log(`    trattative ${deal.length ? deal.join(", ") : "nessuna"}`);
  }
  process.exit(0);
})();
